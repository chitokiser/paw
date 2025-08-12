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
  const gpPart   = userStats.totalGP * 0.5;
  const kmPart   = (userStats.totalDistanceM || 0) / 1000;
  const raw      = gpPart + kmPart;
  return Math.max(1, Math.floor(raw));
}
// 승률 곡선(운영 유사)
function winProbability(myPower, enemyPower, k=3){
  const delta = myPower - enemyPower;
  const p = 1 / (1 + Math.exp(-(delta)/k));
  return Math.min(0.9, Math.max(0.1, p)); // 10%~90%
}
// 보상 범위(난이도 비례)
function rewardRange(myPower, enemyPower){
  const baseMin = Math.max(1, enemyPower * 2);
  const baseMax = Math.max(baseMin, enemyPower * 6);
  const diff    = myPower - enemyPower;
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

/* ───────────────────── Quick Tap Challenge ───────────────────── */
function ensureTapOverlay() {
  let ov = document.getElementById('tapOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'tapOverlay';
  Object.assign(ov.style, {
    position:'fixed', inset:'0', background:'rgba(0,0,0,0.55)', zIndex:'9999',
    display:'none', alignItems:'center', justifyContent:'center'
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    width:'min(360px,92%)', background:'#111827', color:'#e5e7eb',
    border:'1px solid rgba(255,255,255,.12)', borderRadius:'16px',
    padding:'18px', textAlign:'center', boxShadow:'0 20px 40px rgba(0,0,0,.35)'
  });

  const title = document.createElement('h3');
  title.textContent = 'Quick Hit!';
  Object.assign(title.style, {margin:'0 0 6px', fontWeight:'800', fontSize:'20px'});

  const desc = document.createElement('p'); desc.id = 'tapDesc';
  Object.assign(desc.style, {margin:'0 0 10px', color:'#93a3b8', fontSize:'14px'});

  const status = document.createElement('div'); status.id = 'tapStatus';
  Object.assign(status.style, {margin:'0 0 12px', fontSize:'14px'});

  const hitBtn = document.createElement('button'); hitBtn.id = 'tapHitBtn'; hitBtn.textContent = 'HIT!';
  Object.assign(hitBtn.style, {
    padding:'12px 18px', borderRadius:'14px', border:'0', cursor:'pointer',
    background:'#2563eb', color:'#fff', fontWeight:'800', fontSize:'16px',
    width:'100%', boxShadow:'0 10px 18px rgba(37,99,235,.35)'
  });

  const cancel = document.createElement('button'); cancel.id='tapCancel'; cancel.textContent='Cancel';
  Object.assign(cancel.style, {
    marginTop:'10px', background:'transparent', color:'#93a3b8', border:'0', cursor:'pointer', fontSize:'13px'
  });

  card.append(title, desc, status, hitBtn, cancel);
  ov.append(card);
  document.body.appendChild(ov);
  return ov;
}

// mid에 따른 탭 도전 (성공: true / 실패: false)
// 시간 = 0.5s × id, 필요 횟수 = ceil(id/2)
function tapChallenge(mid) {
  const idNum = Math.max(1, Number(mid) || 1);
  const windowMs = 500 * idNum;
  const required = Math.max(1, Math.ceil(idNum / 2));
  const overlay = ensureTapOverlay();

  const desc = document.getElementById('tapDesc');
  const status = document.getElementById('tapStatus');
  const hitBtn = document.getElementById('tapHitBtn');
  const cancel = document.getElementById('tapCancel');

  desc.textContent = `Hit ${required} time(s) within ${(windowMs/1000).toFixed(1)}s (Monster #${idNum})`;
  status.textContent = `Hits: 0 / ${required} · Time left: ${(windowMs/1000).toFixed(1)}s`;

  let hits = 0, done = false, resolveFn;
  overlay.style.display = 'flex';

  const start = Date.now();
  const timer = setInterval(() => {
    const remain = Math.max(0, windowMs - (Date.now() - start));
    status.textContent = `Hits: ${hits} / ${required} · Time left: ${(remain/1000).toFixed(1)}s`;
    if (remain <= 0) {
      clearInterval(timer);
      if (!done) finish(false);
    }
  }, 50);

  function finish(ok) {
    done = true;
    overlay.style.display = 'none';
    clearInterval(timer);
    hitBtn.onclick = null;
    cancel.onclick = null;
    resolveFn?.(ok);
  }

  hitBtn.onclick = () => {
    hits++;
    try { clickSound?.play()?.catch(()=>{}); } catch {}
    if (hits >= required && !done) finish(true);
  };
  cancel.onclick = () => !done && finish(false);

  return new Promise((resolve) => { resolveFn = resolve; });
}

/* ───────────── Angry Follower(분노 추격) 설정 ───────────── */
const angryIcon = L.divIcon({
  className: 'angry-mon',
  html: '😡',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

/* Init */
async function initialize(){
  await ensureUserDoc();

  const map=L.map('map',{maxZoom:22}).setView([41.6955932,44.8357820],19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  eventToast=document.getElementById('eventToast');
  eventList =document.getElementById('eventList');

  const monsters=[];
  (await getDocs(collection(db,'monsters'))).forEach(s=>{
    const d=s.data();
    d.marker=null; d.caught=false; d._busy=false;
    d.angryUntil=0;           // 분노 종료 시각 (timestamp ms)
    d.follower=null;          // 분노 추격 마커
    monsters.push(d);
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

    // ───────── Angry followers: 플레이어 위치로 추격 마커를 갱신 ─────────
    const now = Date.now();
    monsters.forEach(m=>{
      // 분노 시간 동안에는 플레이어를 따라다님
      if (m.angryUntil && now < m.angryUntil) {
        if (!m.follower) {
          m.follower = L.marker([lat, lon], { icon: angryIcon })
            .addTo(map)
            .bindPopup('😡 Angry!');
          showEvent('lost', `😡 Monster #${m.mid} is chasing you for 1 min`, 0);
        } else {
          m.follower.setLatLng([lat, lon]);
        }
      } else {
        // 분노 종료: 추격 마커 제거(한 번만)
        if (m.follower) {
          map.removeLayer(m.follower);
          m.follower = null;
          m.angryUntil = 0;
          showEvent('reward', `😌 Monster #${m.mid} calmed down`, 0);
        }
      }
    });

    // 몬스터(표시/사냥)
    monsters.forEach(m=>{
      if(m.caught) return;

      const dist=getDistance(lat,lon,m.lat,m.lon);
      const isAngry = m.angryUntil && now < m.angryUntil;

      // 분노 중엔 고정 마커를 생성하지 않음(항상 플레이어를 따라다니므로)
      if(!isAngry && dist<=20 && !m.marker){
        m.marker=L.marker([m.lat,m.lon],{
          icon:L.icon({iconUrl:m.imagesURL,iconSize:[80,80],iconAnchor:[30,30]})
        }).addTo(map);

        m._busy=false;
        m.marker.on('click', async ()=>{
          if(m.caught){
            showEvent('lost','Monsters already caught',0);
            if(soundOn) failureSound.play().catch(()=>{}); return;
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
              // ── Quick Tap 도전 ──
              const passed = await tapChallenge(m.mid);
              if (!passed) {
                if (soundOn) failureSound.play().catch(()=>{});
                showEvent('lost', 'Not enough hits', 0);

                // 1분 분노 모드 ON: 플레이어를 추격
                m.angryUntil = Date.now() + 60_000;

                // 고정 마커 제거 (추격 모드만 유지)
                if(m.marker){ map.removeLayer(m.marker); m.marker=null; }
                m._busy=false;
                return;
              }

              // 도전 성공 → 난이도 기반 전투/보상
              const enemyP = getEnemyPower(m);
              const myP    = getMyPower();
              const pWin   = winProbability(myP, enemyP);
              const { minR, maxR } = rewardRange(myP, enemyP);

              const success = Math.random() < pWin;
              const reward  = success
                ? (minR + Math.floor(Math.random() * (maxR - minR + 1)))
                : 0;

              if (success) {
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

      // 반경 이탈 시 고정 마커 제거 (분노/포획 제외)
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
  const homeBtn = document.getElementById('homeBtn');
  if (homeBtn) {
    homeBtn.onclick = () => location.href = '/geolocation/geohome.html';
  }
  const soundToggle=document.getElementById('soundToggle'); if(soundToggle){
    soundToggle.onclick=()=>{ soundOn=!soundOn; soundToggle.textContent=soundOn?'🔊':'🔇'; };
  }
}

initialize();
