// map_demo.js
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
// 위경도에서 목표까지 d미터만큼 한 스텝 이동(근사)
function stepTowards(lat, lon, tgtLat, tgtLon, meters){
  if (meters<=0) return {lat, lon};
  const dist = getDistance(lat, lon, tgtLat, tgtLon);
  if (dist === 0 || meters >= dist) return {lat: tgtLat, lon: tgtLon};
  const ratio = meters / dist;
  return { lat: lat + (tgtLat - lat) * ratio, lon: lon + (tgtLon - lon) * ratio };
}
function randInCircleMeters(baseLat, baseLon, radiusM){
  const dLat = (Math.random()*2-1) * radiusM / 111320;
  const dLon = (Math.random()*2-1) * radiusM / (111320 * Math.cos(baseLat*Math.PI/180));
  return {lat: baseLat + dLat, lon: baseLon + dLon};
}

/* Firestore helpers (guest) */
let userStats = { totalDistanceM: 0, totalGP: 0 };

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
  userStats.totalGP        += gpUnits;
  userStats.totalDistanceM += gpUnits * 10;
}

/* Demo: persist per 1km → 블록체인 저장 안 함 */
let lastKmSaved=0;
async function persistToChainOnEachKm(totalDistanceM){
  const kmFloor=Math.floor(totalDistanceM/1000);
  if(kmFloor>lastKmSaved){
    lastKmSaved=kmFloor;
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

/* === 벙커/트랩에 의한 일시정지 관리 === */
let pausedUntil = 0;
function isGPActive(){
  return !pausedBySpeed && Date.now() >= pausedUntil;
}
function pauseFor(ms, reason=''){
  const until = Date.now() + ms;
  if (until > pausedUntil) pausedUntil = until;
  showEvent('lost', reason || `⏱️ GP paused for ${(ms/1000).toFixed(0)}s`, 0);
}

/* 난이도 기반 계산 로직 */
function getEnemyPower(m){
  const p = Number(m.power ?? m.level ?? m.difficulty ?? ((m.mid % 10) + 1));
  return Math.max(1, Math.floor(p));
}
function getMyPower(){
  const gpPart   = userStats.totalGP * 0.5;
  const kmPart   = (userStats.totalDistanceM || 0) / 1000;
  const raw      = gpPart + kmPart;
  return Math.max(1, Math.floor(raw));
}
function winProbability(myPower, enemyPower, k=3){
  const delta = myPower - enemyPower;
  const p = 1 / (1 + Math.exp(-(delta)/k));
  return Math.min(0.9, Math.max(0.1, p));
}
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

// mid에 따른 탭 도전
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

/* ───────────── BUNKER/ARROW 아이콘 ───────────── */
const bunkerIcon = L.divIcon({
  className: 'bunker',
  html: '🏰',
  iconSize: [28,28],
  iconAnchor: [14,14]
});
const arrowIcon = L.divIcon({
  className: 'arrow',
  html: '➳',
  iconSize: [24,24],
  iconAnchor: [12,12]
});

/* ================= Sprite helpers ================= */
// CSS 주입(스프라이트용)
(function injectSpriteCSS(){
  const css = `
  .sprite{position:relative;width:var(--fw,80px);height:var(--fh,80px);background-image:var(--img);background-repeat:no-repeat;background-position:0 0;image-rendering:pixelated;will-change:transform,background-position;transform-origin:50% 50%}
  .sprite.mon-bob{animation:bob 2.2s ease-in-out infinite}
  .sprite.mon-chase{filter:drop-shadow(0 0 6px rgba(255,80,80,.65))}
  .sprite.play{animation-timing-function:steps(var(--frames));animation-iteration-count:infinite;animation-name:var(--anim-name);animation-duration:var(--dur,800ms)}
  .sprite.play-once{animation-timing-function:steps(var(--frames));animation-iteration-count:1;animation-fill-mode:forwards;animation-name:var(--anim-name);animation-duration:var(--dur,600ms)}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

// 동적 @keyframes 등록(X축만 이동)
function registerSpriteAnim(frameWidth, frames) {
  const animName = `spr_${frameWidth}x${frames}_${Math.random().toString(36).slice(2)}`;
  const totalX = -(frameWidth * frames);
  const css = `@keyframes ${animName}{from{background-position:0 0}to{background-position:${totalX}px 0}}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return animName;
}

function createMonsterSpriteDOM(cfg) {
  const el = document.createElement('div');
  el.className = 'sprite mon-bob';
  el.style.setProperty('--fw', `${cfg.frameW}px`);
  el.style.setProperty('--fh', `${cfg.frameH}px`);

  // 행 오프셋(동일 시트에서 row 분리 시 사용, px)
  const walkOffsetY = Number(cfg.walkOffsetY ?? 0);
  const atkOffsetY  = Number(cfg.atkOffsetY  ?? 0);

  const walkAnim = registerSpriteAnim(cfg.frameW, cfg.walkFrames);
  const atkAnim  = registerSpriteAnim(cfg.frameW, cfg.atkFrames);

  el._sprite = {
    cfg, walkAnim, atkAnim,
    state:'walk', facing:0,
    rotOffset:(cfg.rotOffset||0),
    walkOffsetY, atkOffsetY
  };
  setMonsterSpriteState(el, 'walk');
  return el;
}

function setMonsterSpriteState(el, next) {
  if (!el || !el._sprite) return;
  const s = el._sprite;
  if (s.state === next) return;

  if (next === 'walk') {
    el.classList.remove('play-once');
    el.classList.add('play');
    el.style.setProperty('--img', `url(${s.cfg.walkImg})`);
    el.style.setProperty('--frames', s.cfg.walkFrames);
    el.style.setProperty('--anim-name', s.walkAnim);
    el.style.setProperty('--dur', `${Math.round(1000 * (s.cfg.walkFrames / s.cfg.walkFps))}ms`);
    // Y 오프셋 적용
    el.style.backgroundPositionY = `-${s.walkOffsetY}px`;
    el.style.backgroundPositionX = `0px`;
  } else if (next === 'attack') {
    el.classList.remove('play');
    el.classList.add('play-once');
    el.style.setProperty('--img', `url(${s.cfg.atkImg})`);
    el.style.setProperty('--frames', s.cfg.atkFrames);
    el.style.setProperty('--anim-name', s.atkAnim);
    el.style.setProperty('--dur', `${Math.round(1000 * (s.cfg.atkFrames / s.cfg.atkFps))}ms`);
    // Y 오프셋 적용
    el.style.backgroundPositionY = `-${s.atkOffsetY}px`;
    el.style.backgroundPositionX = `0px`;
    const onEnd = () => { el.removeEventListener('animationend', onEnd); setMonsterSpriteState(el, 'walk'); };
    el.addEventListener('animationend', onEnd, { once:true });
  }
  s.state = next;
}

function rotateSprite(el, bearingDeg) {
  if (!el || !el._sprite) return;
  const deg = bearingDeg + (el._sprite.rotOffset || 0);
  el.style.transform = `rotate(${deg}deg)`;
}
function updateSpriteFacingFromMove(el, prevLat, prevLon, nextLat, nextLon) {
  if (!el) return;
  const dy = nextLat - prevLat, dx = nextLon - prevLon;
  if (dx === 0 && dy === 0) return;
  const rad = Math.atan2(dy, dx);
  const deg = rad * 180 / Math.PI; // 0=동쪽
  rotateSprite(el, deg);
}

/* 투사체(몬스터/벙커 공통) */
function fireArrow(map, from, targetLat, targetLon, durationMs=800){
  const start = { lat: from.lat, lon: from.lon };
  const end   = { lat: targetLat,  lon: targetLon };
  const marker = L.marker([start.lat, start.lon], { icon: arrowIcon, interactive:false }).addTo(map);

  const begin = Date.now();
  const timer = setInterval(()=>{
    const t = Math.min(1, (Date.now() - begin) / durationMs);
    const lat = start.lat + (end.lat - start.lat) * t;
    const lon = start.lon + (end.lon - start.lon) * t;
    marker.setLatLng([lat, lon]);

    if (t >= 1) {
      clearInterval(timer);
      const u = map.userMarker?.getLatLng();
      if (u){
        const dist = getDistance(lat, lon, u.lat, u.lng);
        if (dist <= 2){
          if (soundOn) failureSound.play().catch(()=>{});
          pauseFor(5000, '💥 Monster hit — GP paused 5s');
        } else {
          showEvent('reward', '💨 Attack missed', 0);
        }
      }
      map.removeLayer(marker);
    }
  }, 30);
}

/* Init */
async function initialize(){
  await ensureUserDoc();

  const map=L.map('map',{maxZoom:22}).setView([41.6955932,44.8357820],19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  eventToast=document.getElementById('eventToast');
  eventList =document.getElementById('eventList');

  /* ───────── Monsters: 배회/공격 속성 포함 ───────── */
  const monsters=[];
  (await getDocs(collection(db,'monsters'))).forEach(s=>{
    const d=s.data();

    // 기본 속성/상태
    d.marker=null; d.caught=false; d._busy=false;
    d.angryUntil=0; d.follower=null;

    d.baseLat = Number(d.lat);
    d.baseLon = Number(d.lon);
    d.lat = d.baseLat; d.lon = d.baseLon;

    d.patrolRadius     = Number(d.patrolRadius ?? 8);   // m
    d.speed            = Number(d.speed ?? 1.2);        // m/s
    d.aggroRange       = Number(d.aggroRange ?? 12);    // m
    d.attackRange      = Number(d.attackRange ?? 6);    // m
    d.attackCooldownMs = Number(d.attackCooldownMs ?? 3000);
    d.attackType       = (d.attackType || 'melee');     // 'melee' | 'projectile'
    d.lastAttack       = 0;

    // 스프라이트(선택 필드, 없으면 기본)
    d.walkImg    = d.walkImg    || '../sprites/monster_spritesheet_80x80_walk6_attack4.png';
    d.walkFrames = Number(d.walkFrames ?? 6);
    d.walkFps    = Number(d.walkFps ?? 8);
    d.atkImg     = d.atkImg     || '../sprites/monster_spritesheet_80x80_walk6_attack4.png';
    d.atkFrames  = Number(d.atkFrames ?? 4);
    d.atkFps     = Number(d.atkFps ?? 10);
    d.frameW     = Number(d.frameW ?? 80);
    d.frameH     = Number(d.frameH ?? 80);
    d.rotOffset  = Number(d.rotOffset ?? 0); // 시트 기본 바라보는 방향 보정(예:+90)
    d.walkOffsetY= Number(d.walkOffsetY ?? 0);
    d.atkOffsetY = Number(d.atkOffsetY  ?? d.frameH); // 같은 시트 2행을 기본 가정

    d.state = 'patrol'; // 'patrol' | 'chase' | 'idle'
    d.patrolTarget = randInCircleMeters(d.baseLat, d.baseLon, d.patrolRadius);

    monsters.push(d);
  });

  /* ───────── Bunkers ───────── */
  const bunkers=[];
  try{
    const bq = await getDocs(collection(db,'bunkers'));
    if (!bq.empty){
      bq.forEach(s=>{
        const b = s.data();
        bunkers.push({
          lat: Number(b.lat), lon: Number(b.lon),
          range: Number(b.range ?? 5),
          cooldownMs: Number(b.cooldownMs ?? 4000),
          arrowSpeed: Number(b.arrowSpeed ?? 40),
          lastShot: 0,
          marker: null
        });
      });
    }
  }catch(e){
    console.warn('bunkers collection read failed, using demo bunkers', e);
  }
  if (bunkers.length===0){
    bunkers.push(
      { lat:41.69560, lon:44.83578, range:5, cooldownMs:4000, arrowSpeed:40, lastShot:0, marker:null },
      { lat:41.69565, lon:44.83583, range:5, cooldownMs:4000, arrowSpeed:40, lastShot:0, marker:null }
    );
  }

  // 벙커 표시
  bunkers.forEach(b=>{
    b.marker = L.marker([b.lat, b.lon], { icon: bunkerIcon })
      .addTo(map)
      .bindPopup('🏰 Bunker');
    const rCircle = L.circle([b.lat, b.lon], { radius: b.range, color:'#ff3b30', fillOpacity:0.08 });
    rCircle.addTo(map);
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

  // 몬스터 마커 생성(스프라이트 DivIcon)
  function ensureMonsterMarker(m){
    if (m.marker) return;

    const cfg = {
      walkImg: m.walkImg, walkFrames: m.walkFrames, walkFps: m.walkFps,
      atkImg: m.atkImg,   atkFrames: m.atkFrames,   atkFps: m.atkFps,
      frameW: m.frameW,   frameH: m.frameH,         rotOffset: m.rotOffset,
      walkOffsetY: m.walkOffsetY, atkOffsetY: m.atkOffsetY
    };
    const sprEl = createMonsterSpriteDOM(cfg);
    if (m.state === 'chase') sprEl.classList.add('mon-chase');

    // Leaflet divIcon 은 문자열 HTML 필요
    const icon = L.divIcon({
      className: '',
      html: sprEl.outerHTML,
      iconSize: [cfg.frameW, cfg.frameH],
      iconAnchor: [cfg.frameW/2, cfg.frameH/2]
    });

    m.marker = L.marker([m.lat, m.lon], { icon }).addTo(map);

    // 렌더된 실제 DOM에서 스프라이트 다시 찾기
    const root = m.marker.getElement();
    m._spr = root ? root.querySelector('.sprite') : null;

    // 클릭 전투
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
        if (await isCaught(m.mid)) {
          showEvent('lost','Monsters already caught',0);
          if(soundOn) failureSound.play().catch(()=>{});
          m.caught=true;
          if(m.marker){ map.removeLayer(m.marker); m.marker=null; }
        } else {
          const passed = await tapChallenge(m.mid);
          if (!passed) {
            if (soundOn) failureSound.play().catch(()=>{});
            showEvent('lost', 'Not enough hits', 0);
            m.angryUntil = Date.now() + 60_000;
            m._busy=false;
            return;
          }

          const enemyP = getEnemyPower(m);
          const myP    = getMyPower();
          const pWin   = winProbability(myP, enemyP);
          const { minR, maxR } = rewardRange(myP, enemyP);

          const success = Math.random() < pWin;
          const reward  = success ? (minR + Math.floor(Math.random() * (maxR - minR + 1))) : 0;

          if (success) {
            const u = map.userMarker?.getLatLng();
            await awardGP(reward, u?.lat ?? m.lat, u?.lng ?? m.lon, Math.round(totalDistanceM));
            await setCaught(m.mid);

            if(soundOn) successSound.play().catch(()=>{});
            showEvent('reward', `+${reward} GP (DEMO Hunt: my ${myP} vs ${enemyP})`, reward);
            m.caught = true;
            if(m.marker){ map.removeLayer(m.marker); m.marker=null; }
          } else {
            if(soundOn) failureSound.play().catch(()=>{});
            showEvent('lost', `Failed (DEMO Hunt: my ${myP} vs ${enemyP})`, 0);
          }
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

    /* 벙커 사격 */
    const now = Date.now();
    bunkers.forEach(b=>{
      const dist = getDistance(lat,lon,b.lat,b.lon);
      if (dist <= b.range){
        if (now - (b.lastShot||0) >= (b.cooldownMs||4000)){
          b.lastShot = now;
          if (soundOn) clickSound.play().catch(()=>{});
          showEvent('lost', '🏹 Bunker fired!', 0);
          const durationMs = Math.max(300, Math.min(1800, (dist / (b.arrowSpeed||40)) * 1000));
          fireArrow(map, {lat:b.lat, lon:b.lon}, lat, lon, durationMs);
        }
      }
    });

    // 경로/적립
    if(lastLat!==null && lastLon!==null){
      if(step>0 && step<200){
        pathLatLngs.push([lat,lon]); pathLine.setLatLngs(pathLatLngs);
        if(isGPActive()){
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
          await persistToChainOnEachKm(totalDistanceM);
        }
      }
    }else{
      pathLatLngs.push([lat,lon]); pathLine.setLatLngs(pathLatLngs);
    }

    // Angry followers: 상태 갱신
    monsters.forEach(m=>{
      if (m.angryUntil && now < m.angryUntil) m.state = 'chase';
      else if (m.angryUntil && now >= m.angryUntil) {
        m.angryUntil = 0;
        showEvent('reward', `😌 Monster #${m.mid} calmed down`, 0);
      }
    });

    lastLat=lat; lastLon=lon; lastTs=ts;
  }, err=>console.error(err), {enableHighAccuracy:true});

  // ─────────── 배회/추격/공격 애니메이션 틱 ───────────
  let lastTick = Date.now();
  setInterval(()=>{
    const now = Date.now();
    const dt = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;

    const u = map.userMarker?.getLatLng();
    const userLat = u?.lat, userLon = u?.lng;

    monsters.forEach(m=>{
      if (m.caught) {
        if (m.marker){ map.removeLayer(m.marker); m.marker=null; }
        return;
      }

      // 플레이어와의 거리
      let distToUser = Infinity;
      if (userLat!=null) distToUser = getDistance(m.lat, m.lon, userLat, userLon);

      // 스폰/제거(표시 범위)
      if (distToUser <= 40) ensureMonsterMarker(m);
      if (distToUser > 50 && m.marker && !m._busy) { map.removeLayer(m.marker); m.marker=null; }

      // 상태 결정(Angry 우선)
      const angry = m.angryUntil && now < m.angryUntil;
      if (angry) m.state = 'chase';
      else {
        if (distToUser <= m.aggroRange) m.state = 'chase';
        else if (m.state !== 'patrol')  m.state = 'patrol';
      }

      // 이동/공격
      const speed = m.speed;
      let prevPos = null;
      if (m.marker) prevPos = m.marker.getLatLng();

      if (m.state === 'patrol') {
        const toTarget = getDistance(m.lat, m.lon, m.patrolTarget.lat, m.patrolTarget.lon);
        if (toTarget < 1) {
          m.patrolTarget = randInCircleMeters(m.baseLat, m.baseLon, m.patrolRadius);
        } else {
          const step = stepTowards(m.lat, m.lon, m.patrolTarget.lat, m.patrolTarget.lon, speed*dt);
          m.lat = step.lat; m.lon = step.lon;
        }
      } else if (m.state === 'chase' && userLat!=null) {
        const step = stepTowards(m.lat, m.lon, userLat, userLon, speed*dt*1.5);
        m.lat = step.lat; m.lon = step.lon;

        // 공격 조건
        if (distToUser <= m.attackRange && (now - (m.lastAttack||0) >= m.attackCooldownMs)) {
          m.lastAttack = now;
          m._didAttackThisTick = true; // 스프라이트 공격 애니 트리거
          if (m.attackType === 'projectile') {
            const dur = Math.max(300, Math.min(1500, (distToUser/20)*1000));
            fireArrow(map, {lat:m.lat, lon:m.lon}, userLat, userLon, dur);
            showEvent('lost', `💢 Monster #${m.mid} shoots!`, 0);
          } else {
            if (soundOn) failureSound.play().catch(()=>{});
            pauseFor(5000, `💥 Monster #${m.mid} hit — GP paused 5s`);
          }
        }
      }

      // 마커 위치 & 스프라이트 업데이트
      if (m.marker) {
        m.marker.setLatLng([m.lat, m.lon]);
        if (m._spr && prevPos) {
          updateSpriteFacingFromMove(m._spr, prevPos.lat, prevPos.lng, m.lat, m.lon);
          if (m.state === 'chase') m._spr.classList.add('mon-chase'); else m._spr.classList.remove('mon-chase');
          if (m._didAttackThisTick) { setMonsterSpriteState(m._spr, 'attack'); m._didAttackThisTick = false; }
        }
      }
    });

  }, 100);

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
