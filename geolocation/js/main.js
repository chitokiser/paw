import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, getDoc, setDoc,
  updateDoc, increment, serverTimestamp, doc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { TowerGuard } from "./tower.js";

/* ===== 기본 설정 ===== */
const DEFAULT_ICON_PX = 96;
const DEFAULT_IMG = "https://puppi.netlify.app/images/mon/1.png";

/* ===== Firebase ===== */
const app = initializeApp({
  apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.appspot.com",
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
});
const db = getFirestore(app);

/* ===== 스타일 주입(히트 플래시/처치 애니메이션/HUD/토스트) ===== */
(function injectCSS(){
  const css = `
  .mon-wrap{position:relative;}
  .mon-img{
    width:100%;
    height:100%;
    display:block;
    object-fit:contain;
    image-rendering:crisp-edges;
    image-rendering:pixelated;
    transition:filter .15s ease, opacity .6s ease, transform .6s ease;
  }
  .mon-hit{animation:hitflash .12s steps(1) 2;}
  @keyframes hitflash{50%{filter:brightness(2.2) contrast(1.3) saturate(1.4)}}
  .mon-death{animation:spinout .9s ease forwards;}
  @keyframes spinout{to{opacity:0; transform:rotate(540deg) scale(.1); filter:blur(2px)}}

  #eventToast{
    position:fixed; top:12px; left:50%; transform:translateX(-50%);
    background:#111827; color:#fff; padding:8px 12px; border-radius:999px;
    display:none; z-index:1001; font-weight:600
  }

  .hud{
    position:fixed; right:12px; top:60px;
    background:rgba(17,24,39,.92); color:#fff; padding:10px 12px;
    border-radius:12px; z-index:1000; min-width:180px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    box-shadow:0 6px 20px rgba(0,0,0,.25);
  }
  .hud .row{display:flex; justify-content:space-between; gap:8px; margin:4px 0;}
  .hud .mono{font-variant-numeric:tabular-nums;}
  .hud .big{font-size:18px; font-weight:700;}
  .hud .ok{color:#86efac}
  .hud .warn{color:#facc15}
  `;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();

/* ===== 사운드 ===== */
/* ===== 사운드(명확한 성공/실패) ===== */
let audioCtx;
function ensureAudio(){
  audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

/* 공용: 간단 ADSR */
function applyADSR(g, t, {a=0.01, d=0.12, s=0.4, r=0.25, peak=0.9, sus=0.25}={}){
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);                // Attack
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, sus), t+a+d); // Decay→Sustain
  g.gain.setTargetAtTime(0.0001, t+a+d, r);                         // Release
}

/* 공용: 노이즈 소스 (buffer white noise) */
function createNoise(){
  const sr = audioCtx.sampleRate;
  const len = sr * 0.5;
  const buf = audioCtx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i=0;i<len;i++) data[i] = Math.random()*2-1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = false;
  return src;
}

/* 타격: 짧은 클릭+삐 소리 */
function blip(freq=260, dur=0.08, type='square', startGain=0.35){
  ensureAudio();
  const t = audioCtx.currentTime;

  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();

  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(g); g.connect(audioCtx.destination);

  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(startGain, t+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);

  o.start(t); o.stop(t + dur + 0.03);
}
const playHit = ()=>blip(300, 0.07, 'square', 0.35);

/* 실패: 하강 버저 + 거친 노이즈 (명확한 패배감) */
function playFail(){
  ensureAudio();
  const t = audioCtx.currentTime;

  // 듀얼 사와스 + 살짝 디튠
  const o1 = audioCtx.createOscillator();
  const o2 = audioCtx.createOscillator();
  const g  = audioCtx.createGain();
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(1200, t);

  o1.type='sawtooth'; o2.type='sawtooth';
  o1.frequency.setValueAtTime(320, t);
  o2.frequency.setValueAtTime(320*0.98, t);
  // 내려가는 피치
  o1.frequency.exponentialRampToValueAtTime(70,  t+0.7);
  o2.frequency.exponentialRampToValueAtTime(65,  t+0.7);

  // 노이즈 섞기(거친 감)
  const nz = createNoise();
  const nzGain = audioCtx.createGain();
  nzGain.gain.setValueAtTime(0.15, t);
  nz.connect(lp);

  // 믹스
  o1.connect(g); o2.connect(g);
  lp.connect(g);
  g.connect(audioCtx.destination);

  // ADSR (느낌을 확실히)
  applyADSR(g, t, {a:0.005, d:0.1, s:0.2, r:0.35, peak:0.9, sus:0.15});

  o1.start(t); o2.start(t);
  nz.start(t);
  o1.stop(t+0.75); o2.stop(t+0.75);
  nz.stop(t+0.5);
}

/* 성공(처치): 밝은 트라이애드+스파클 (명확한 승리감) */
function playDeath(){
  ensureAudio();
  const t = audioCtx.currentTime;

  // C5(523), E5(659), G5(784) 트라이애드
  const freqs = [523.25, 659.25, 783.99];
  const groupGain = audioCtx.createGain();
  groupGain.connect(audioCtx.destination);
  groupGain.gain.setValueAtTime(0.0001, t);
  groupGain.gain.exponentialRampToValueAtTime(0.9, t+0.02);
  groupGain.gain.exponentialRampToValueAtTime(0.0001, t+0.6);

  // 각 음에 약간의 비브라토
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.setValueAtTime(6, t);     // 6Hz
  lfoGain.gain.setValueAtTime(5, t);      // ±5Hz
  lfo.connect(lfoGain);

  freqs.forEach((f,i)=>{
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);

    // 비브라토 적용
    lfoGain.connect(o.frequency);

    o.connect(g); g.connect(groupGain);
    applyADSR(g, t + i*0.02, {a:0.01, d:0.12, s:0.5, r:0.25, peak:0.9, sus:0.2});
    o.start(t + i*0.02);
    o.stop(t + 0.6);
  });

  // 스파클 노이즈(밝은 반짝)
  const nz = createNoise();
  const bp = audioCtx.createBiquadFilter(); bp.type='bandpass';
  bp.frequency.setValueAtTime(3500, t);
  bp.Q.value = 3;
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.35, t+0.02);
  ng.gain.exponentialRampToValueAtTime(0.0001, t+0.25);
  nz.connect(bp); bp.connect(ng); ng.connect(audioCtx.destination);
  nz.start(t); nz.stop(t+0.25);

  // LFO 수명
  lfo.start(t); lfo.stop(t+0.6);
}


/* ===== 유틸/유저 & 포인트 ===== */
function getGuestId(){
  let id = localStorage.getItem('guestId');
  if(!id){ id = 'guest-' + Math.random().toString(36).slice(2,8); localStorage.setItem('guestId', id); }
  return id;
}
const userStats = { totalDistanceM:0, totalGP:0 };
async function ensureUserDoc(){
  const uid = getGuestId();
  await setDoc(doc(db,'users',uid),{ address:uid, updatedAt:serverTimestamp() },{merge:true});
  const snap = await getDoc(doc(db,'users',uid));
  if (snap.exists()){
    const d=snap.data(); userStats.totalDistanceM=Number(d.totalDistanceM||0); userStats.totalGP=Number(d.totalGP||0);
  }
}
async function awardGP(gpUnits, lat, lon, totalDistanceM){
  if(gpUnits<=0) return;
  const uid=getGuestId();
  await addDoc(collection(db,'walk_logs'),{
    address:uid, gp:gpUnits, metersCounted:gpUnits*10, lat, lon, totalDistanceM, createdAt:serverTimestamp()
  });
  await updateDoc(doc(db,'users',uid),{
    totalGP:increment(gpUnits), totalDistanceM:increment(gpUnits*10), updatedAt:serverTimestamp()
  });
  userStats.totalGP += gpUnits; userStats.totalDistanceM += gpUnits*10;
}

async function deductGP(points, fromLat, fromLon){
  // points는 양수로 넣으면 해당 수치만큼 차감합니다.
  if(points<=0) return;
  const uid = getGuestId();
  await addDoc(collection(db,'tower_hits'),{
    address: uid, gp: -points, fromLat, fromLon, createdAt: serverTimestamp()
  });
  await updateDoc(doc(db,'users',uid),{
    totalGP: increment(-points), updatedAt: serverTimestamp()
  });
  userStats.totalGP -= points;
  setHUD({ total: userStats.totalGP });
  toast(`-${points} GP (망루)`);
  // 명확한 피격 사운드
  if (typeof playFail === 'function') playFail();
}


/* ===== 온체인 누적(모의) ===== */
function getChainTotal(){ return Number(localStorage.getItem('chainTotal')||0); }
function setChainTotal(v){ localStorage.setItem('chainTotal', String(v)); }
async function saveToChainMock(delta){
  const before=getChainTotal(); const after=before+delta; setChainTotal(after);
  const tx = '0x'+Math.random().toString(16).slice(2,10)+Math.random().toString(16).slice(2,10);
  return { txHash: tx, total: after };
}

/* ===== 토스트 ===== */
function toast(msg){
  let t=document.getElementById('eventToast');
  if(!t){ t=document.createElement('div'); t.id='eventToast'; document.body.appendChild(t); }
  t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',1100);
}

/* ===== HUD ===== */
function ensureHUD(){
  let hud = document.querySelector('.hud');
  if (hud) return hud;
  hud = document.createElement('div');
  hud.className='hud';
  hud.innerHTML = `
    <div class="row"><div>남은 시간</div><div id="hudTime" class="mono warn">-</div></div>
    <div class="row"><div>남은 타격</div><div id="hudHits" class="mono ok">-</div></div>
    <div class="row"><div>이번 보상</div><div id="hudEarn" class="mono">-</div></div>
    <div class="row"><div>총 점수</div><div id="hudTotal" class="mono big">0</div></div>
    <div class="row"><div>블록체인점수</div><div id="hudChain" class="mono">0</div></div>
  `;
  document.body.appendChild(hud);
  return hud;
}
function setHUD({timeLeft=null, hitsLeft=null, earn=null, total=null, chain=null}={}){
  const hud = ensureHUD();
  if (timeLeft!=null)  hud.querySelector('#hudTime').textContent  = timeLeft;
  if (hitsLeft!=null)  hud.querySelector('#hudHits').textContent  = hitsLeft;
  if (earn!=null)      hud.querySelector('#hudEarn').textContent  = `+${earn} GP`;
  if (total!=null)     hud.querySelector('#hudTotal').textContent = total;
  if (chain!=null)     hud.querySelector('#hudChain').textContent = chain;
}

/* ===== 아이콘(HTML) ===== */
function makeImageDivIcon(url, sizePx){
  const s = Math.round(Math.max(24, Math.min(Number(sizePx)||DEFAULT_ICON_PX, 256))); // 24~256px
  const html = `
    <div class="mon-wrap" style="width:${s}px; height:${s}px;">
      <img class="mon-img" src="${url||DEFAULT_IMG}" alt="monster"/>
    </div>`;
  return L.divIcon({
    className: '',
    html,
    iconSize: [s, s],
    iconAnchor: [s/2, s] // 바닥 중앙
  });
}

/* ===== 제한시간 규칙 =====
   파워 40 → 10초, 20 → 5초, 10 → 2초, 그 외엔 power/4초(최소 0.5초) */
function getChallengeDurationMs(power){
  if (power === 40) return 10_000;
  if (power === 20) return 5_000;
  if (power === 10) return 2_000;
  const sec = Math.max(0.5, power / 4);
  return Math.round(sec * 1000);
}

/* ===== 메인 ===== */
async function main(){
  await ensureUserDoc();
  setHUD({ total: userStats.totalGP, chain: getChainTotal() });

  const map = L.map('map',{maxZoom:22}).setView([37.5665,126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  // 현재 위치
  let userLat=null, userLon=null;
  await new Promise((res)=>{
    if (!navigator.geolocation){ res(); return; }
    navigator.geolocation.getCurrentPosition(
      p=>{ userLat=p.coords.latitude; userLon=p.coords.longitude; res(); },
      ()=>res(), {enableHighAccuracy:true, timeout:7000}
    );
  });
  if (userLat==null){ userLat=37.5665; userLon=126.9780; }
  const player = L.divIcon({ className:'', html:'<div style="font-size:22px">🧍</div>', iconSize:[22,22], iconAnchor:[11,11] });
  const playerMarker = L.marker([userLat,userLon],{icon:player}).addTo(map).bindPopup(getGuestId());
  map.setView([userLat,userLon], 19);
  // ... playerMarker, watchPosition 설정 코드 아래쪽에 배치
const IS_ADMIN = location.search.includes('admin=1') || localStorage.getItem('isAdmin') === '1';

const towers = new TowerGuard({
  map,
  db,
  iconUrl: "https://puppi.netlify.app/images/mon/tower.png",
  rangeDefault: 60,          // 기본 사거리(m) — 필요 시 조정
  fireCooldownMs: 1500,      // 발사 간격 — 필요 시 조정
  getUserLatLng: ()=>[userLat, userLon],
  onUserHit: (damage, towerInfo)=>{
    // damage=1 고정, towerInfo: {lat, lon, range, ...}
    deductGP(damage, towerInfo.lat, towerInfo.lon);
  },
  isAdmin: IS_ADMIN
});

  /* 몬스터 로드 */
  const monsters=[];
  try{
    const qs = await getDocs(collection(db,'monsters'));
    qs.forEach(s=>{
      const d=s.data();
      const sizePx = (()=>{                 // DB size 안전 파싱
        const n = Number(d.size);
        if (Number.isNaN(n)) return DEFAULT_ICON_PX;
        return Math.max(24, Math.min(n, 256));
      })();

      monsters.push({
        id: s.id,
        mid: Number(d.mid),
        lat: Number(d.lat),
        lon: Number(d.lon),
        url: d.imagesURL || d.imageURL || d.iconURL || DEFAULT_IMG,
        size: sizePx,
        power: Math.max(1, Number(d.power ?? 20))
      });
    });
  }catch(e){ console.warn('monsters load fail:', e); }

  if (monsters.length===0){
    // 데이터 없을 때 임시 배치
    monsters.push({ id:'test', mid:23, lat:userLat, lon:userLon, url:DEFAULT_IMG, size:96, power:20 });
  }

  /* 배치 + 시간내 N타 전투 */
  monsters.forEach(m=>{
    const icon = makeImageDivIcon(m.url, m.size);
    const marker = L.marker([m.lat, m.lon], { icon, interactive: true }).addTo(map);


    let chal = null; // {remain, deadline, timer}
    let imgEl = null;

    function getImg(){
      // marker.element는 add 직후엔 null일 수 있으므로 매번 갱신 시도
      if (imgEl && document.body.contains(imgEl)) return imgEl;
      const root = marker.getElement();
      imgEl = root ? root.querySelector('.mon-img') : null;
      return imgEl;
    }
    function stopChallenge(){
      if (chal?.timer){ clearInterval(chal.timer); }
      chal = null;
      setHUD({ timeLeft:'-', hitsLeft:'-', earn:m.power, total:userStats.totalGP, chain:getChainTotal() });
    }
    function updateHUD(){
      if (!chal) return;
      const leftMs = Math.max(0, chal.deadline - Date.now());
      const left = (leftMs/1000).toFixed(1) + 's';
      setHUD({ timeLeft:left, hitsLeft: chal.remain, earn: m.power });
    }

    async function win(){
      stopChallenge();
      const el = getImg();
      if (el){ el.classList.add('mon-death'); }
      playDeath();

      await awardGP(m.power, m.lat, m.lon, Math.round(userStats.totalDistanceM));
      setHUD({ total: userStats.totalGP });

      const tx = await saveToChainMock(m.power);
      setHUD({ chain: tx.total });
      toast(`+${m.power} GP! (tx: ${tx.txHash.slice(0,10)}…)`);

      setTimeout(()=>{ try{ map.removeLayer(marker); }catch{}; }, 900);
    }

    function fail(){
      stopChallenge();
      playFail();
      toast('실패… 다시 시도하세요');
    }

    // 첫 클릭 = 챌린지 시작, 진행 중이면 타격 카운트
    marker.on('click', async ()=>{
      ensureAudio();

      // 히트 플래시
      const el = getImg();
      if (el){ el.classList.remove('mon-hit'); void el.offsetWidth; el.classList.add('mon-hit'); }
      playHit();

      // 챌린지 시작
      if (!chal){
        const durationMs = getChallengeDurationMs(m.power);
        // 요구사항: 파워만큼 타격 → 첫 클릭이 1타이므로 remain = power - 1
        chal = { remain: Math.max(1, m.power) - 1, deadline: Date.now() + durationMs, timer: null };
        updateHUD();
        chal.timer = setInterval(()=>{
          if (!chal) return;
          if (Date.now() >= chal.deadline) fail();
          else updateHUD();
        }, 80);
        if (chal.remain <= 0) { await win(); }
        return;
      }

      // 진행 중 타격
      if (Date.now() >= chal.deadline){ fail(); return; }
      chal.remain -= 1;
      if (chal.remain <= 0) { await win(); }
      else { updateHUD(); }
    });
  });

  // 내 위치 추적
  if (navigator.geolocation){
    navigator.geolocation.watchPosition(p=>{
      userLat=p.coords.latitude; userLon=p.coords.longitude;
      playerMarker.setLatLng([userLat,userLon]);
    },()=>{}, {enableHighAccuracy:true});
  }
}

main();
