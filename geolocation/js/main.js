// main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { TowerGuard } from "./tower.js";
import { Score } from "./score.js";
import { WalkPoints } from "./walk.js";

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

/* ===== 스타일 주입(몬스터/플레이어/HUD/토스트/스타트게이트) ===== */
(function injectCSS(){
  const css = `
  .mon-wrap{position:relative;}
  .mon-img{
    width:100%; height:100%; display:block; object-fit:contain;
    image-rendering:crisp-edges; image-rendering:pixelated;
    transition:filter .15s ease, opacity .6s ease, transform .6s ease;
  }
  .mon-hit{animation:hitflash .12s steps(1) 2;}
  @keyframes hitflash{50%{filter:brightness(2.2) contrast(1.3) saturate(1.4)}}
  .mon-death{animation:spinout .9s ease forwards;}
  @keyframes spinout{to{opacity:0; transform:rotate(540deg) scale(.1); filter:blur(2px)}}

  /* 플레이어 반짝 */
  .player-emoji{font-size:22px; transition:filter .12s ease}
  .player-hit{ animation: playerflash .22s steps(1) 2; }
  @keyframes playerflash{ 50%{ filter: brightness(2.2) contrast(1.5) } }

  /* HUD & Toast */
  #eventToast{
    position:fixed; top:12px; left:50%; transform:translateX(-50%);
    background:#111827; color:#fff; padding:8px 12px; border-radius:999px;
    display:none; z-index:1001; font-weight:600
  }
  .hud{
    position:fixed; right:12px; top:60px;
    background:rgba(17,24,39,.92); color:#fff; padding:10px 12px;
    border-radius:12px; z-index:1000; min-width:200px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    box-shadow:0 6px 20px rgba(0,0,0,.25);
  }
  .hud .row{display:flex; justify-content:space-between; gap:8px; margin:4px 0;}
  .hud .mono{font-variant-numeric:tabular-nums;}
  .hud .ok{color:#86efac}
  .hud .warn{color:#facc15}

  /* 스타트 게이트 */
  #startGate{
    position:fixed; inset:0; width:100%; height:100%;
    background:#111827; color:#fff; font-size:20px; font-weight:700;
    display:flex; align-items:center; justify-content:center;
    z-index:2000; border:none; cursor:pointer;
  }`;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();

/* ===== 사운드(명확한 성공/실패/타격) ===== */
let audioCtx;
function ensureAudio(){
  audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function applyADSR(g, t, {a=0.01, d=0.12, s=0.4, r=0.25, peak=0.9, sus=0.25}={}){
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t+a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, sus), t+a+d);
  g.gain.setTargetAtTime(0.0001, t+a+d, r);
}
function createNoise(){
  ensureAudio();
  const sr = audioCtx.sampleRate, len = sr * 0.5;
  const buf = audioCtx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i=0;i<len;i++) data[i] = Math.random()*2-1;
  const src = audioCtx.createBufferSource(); src.buffer = buf; src.loop = false; return src;
}
function blip(freq=300, dur=0.07, type='square', startGain=0.35){
  ensureAudio();
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  o.connect(g); g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(startGain, t+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  o.start(t); o.stop(t + dur + 0.03);
}
const playHit = ()=>blip();
function playFail(){
  ensureAudio();
  const t = audioCtx.currentTime;
  const o1 = audioCtx.createOscillator(), o2 = audioCtx.createOscillator();
  const g  = audioCtx.createGain();
  const lp = audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(1200, t);
  o1.type='sawtooth'; o2.type='sawtooth';
  o1.frequency.setValueAtTime(320, t); o2.frequency.setValueAtTime(320*0.98, t);
  o1.frequency.exponentialRampToValueAtTime(70, t+0.7);
  o2.frequency.exponentialRampToValueAtTime(65, t+0.7);
  const nz = createNoise();
  nz.connect(lp);
  o1.connect(g); o2.connect(g); lp.connect(g); g.connect(audioCtx.destination);
  applyADSR(g, t, {a:0.005, d:0.1, s:0.2, r:0.35, peak:0.9, sus:0.15});
  o1.start(t); o2.start(t); nz.start(t);
  o1.stop(t+0.75); o2.stop(t+0.75); nz.stop(t+0.5);
}
function playDeath(){
  ensureAudio();
  const t = audioCtx.currentTime;
  const freqs = [523.25, 659.25, 783.99];
  const groupGain = audioCtx.createGain();
  groupGain.connect(audioCtx.destination);
  groupGain.gain.setValueAtTime(0.0001, t);
  groupGain.gain.exponentialRampToValueAtTime(0.9, t+0.02);
  groupGain.gain.exponentialRampToValueAtTime(0.0001, t+0.6);
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain(); lfo.frequency.setValueAtTime(6, t); lfoGain.gain.setValueAtTime(5, t);
  lfo.connect(lfoGain);
  freqs.forEach((f,i)=>{
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
    lfoGain.connect(o.frequency);
    o.connect(g); g.connect(groupGain);
    applyADSR(g, t + i*0.02, {a:0.01, d:0.12, s:0.5, r:0.25, peak:0.9, sus:0.2});
    o.start(t + i*0.02); o.stop(t + 0.6);
  });
  const nz = createNoise();
  const bp = audioCtx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.setValueAtTime(3500, t); bp.Q.value = 3;
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.35, t+0.02);
  ng.gain.exponentialRampToValueAtTime(0.0001, t+0.25);
  nz.connect(bp); bp.connect(ng); ng.connect(audioCtx.destination);
  nz.start(t); nz.stop(t+0.25);
  lfo.start(t); lfo.stop(t+0.6);
}

/* ===== 간단 토스트 ===== */
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
    <div class="row"><div>이동거리</div><div id="hudDist" class="mono">0 m</div></div>
    <div class="row"><div>블록체인점수</div><div id="hudChain" class="mono">0</div></div>
  `;
  document.body.appendChild(hud);
  return hud;
}
function setHUD({timeLeft=null, hitsLeft=null, earn=null, chain=null, distanceM=null}={}){
  const hud = ensureHUD();
  if (timeLeft!=null)  hud.querySelector('#hudTime').textContent  = timeLeft;
  if (hitsLeft!=null)  hud.querySelector('#hudHits').textContent  = hitsLeft;
  if (earn!=null)      hud.querySelector('#hudEarn').textContent  = `+${earn} GP`;
  if (chain!=null)     hud.querySelector('#hudChain').textContent = chain;
  if (distanceM!=null) hud.querySelector('#hudDist').textContent  = `${Math.round(distanceM)} m`;
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
    iconAnchor: [s/2, s]
  });
}

/* ===== 제한시간 규칙 ===== */
function getChallengeDurationMs(power){
  if (power === 40) return 10_000;
  if (power === 20) return 5_000;
  if (power === 10) return 2_000;
  const sec = Math.max(0.5, power / 4);
  return Math.round(sec * 1000);
}

/* ===== 유틸: 게스트 아이디 ===== */
function getGuestId(){
  let id = localStorage.getItem('guestId');
  if(!id){ id = 'guest-' + Math.random().toString(36).slice(2,8); localStorage.setItem('guestId', id); }
  return id;
}

/* ===== 유틸: 두 점 거리(m) ===== */
function haversineM(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = d => d * Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ===== 메인 ===== */
async function main(){
  /* 점수/에너지 모듈 초기화 */
  await Score.init({ db, getGuestId, toast, playFail });

  // HUD 준비 + Score의 에너지 UI 삽입
  Score.attachToHUD(ensureHUD());
  setHUD({ chain: Score.getChainTotal() });
  Score.updateEnergyUI();
  Score.wireRespawn();

  /* 지도 */
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

  // 플레이어 마커
  const playerIcon = L.divIcon({
    className:'', html:'<div class="player-emoji">🧍</div>', iconSize:[22,22], iconAnchor:[11,11]
  });
  const playerMarker = L.marker([userLat,userLon],{icon:playerIcon}).addTo(map);
  map.setView([userLat,userLon], 19);

  function flashPlayer(){
    const el = playerMarker.getElement();
    if (!el) return;
    const e = el.querySelector('.player-emoji');
    if (!e) return;
    e.classList.remove('player-hit'); void e.offsetWidth;
    e.classList.add('player-hit');
  }

  /* 이동 경로(Polyline) & 이동거리 HUD */
  const walkPath = L.polyline([[userLat,userLon]], { weight: 3, opacity: 0.9 }).addTo(map);
  let lastLat = userLat, lastLon = userLon;
  let totalWalkedM = Number(localStorage.getItem('ui_total_walk_m') || 0);
  setHUD({ distanceM: totalWalkedM });

  if (navigator.geolocation){
    navigator.geolocation.watchPosition(p=>{
      userLat=p.coords.latitude; userLon=p.coords.longitude;
      playerMarker.setLatLng([userLat,userLon]);

      // 경로 & 거리
      walkPath.addLatLng([userLat, userLon]);
      if (Number.isFinite(lastLat) && Number.isFinite(lastLon)){
        const seg = haversineM(lastLat, lastLon, userLat, userLon);
        if (seg >= 0.5){
          totalWalkedM += seg;
          localStorage.setItem('ui_total_walk_m', String(totalWalkedM));
          setHUD({ distanceM: totalWalkedM });
        }
      }
      lastLat = userLat; lastLon = userLon;
    },()=>{}, {enableHighAccuracy:true});
  }

  /* 걷기 적립 시작 (10m당 1점, 차량 필터) */
  const walker = new WalkPoints({ toast });
  walker.start();
  window.addEventListener('pagehide', ()=> walker?.stop());

  /* 스타트 게이트: 탭하면 오디오/타워 시작 */
  let towers;
  addStartGate(() => {
    try { ensureAudio(); } catch {}
    try { towers?.setUserReady(true); } catch {}
  });

  /* 망루(타워) 초기화 */
  const IS_ADMIN = location.search.includes('admin=1') || localStorage.getItem('isAdmin') === '1';
  towers = new TowerGuard({
    map,
    db,
    iconUrl: "https://puppi.netlify.app/images/mon/tower.png",
    rangeDefault: 60,
    fireCooldownMs: 1500,
    getUserLatLng: ()=>[userLat, userLon],
    onUserHit: (damage, towerInfo)=>{
      flashPlayer();
      Score.deductGP(damage, towerInfo.lat, towerInfo.lon);
    },
    isAdmin: IS_ADMIN
  });

  // 첫 포인터 시 오디오 재개
  window.addEventListener('pointerdown', ()=>{
    try { ensureAudio(); } catch {}
    try { towers.resumeAudio(); } catch {}
  }, { once:true, passive:true });

  /* 몬스터 로드 */
  const monsters=[];
  try{
    const qs = await getDocs(collection(db,'monsters'));
    qs.forEach(s=>{
      const d=s.data();
      const sizePx = (()=>{ const n = Number(d.size); return Number.isNaN(n) ? DEFAULT_ICON_PX : Math.max(24, Math.min(n, 256)); })();
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
    monsters.push({ id:'test', mid:23, lat:userLat, lon:userLon, url:DEFAULT_IMG, size:96, power:20 });
  }

  /* 배치 + 시간내 N타 전투 */
  monsters.forEach(m=>{
    const icon = makeImageDivIcon(m.url, m.size);
    const marker = L.marker([m.lat, m.lon], { icon, interactive: true }).addTo(map);

    let chal = null; // {remain, deadline, timer}
    let imgEl = null;

    function getImg(){
      if (imgEl && document.body.contains(imgEl)) return imgEl;
      const root = marker.getElement();
      imgEl = root ? root.querySelector('.mon-img') : null;
      return imgEl;
    }
    function stopChallenge(){
      if (chal?.timer){ clearInterval(chal.timer); }
      chal = null;
      setHUD({ timeLeft:'-', hitsLeft:'-', earn:m.power, chain: Score.getChainTotal() });
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

      const distM = Math.round(Score.getStats().totalDistanceM);
      await Score.awardGP(m.power, m.lat, m.lon, distM);
      Score.updateEnergyUI();

      const tx = await Score.saveToChainMock(m.power);
      setHUD({ chain: tx.total });
      toast(`+${m.power} GP! (tx: ${tx.txHash.slice(0,10)}…)`);

      setTimeout(()=>{ try{ map.removeLayer(marker); }catch{}; }, 900);
    }

    function fail(){
      stopChallenge();
      playFail();
      toast('실패… 다시 시도하세요');
    }

    marker.on('click', async ()=>{
      ensureAudio();
      const el = getImg();
      if (el){ el.classList.remove('mon-hit'); void el.offsetWidth; el.classList.add('mon-hit'); }
      playHit();

      if (!chal){
        const durationMs = getChallengeDurationMs(m.power);
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

      if (Date.now() >= chal.deadline){ fail(); return; }
      chal.remain -= 1;
      if (chal.remain <= 0) { await win(); }
      else { updateHUD(); }
    });
  });
}

/* ===== 스타트 게이트(탭해서 시작) ===== */
function addStartGate(onStart){
  if (document.getElementById('startGate')) return;
  const btn = document.createElement('button');
  btn.id = 'startGate';
  btn.textContent = '탭해서 시작';
  document.body.appendChild(btn);
  const kick = ()=>{
    try { onStart?.(); } catch {}
    btn.remove();
  };
  btn.addEventListener('pointerdown', kick, { once:true });
  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'visible') { try { ensureAudio(); } catch {} }
  });
}

main();
