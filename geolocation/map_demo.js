// js/map_demo.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, getDoc,
  doc, setDoc, updateDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* Firebase */
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

/* Demo Identity (no wallet) */
function getGuestId(){
  let id = localStorage.getItem('guestId');
  if(!id){
    id = 'guest-' + Math.random().toString(36).slice(2,8);
    localStorage.setItem('guestId', id);
  }
  return id;
}
const userAddress = getGuestId();

/* Sounds */
const clickSound   = new Audio('../sounds/hit.mp3');
const successSound = new Audio('https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg');
const failureSound = new Audio('https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg');
const barkSound    = new Audio('../sounds/puppybark.mp3');
let soundOn = true;

/* Utils */
function getDistance(a,b,c,d){
  const R=6371000,t=x=>x*Math.PI/180;
  const φ1=t(a),φ2=t(c),dφ=t(c-a),dλ=t(d-b);
  const A=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));
}

/* Firestore helpers (guest) */
let userStats = { totalDistanceM: 0, totalGP: 0 }; // 로컬 캐시(보상 계산에 사용)

async function ensureUserDoc(){
  await setDoc(doc(db,'users',userAddress),{
    address: userAddress,
    totalDistanceM: 0,
    totalGP: 0,
    updatedAt: serverTimestamp()
  },{merge:true});
  const snap = await getDoc(doc(db,'users',userAddress));
  if (snap.exists()) {
    const d = snap.data();
    userStats.totalDistanceM = Number(d.totalDistanceM || 0);
    userStats.totalGP        = Number(d.totalGP || 0);
  }
}
async function awardGP(gpUnits, lat, lon, totalDistanceM){
  if(gpUnits<=0) return;
  await addDoc(collection(db,'walk_logs'),{
    address:userAddress, gp:gpUnits, metersCounted:gpUnits*10,
    lat, lon, totalDistanceM, createdAt:serverTimestamp()
  });
  await updateDoc(doc(db,'users',userAddress),{
    totalGP:increment(gpUnits),
    totalDistanceM:increment(gpUnits*10),
    updatedAt:serverTimestamp()
  });
  // 로컬 캐시 즉시 반영
  userStats.totalGP        += gpUnits;
  userStats.totalDistanceM += gpUnits * 10;
}

/* Demo: persist per 1km → 블록체인 저장 안 함 */
let lastKmSaved=0;
async function persistToChainOnEachKm(totalDistanceM){
  const kmFloor=Math.floor(totalDistanceM/1000);
  if(kmFloor>lastKmSaved){
    lastKmSaved=kmFloor;
    // 데모는 체인 호출 없음 (원하면 토스트만)
    // showEvent('reward',`🧪 DEMO: 1km 달성 (${kmFloor} km)`,0);
  }
}

/* UI Toast */
let eventToast, eventList; let totalScore=0;
function showEvent(type,message,reward=0){
  if(!eventToast) eventToast=document.getElementById('eventToast');
  if(!eventList)  eventList =document.getElementById('eventList');
  if(reward>0) totalScore+=reward;
  const msg = `${message} (Total: ${totalScore} GP)`;
  eventToast.className=type; eventToast.textContent=msg;
  eventToast.style.display='block'; setTimeout(()=>eventToast.style.display='none',2000);
  const li=document.createElement('li'); li.textContent=msg;
  eventList.insertBefore(li,eventList.firstChild);
  while(eventList.children.length>12) eventList.removeChild(eventList.lastChild);
}

/* Speed Filter */
const SPEED_MIN_WALK=0.2, SPEED_MAX_WALK=2.5, SPEED_VEHICLE=4.0;
const RESUME_REQUIRE_SLOW_SAMPLES=3, PAUSE_REQUIRE_FAST_SAMPLES=2;
let pausedBySpeed=false, slowStreak=0, fastStreak=0, lastTs=null;

/* 난이도 기반 계산 로직 */
// 몬스터 난이도(우선순위: power → level → difficulty → mid 기반 추정)
function getEnemyPower(m){
  const p = Number(
    m.power ?? m.level ?? m.difficulty ?? ((m.mid % 10) + 1)
  );
  return Math.max(1, Math.floor(p));
}
// 내 능력치(운영 느낌: 누적 GP와 이동거리 기반)
function getMyPower(){
  // 예시: GP의 기여 0.5배 + 이동거리(km) 1배 + 최소 1
  const gpPart   = userStats.totalGP * 0.5;
  const kmPart   = (userStats.totalDistanceM || 0) / 1000;
  const raw      = gpPart + kmPart;
  return Math.max(1, Math.floor(raw));
}
// 승률 곡선(운영 유사: 로지스틱)
// delta=내파워-적파워, k가 클수록 곡선 완만
function winProbability(myPower, enemyPower, k=3){
  const delta = myPower - enemyPower;
  const p = 1 / (1 + Math.exp(-(delta)/k));
  return Math.min(0.9, Math.max(0.1, p)); // 10%~90%로 클램프
}
// 보상 범위(난이도 비례)
// 기본: 적파워*2 ~ 적파워*6, 내파워 우위/열세에 따라 가중
function rewardRange(myPower, enemyPower){
  const baseMin = Math.max(1, enemyPower * 2);
  const baseMax = Math.max(baseMin, enemyPower * 6);
  const diff    = myPower - enemyPower;
  // diff가 높을수록 상한은 약간 내려가고, 낮을수록 상한을 유지(난이도 높으면 상한 유지)
  const scale   = diff >= 0 ? Math.max(0.8, 1 - diff * 0.03) : Math.min(1.2, 1 - diff * 0.01);
  const minR    = Math.floor(baseMin * Math.min(1.1, Math.max(0.9, scale)));
  const maxR    = Math.floor(baseMax * Math.min(1.1, Math.max(0.8, 1.0 * (diff<0?1.05:scale))));
  return { minR: Math.max(1, minR), maxR: Math.max(1, Math.max(minR, maxR)) };
}

/* 중복 사냥 방지 */
async function isCaught(mid){
  const key = `${userAddress}_${mid}`;
  const snap = await getDoc(doc(db,'caught',key));
  return snap.exists();
}
async function setCaught(mid){
  const key = `${userAddress}_${mid}`;
  await setDoc(doc(db,'caught',key),{
    address:userAddress, mid, caughtAt:serverTimestamp()
  },{merge:true});
}

/* Init */
async function initialize(){
  await ensureUserDoc();

  const map=L.map('map',{maxZoom:22}).setView([41.6955932,44.8357820],19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  eventToast=document.getElementById('eventToast');
  eventList =document.getElementById('eventList');

  const monsters=[];
  (await getDocs(collection(db,'monsters'))).forEach(s=>{
    const d=s.data(); d.marker=null; d.caught=false; d._busy=false; monsters.push(d);
  });

  let userCircle, first=true;
  let lastLat=null,lastLon=null;
  let totalDistanceM=0, pendingForGP=0;
  const pathLatLngs=[]; const pathLine=L.polyline(pathLatLngs,{weight:5,opacity:0.8}).addTo(map);

  function updateUserMarker(lat,lon){
    const icon=L.icon({iconUrl:'../images/face.png',iconSize:[80,80],iconAnchor:[16,16]});
    if(!map.userMarker){
      map.userMarker=L.marker([lat,lon],{icon}).addTo(map).bindPopup(`${userAddress}`);
      map.userMarker.on('click',()=>{ if(soundOn) barkSound.play().catch(()=>{}); });
    }else map.userMarker.setLatLng([lat,lon]);
    if(first){ map.setView([lat,lon],19); first=false; }
    if(userCircle) map.removeLayer(userCircle);
    userCircle=L.circle([lat,lon],{radius:50,color:'blue',fillOpacity:0.2}).addTo(map);
  }

  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(p=>{
      lastLat=p.coords.latitude; lastLon=p.coords.longitude;
      lastTs=(typeof p.timestamp==='number')?p.timestamp:Date.now();
      updateUserMarker(lastLat,lastLon);
      pathLatLngs.push([lastLat,lastLon]); pathLine.setLatLngs(pathLatLngs);
    });
  }

  navigator.geolocation.watchPosition(async p=>{
    const {latitude:lat, longitude:lon, accuracy, speed:gpsSpeed}=p.coords;
    const ts=(typeof p.timestamp==='number')?p.timestamp:Date.now();
    if(typeof accuracy==='number' && accuracy>50) return;

    updateUserMarker(lat,lon);

    // 속도 계산
    let step=0, dt=0, calcSpeed=null;
    if(lastLat!==null && lastLon!==null && lastTs!==null){
      step=getDistance(lastLat,lastLon,lat,lon);
      dt=Math.max(0.001,(ts-lastTs)/1000);
      calcSpeed=step/dt;
    }
    const v=(typeof gpsSpeed==='number' && gpsSpeed>=0)?gpsSpeed:calcSpeed;

    if(v!==null){
      if(v>=SPEED_VEHICLE){
        fastStreak++; slowStreak=0;
        if(!pausedBySpeed && fastStreak>=PAUSE_REQUIRE_FAST_SAMPLES){
          pausedBySpeed=true; showEvent('lost','🚫 Vehicle detected — GP paused',0);
        }
      }else if(v>=SPEED_MIN_WALK && v<=SPEED_MAX_WALK){
        slowStreak++; fastStreak=0;
        if(pausedBySpeed && slowStreak>=RESUME_REQUIRE_SLOW_SAMPLES){
          pausedBySpeed=false; showEvent('reward','✅ Walking detected — GP resumed',0);
        }
      }else{ slowStreak=0; fastStreak=0; }
    }

    // 경로/적립
    if(lastLat!==null && lastLon!==null){
      if(step>0 && step<200){
        pathLatLngs.push([lat,lon]); pathLine.setLatLngs(pathLatLngs);

        if(!pausedBySpeed){
          totalDistanceM+=step; pendingForGP+=step;

          const units=Math.floor(pendingForGP/10);
          if(units>=1){
            try{
              await awardGP(units,lat,lon,Math.round(totalDistanceM));
              showEvent('reward',`+${units} GP (이동 ${units * 10}m)`,units);
              pendingForGP=pendingForGP%10;
            }catch(e){
              console.warn("GP 적립 실패:",e);
              showEvent('lost','GP 적립 실패',0);
            }
          }

          // 데모: 블록체인 저장 없음
          await persistToChainOnEachKm(totalDistanceM);
        }
      }
    }else{
      pathLatLngs.push([lat,lon]); pathLine.setLatLngs(pathLatLngs);
    }

    // 몬스터(데모에서도 표시 + 사냥 가능, 난이도 기반 보상/승률)
    monsters.forEach(m=>{
      if(m.caught) return;
      const dist=getDistance(lat,lon,m.lat,m.lon);

      if(dist<=20 && !m.marker){
        m.marker=L.marker([m.lat,m.lon],{
          icon:L.icon({iconUrl:m.imagesURL,iconSize:[80,80],iconAnchor:[30,30]})
        }).addTo(map);

        m._busy=false;
        m.marker.on('click', async ()=>{
          if(m.caught){
            showEvent('lost','Monsters already caught',0);
            if(soundOn) failureSound.play().catch(()=>{});
            return;
          }
          if(m._busy) return;
          m._busy=true;

          if(soundOn) clickSound.play().catch(()=>{});

          try{
            // 이미 잡았는지 Firestore로 확인
            if (await isCaught(m.mid)) {
              showEvent('lost','Monsters already caught',0);
              if(soundOn) failureSound.play().catch(()=>{});
              m.caught=true;
              if(m.marker){ map.removeLayer(m.marker); m.marker=null; }
            } else {
              const enemyP = getEnemyPower(m);
              const myP    = getMyPower();
              const pWin   = winProbability(myP, enemyP);
              const { minR, maxR } = rewardRange(myP, enemyP);

              const success = Math.random() < pWin;
              const reward  = success
                ? (minR + Math.floor(Math.random() * (maxR - minR + 1)))
                : 0;

              if (success) {
                // 보상은 Firestore에만 반영
                await awardGP(reward, lat, lon, Math.round(totalDistanceM));
                await setCaught(m.mid);

                if(soundOn) successSound.play().catch(()=>{});
                showEvent('reward', `+${reward} GP (DEMO Hunt: my ${myP} vs ${enemyP})`, reward);
                m.caught = true;
              } else {
                if(soundOn) failureSound.play().catch(()=>{});
                showEvent('lost', `Failed (DEMO Hunt: my ${myP} vs ${enemyP})`, 0);
              }

              if(m.marker){ map.removeLayer(m.marker); m.marker=null; }
            }
          }catch(e){
            console.warn(e);
            showEvent('lost','error occurred (DEMO)',0);
            if(soundOn) failureSound.play().catch(()=>{});
          }finally{
            m._busy=false;
          }
        });
      }

      if(dist>25 && m.marker && !m.caught){
        map.removeLayer(m.marker); m.marker=null;
      }
    });

    lastLat=lat; lastLon=lon; lastTs=ts;
  }, err=>console.error(err), {enableHighAccuracy:true});

  // Controls
  const locateBtn=document.getElementById('locateBtn');
  if(locateBtn){
    locateBtn.onclick=()=>navigator.geolocation.getCurrentPosition(p=>map.setView([p.coords.latitude,p.coords.longitude],19));
  }
  const homeBtn=document.getElementById('homeBtn'); if(homeBtn){ homeBtn.onclick=()=>location.href='/'; }
  const soundToggle=document.getElementById('soundToggle'); if(soundToggle){
    soundToggle.onclick=()=>{ soundOn=!soundOn; soundToggle.textContent=soundOn?'🔊':'🔇'; };
  }
}

initialize();
