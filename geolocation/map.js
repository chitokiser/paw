import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc,
  doc, setDoc, updateDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ───────────────── Firebase ───────────────── */
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

/* ───────────────── Contract ───────────────── */
const CONTRACT_ADDRESS = "0xE81E0976D6aa80c9C2C210cEA6106592feBEB220";
const CONTRACT_ABI = [
  "function hunt(uint256 mid,uint256 pass) external",
  "event RewardGiven(address indexed user,uint256 rewardAmount)",
  "event Lost(address indexed user,uint256 enemyPower,uint256 myPower)"
];

let provider, signer, contract, userAddress;

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

/* ───────────────── Sounds ───────────────── */
const clickSound   = new Audio('../sounds/hit.mp3');
const successSound = new Audio('https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg');
const failureSound = new Audio('https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg');
const barkSound    = new Audio('../sounds/puppybark.mp3');
let soundOn = true;

/* ───────────────── Utils ───────────────── */
function getDistance(a, b, c, d) {
  const R = 6371000, t = x => x * Math.PI / 180;
  const φ1 = t(a), φ2 = t(c), dφ = t(c - a), dλ = t(d - b);
  const A = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
}

/* ─────────────── Firestore helpers ─────────────── */
async function ensureUserDoc() {
  const uref = doc(db, "users", userAddress);
  await setDoc(uref, {
    address: userAddress,
    totalDistanceM: 0,
    totalGP: 0,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

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

/* ────────────── Chain persist per 1km ───────────── */
let lastKmSaved = 0;
async function persistToChainOnEachKm(totalDistanceM) {
  const kmFloor = Math.floor(totalDistanceM / 1000);
  if (kmFloor > lastKmSaved) {
    try {
      const tx = await contract.hunt(5000, 1111); // 지정된 몬스터/패스워드
      await tx.wait();
      lastKmSaved = kmFloor;
      showEvent('reward', `✅ 블록체인 저장 완료 (${kmFloor} km)`, 0);
      if (soundOn) successSound.play().catch(() => {});
    } catch (e) {
      console.warn("블록체인 저장 실패:", e);
      showEvent('lost', '블록체인 저장 실패', 0);
      if (soundOn) failureSound.play().catch(() => {});
    }
  }
}

/* ───────────────── UI Toast ───────────────── */
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

/* ─────────────── Speed Filter (anti-vehicle) ─────────────── */
const SPEED_MIN_WALK = 0.2;   // m/s: 정지/드리프트 제외
const SPEED_MAX_WALK = 2.5;   // m/s: 빠른 보행 ~ 조깅 경계
const SPEED_VEHICLE  = 4.0;   // m/s: 이 이상이면 차량/오토바이 추정
const RESUME_REQUIRE_SLOW_SAMPLES = 3; // 연속 n회 보행 감지 시 재개
const PAUSE_REQUIRE_FAST_SAMPLES = 2;  // 연속 n회 차량 감지 시 일시정지

let pausedBySpeed = false;
let slowStreak = 0;
let fastStreak = 0;
let lastTs = null;

/* ───────────────── Initialize ───────────────── */
async function initialize() {
  await connectWallet();
  await ensureUserDoc();

  // 지도
  const map = L.map('map', { maxZoom: 22 }).setView([41.6955932, 44.8357820], 19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  eventToast = document.getElementById('eventToast');
  eventList  = document.getElementById('eventList');

  // 몬스터
  const monsters = [];
  (await getDocs(collection(db, 'monsters'))).forEach(docSnap => {
    const d = docSnap.data();
    d.marker = null;
    d.caught = false;
    d._busy  = false;
    monsters.push(d);
  });

  // 유저 위치/경로
  let userCircle, first = true;
  let lastLat = null, lastLon = null;
  let totalDistanceM = 0;
  let pendingForGP = 0;
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
      lastTs  = (typeof p.timestamp === 'number') ? p.timestamp : Date.now();
      updateUserMarker(lastLat, lastLon);
      pathLatLngs.push([lastLat, lastLon]);
      pathLine.setLatLngs(pathLatLngs);
    });
  }

  // 위치 추적(단 한 번 등록)
  navigator.geolocation.watchPosition(async p => {
    const { latitude: lat, longitude: lon, accuracy, speed: gpsSpeed } = p.coords;
    const ts = (typeof p.timestamp === 'number') ? p.timestamp : Date.now();

    // 정확도 필터
    if (typeof accuracy === 'number' && accuracy > 50) return;

    updateUserMarker(lat, lon);

    // 속도 계산
    let step = 0, dt = 0, calcSpeed = null;
    if (lastLat !== null && lastLon !== null && lastTs !== null) {
      step = getDistance(lastLat, lastLon, lat, lon);
      dt = Math.max(0.001, (ts - lastTs) / 1000);
      calcSpeed = step / dt;
    }
    const v = (typeof gpsSpeed === 'number' && gpsSpeed >= 0) ? gpsSpeed : calcSpeed;

    if (v !== null) {
      if (v >= SPEED_VEHICLE) {               // 차량/오토바이로 판단
        fastStreak++; slowStreak = 0;
        if (!pausedBySpeed && fastStreak >= PAUSE_REQUIRE_FAST_SAMPLES) {
          pausedBySpeed = true;
          showEvent('lost', '🚫 Vehicle detected — GP paused', 0);
        }
      } else if (v >= SPEED_MIN_WALK && v <= SPEED_MAX_WALK) { // 보행
        slowStreak++; fastStreak = 0;
        if (pausedBySpeed && slowStreak >= RESUME_REQUIRE_SLOW_SAMPLES) {
          pausedBySpeed = false;
          showEvent('reward', '✅ Walking detected — GP resumed', 0);
        }
      } else {
        slowStreak = 0; fastStreak = 0;
      }
    }

    // 경로/적립
    if (lastLat !== null && lastLon !== null) {
      // 점프 필터
      if (step > 0 && step < 200) {
        // 경로는 계속 그림(필요시 pausedBySpeed일 때 생략 가능)
        pathLatLngs.push([lat, lon]);
        pathLine.setLatLngs(pathLatLngs);

        if (!pausedBySpeed) {
          totalDistanceM += step;
          pendingForGP += step;

          const units = Math.floor(pendingForGP / 10);
          if (units >= 1) {
            try {
              await awardGP(units, lat, lon, Math.round(totalDistanceM));
              showEvent('reward', `+${units} GP (이동 ${units * 10}m)`, units);
              pendingForGP = pendingForGP % 10;
            } catch (e) {
              console.warn("GP 적립 실패:", e);
              showEvent('lost', 'GP 적립 실패', 0);
            }
          }

          await persistToChainOnEachKm(totalDistanceM);
        }
      }
    } else {
      // 최초 시작점
      pathLatLngs.push([lat, lon]);
      pathLine.setLatLngs(pathLatLngs);
    }

    // 몬스터
    monsters.forEach(m => {
      if (m.caught) return;
      const dist = getDistance(lat, lon, m.lat, m.lon);

      if (dist <= 20 && !m.marker) {
        m.marker = L.marker([m.lat, m.lon], {
          icon: L.icon({ iconUrl: m.imagesURL, iconSize: [80, 80], iconAnchor: [30, 30] })
        }).addTo(map);

        m._busy = false;
        m.marker.on('click', async () => {
          if (m.caught) {
            showEvent('lost', 'Monsters already caught', 0);
            if (soundOn) failureSound.play().catch(()=>{});
            return;
          }
          if (m._busy) return;
          m._busy = true;

          if (soundOn) clickSound.play().catch(() => {});
          try {
            const tx = await contract.hunt(m.mid, m.pass);
            const rc = await tx.wait();

            let reward = 0;
            if (rc && Array.isArray(rc.events)) {
              rc.events.forEach(e => {
                if (e.event === 'RewardGiven') {
                  reward = parseInt(e.args.rewardAmount.toString(), 10);
                }
              });
            }

            if (reward > 0) {
              if (soundOn) successSound.play().catch(() => {});
              showEvent('reward', `+${reward} GP`, reward);
              m.caught = true;
            } else {
              if (soundOn) failureSound.play().catch(() => {});
              showEvent('lost', 'Failed to acquire', 0);
            }

            if (m.marker) { map.removeLayer(m.marker); m.marker = null; }
          } catch (err) {
            const emsg =
              err?.error?.message ||
              err?.data?.message ||
              err?.reason ||
              err?.message ||
              '';

            if (/already\s*caught/i.test(emsg) || /monster.*already/i.test(emsg)) {
              showEvent('lost', 'Monsters already caught', 0);
              m.caught = true;
              if (m.marker) { map.removeLayer(m.marker); m.marker = null; }
            } else {
              showEvent('lost', 'error occurred', 0);
            }

            if (soundOn) failureSound.play().catch(() => {});
          } finally {
            m._busy = false;
          }
        });
      }

      // 반경 이탈 시 마커 제거
      if (dist > 25 && m.marker && !m.caught) {
        map.removeLayer(m.marker);
        m.marker = null;
      }
    });

    lastLat = lat;
    lastLon = lon;
    lastTs  = ts;
  }, err => console.error(err), { enableHighAccuracy: true });

  /* ───────────── Controls ───────────── */
  const locateBtn = document.getElementById('locateBtn');
  if (locateBtn) {
    locateBtn.onclick = () =>
      navigator.geolocation.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 19));
  }

  const homeBtn = document.getElementById('homeBtn');
  if (homeBtn) {
    homeBtn.onclick = () => location.href = '/geolocation/geohome.html';
  }

  const soundToggle = document.getElementById('soundToggle');
  if (soundToggle) {
    soundToggle.onclick = () => {
      soundOn = !soundOn;
      soundToggle.textContent = soundOn ? '🔊' : '🔇';
    };
  }
}

initialize();
