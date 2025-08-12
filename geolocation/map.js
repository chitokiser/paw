import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc,
  doc, setDoc, updateDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.appspot.com",
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Contract 정보
const CONTRACT_ADDRESS = "0xE81E0976D6aa80c9C2C210cEA6106592feBEB220";
const CONTRACT_ABI = [
  "function hunt(uint256 mid,uint256 pass) external",
  "event RewardGiven(address indexed user,uint256 rewardAmount)",
  "event Lost(address indexed user,uint256 enemyPower,uint256 myPower)"
];

let provider, signer, contract, userAddress;

// 지갑 연결
async function connectWallet() {
  if (!window.ethereum) {
    alert("Metamask 필요");
    return;
  }
  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  userAddress = await signer.getAddress();
  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
}

// 사운드
const clickSound   = new Audio('../sounds/hit.mp3');
const successSound = new Audio('https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg');
const failureSound = new Audio('https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg');
const barkSound    = new Audio('../sounds/puppybark.mp3');
let soundOn = true;

// 거리 계산 (Haversine)
function getDistance(a, b, c, d) {
  const R = 6371000, t = x => x * Math.PI / 180;
  const φ1 = t(a), φ2 = t(c), dφ = t(c - a), dλ = t(d - b);
  const A = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
}

// Firestore: 사용자 누적 문서 보장
async function ensureUserDoc() {
  const uref = doc(db, "users", userAddress);
  await setDoc(uref, {
    address: userAddress,
    totalDistanceM: 0,
    totalGP: 0,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Firestore: 10m당 GP 적립 로그 + 누적 업데이트
async function awardGP(gpUnits, lat, lon, totalDistanceM) {
  if (gpUnits <= 0) return;
  const logs = collection(db, "walk_logs");
  await addDoc(logs, {
    address: userAddress,
    gp: gpUnits,
    metersCounted: gpUnits * 10,
    lat, lon,
    totalDistanceM,
    createdAt: serverTimestamp()
  });
  const uref = doc(db, "users", userAddress);
  await updateDoc(uref, {
    totalGP: increment(gpUnits),
    totalDistanceM: increment(gpUnits * 10),
    updatedAt: serverTimestamp()
  });
}

// 블록체인: 1km 달성 시 저장 호출(중복 방지)
let lastKmSaved = 0; // 누적 km의 바닥값 기록
async function persistToChainOnEachKm(totalDistanceM) {
  const kmFloor = Math.floor(totalDistanceM / 1000);
  if (kmFloor > lastKmSaved) {
    try {
      const tx = await contract.hunt(5000, 1111);
      await tx.wait();
      lastKmSaved = kmFloor;
      // 알림
      showEvent('reward', `✅ 블록체인 저장 완료 (${kmFloor} km)`, 0);
      if (soundOn) successSound.play().catch(() => {});
    } catch (e) {
      console.warn("블록체인 저장 실패:", e);
      showEvent('lost', '블록체인 저장 실패', 0);
      if (soundOn) failureSound.play().catch(() => {});
    }
  }
}

// UI 토스트
let eventToast, eventList;
let totalScore = 0;
function showEvent(type, message, reward = 0) {
  if (!eventToast) eventToast = document.getElementById('eventToast');
  if (!eventList) eventList = document.getElementById('eventList');
  if (reward > 0) totalScore += reward;
  const msg = `${message} (Total: ${totalScore} GP)`;
  eventToast.className = type;
  eventToast.textContent = msg;
  eventToast.style.display = 'block';
  setTimeout(() => eventToast.style.display = 'none', 2000);
  const li = document.createElement('li');
  li.textContent = msg;
  eventList.insertBefore(li, eventList.firstChild);
  while (eventList.children.length > 12) eventList.removeChild(eventList.lastChild);
}

// 초기화
async function initialize() {
  await connectWallet();
  await ensureUserDoc();

  // 지도 생성
  const map = L.map('map', { maxZoom: 22 }).setView([41.6955932, 44.8357820], 19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  eventToast = document.getElementById('eventToast');
  eventList  = document.getElementById('eventList');

  // 몬스터 불러오기
  const monsters = [];
  (await getDocs(collection(db, 'monsters'))).forEach(docSnap => {
    const d = docSnap.data();
    d.marker = null;
    monsters.push(d);
  });

  // 유저 위치/경로
  let userCircle, first = true;
  let lastLat = null, lastLon = null;
  let totalDistanceM = 0;          // 전체 누적 이동거리(m)
  let pendingForGP = 0;            // GP 환산을 위해 누적 중인 미처리 거리(m)
  const pathLatLngs = [];
  const pathLine = L.polyline(pathLatLngs, { weight: 5, opacity: 0.8 }).addTo(map);

  function updateUserMarker(lat, lon) {
    const icon = L.icon({ iconUrl: '../images/face.png', iconSize: [80, 80], iconAnchor: [16, 16] });
    if (!map.userMarker) {
      map.userMarker = L.marker([lat, lon], { icon }).addTo(map).bindPopup('my puppy');
      map.userMarker.on('click', () => { if (soundOn) barkSound.play().catch(() => {}); });
    } else {
      map.userMarker.setLatLng([lat, lon]);
    }
    if (first) {
      map.setView([lat, lon], 19);
      first = false;
    }
    if (userCircle) map.removeLayer(userCircle);
    userCircle = L.circle([lat, lon], { radius: 50, color: 'blue', fillOpacity: 0.2 }).addTo(map);
  }

  // 초기 좌표
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => {
      lastLat = p.coords.latitude;
      lastLon = p.coords.longitude;
      updateUserMarker(lastLat, lastLon);
      pathLatLngs.push([lastLat, lastLon]);
      pathLine.setLatLngs(pathLatLngs);
    });
  }

  // 위치 추적 + 게임 로직 + 경로/거리/GP 적립
  navigator.geolocation.watchPosition(async p => {
    const { latitude: lat, longitude: lon, accuracy } = p.coords;

    // 노이즈 필터: 정확도 50m 초과는 무시
    if (typeof accuracy === 'number' && accuracy > 50) return;

    updateUserMarker(lat, lon);

    if (lastLat !== null && lastLon !== null) {
      const step = getDistance(lastLat, lastLon, lat, lon);

      // 점프 필터: 200m 이상 급격한 이동은 무시(스푸핑/점프 방지)
      if (step > 0 && step < 200) {
        totalDistanceM += step;
        pendingForGP += step;

        // 경로 그리기
        pathLatLngs.push([lat, lon]);
        pathLine.setLatLngs(pathLatLngs);

        // 10m마다 1GP 적립
        const units = Math.floor(pendingForGP / 10); // 10m 단위
        if (units >= 1) {
          try {
            await awardGP(units, lat, lon, Math.round(totalDistanceM));
            showEvent('reward', `+${units} GP (이동 ${units * 10}m)`, units);
            pendingForGP = pendingForGP % 10; // 남은 잔여 거리 보존
          } catch (e) {
            console.warn("GP 적립 실패:", e);
            showEvent('lost', 'GP 적립 실패', 0);
          }
        }

        // 1km 달성 시 블록체인 기록
        await persistToChainOnEachKm(totalDistanceM);
      }
    }

    lastLat = lat; lastLon = lon;

    // 몬스터 처리
    monsters.forEach(m => {
      const dist = getDistance(lat, lon, m.lat, m.lon);
      if (dist <= 20 && !m.marker) {
        m.marker = L.marker([m.lat, m.lon], {
          icon: L.icon({ iconUrl: m.imagesURL, iconSize: [80, 80], iconAnchor: [30, 30] })
        }).addTo(map);

        m.marker.on('click', async () => {
          if (soundOn) clickSound.play().catch(() => {});
          try {
            const tx = await contract.hunt(m.mid, m.pass);
            const rc = await tx.wait();
            let reward = 0;
            rc.events.forEach(e => { if (e.event === 'RewardGiven') reward = parseInt(e.args.rewardAmount.toString(), 10); });
            if (reward > 0) {
              if (soundOn) successSound.play().catch(() => {});
              showEvent('reward', `+${reward} GP`, reward);
            } else {
              if (soundOn) failureSound.play().catch(() => {});
              showEvent('lost', '획득 실패', 0);
            }
            map.removeLayer(m.marker);
            m.marker = null;
          } catch {
            if (soundOn) failureSound.play();
            showEvent('lost', '에러 발생', 0);
          }
        });
      }
    });
  }, err => console.error(err), { enableHighAccuracy: true });

  // 버튼 이벤트
  document.getElementById('locateBtn').onclick = () =>
    navigator.geolocation.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 19));

  document.getElementById('homeBtn').onclick = () => location.href = '/';

  document.getElementById('soundToggle').onclick = () => {
    soundOn = !soundOn;
    document.getElementById('soundToggle').textContent = soundOn ? '🔊' : '🔇';
  };
}

initialize();
