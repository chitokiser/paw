// ───────────────── Firebase & 공통 설정 ─────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.appspot.com",
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
};

export const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);

// ───────────────── Demo Identity ─────────────────
function getGuestId(){
  let id = localStorage.getItem('guestId');
  if(!id){
    id = 'guest-' + Math.random().toString(36).slice(2,8);
    localStorage.setItem('guestId', id);
  }
  return id;
}
export const userAddress = getGuestId();

// ───────────────── 사운드 ─────────────────
export const clickSound   = new Audio('/geolocation/sounds/hit.mp3');
export const successSound = new Audio('https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg');
export const failureSound = new Audio('https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg');
export const barkSound    = new Audio('/geolocation/sounds/puppybark.mp3');

export let soundOn = true;
export function toggleSound(){
  soundOn = !soundOn;
  const btn = document.getElementById('soundToggle');
  if (btn) btn.textContent = soundOn ? '🔊' : '🔇';
}

// ───────────────── UI(Toast/로그/토글) ─────────────────
let eventToast, eventList; let totalScore=0;

export function bindUI(){
  eventToast = document.getElementById('eventToast');
  eventList  = document.getElementById('eventList');
  const st = document.getElementById('soundToggle');
  if (st) st.onclick = () => toggleSound();
}

export function showEvent(type, message, reward=0){
  if(!eventToast) eventToast=document.getElementById('eventToast');
  if(!eventList)  eventList =document.getElementById('eventList');
  if(reward>0) totalScore+=reward;

  const msg = `${message} (Total: ${totalScore} GP)`;
  eventToast.className = type;
  eventToast.textContent = msg;
  eventToast.style.display='block';
  setTimeout(()=>eventToast.style.display='none',2000);

  const li = document.createElement('li'); li.textContent = msg;
  eventList.insertBefore(li, eventList.firstChild);
  while(eventList.children.length>12) eventList.removeChild(eventList.lastChild);
}

// ───────────────── 이동/수학 유틸 ─────────────────
export function getDistance(a,b,c,d){
  const R=6371000,t=x=>x*Math.PI/180;
  const φ1=t(a),φ2=t(c),dφ=t(c-a),dλ=t(d-b);
  const A=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));
}

export function stepTowards(lat, lon, tgtLat, tgtLon, meters){
  if (meters<=0) return {lat, lon};
  const dist = getDistance(lat, lon, tgtLat, tgtLon);
  if (dist === 0 || meters >= dist) return {lat: tgtLat, lon: tgtLon};
  const ratio = meters / dist;
  return { lat: lat + (tgtLat - lat) * ratio, lon: lon + (tgtLon - lon) * ratio };
}

export function randInCircleMeters(baseLat, baseLon, radiusM){
  const dLat = (Math.random()*2-1) * radiusM / 111320;
  const dLon = (Math.random()*2-1) * radiusM / (111320 * Math.cos(baseLat*Math.PI/180));
  return {lat: baseLat + dLat, lon: baseLon + dLon};
}

// ───────────────── 속도 필터 상수 ─────────────────
export const SPEED_MIN_WALK=0.2, SPEED_MAX_WALK=2.5, SPEED_VEHICLE=4.0;
export const RESUME_REQUIRE_SLOW_SAMPLES=3, PAUSE_REQUIRE_FAST_SAMPLES=2;

// ───────────────── 일시정지(트랩/피격) ─────────────────
let pausedUntil = 0;
export function pauseFor(ms, reason=''){
  const until = Date.now() + ms;
  if (until > pausedUntil) pausedUntil = until;
  showEvent('lost', reason || `⏱️ GP paused for ${(ms/1000).toFixed(0)}s`, 0);
}
export function isGPActive(pausedBySpeed){
  return !pausedBySpeed && Date.now() >= pausedUntil;
}

// ───────────────── Quick Tap 챌린지 ─────────────────
export async function tapChallenge(mid){
  const idNum = Math.max(1, Number(mid) || 1);
  const windowMs = 500 * idNum;
  const required = Math.max(1, Math.ceil(idNum / 2));

  let ov = document.getElementById('tapOverlay');
  if (!ov){
    ov = document.createElement('div');
    ov.id='tapOverlay';
    Object.assign(ov.style, {position:'fixed',inset:'0',background:'rgba(0,0,0,.55)',zIndex:'9999',
      display:'none',alignItems:'center',justifyContent:'center'});
    const card=document.createElement('div');
    Object.assign(card.style,{width:'min(360px,92%)',background:'#111827',color:'#e5e7eb',
      border:'1px solid rgba(255,255,255,.12)',borderRadius:'16px',padding:'18px',textAlign:'center',
      boxShadow:'0 20px 40px rgba(0,0,0,.35)'});
    const title=document.createElement('h3'); title.textContent='Quick Hit!'; Object.assign(title.style,{margin:'0 0 6px',fontWeight:'800',fontSize:'20px'});
    const desc=document.createElement('p'); desc.id='tapDesc'; Object.assign(desc.style,{margin:'0 0 10px',color:'#93a3b8',fontSize:'14px'});
    const status=document.createElement('div'); status.id='tapStatus'; Object.assign(status.style,{margin:'0 0 12px',fontSize:'14px'});
    const hitBtn=document.createElement('button'); hitBtn.id='tapHitBtn'; hitBtn.textContent='HIT!';
    Object.assign(hitBtn.style,{padding:'12px 18px',borderRadius:'14px',border:'0',cursor:'pointer',background:'#2563eb',color:'#fff',fontWeight:'800',fontSize:'16px',width:'100%',boxShadow:'0 10px 18px rgba(37,99,235,.35)'});
    const cancel=document.createElement('button'); cancel.id='tapCancel'; cancel.textContent='Cancel'; Object.assign(cancel.style,{marginTop:'10px',background:'transparent',color:'#93a3b8',border:'0',cursor:'pointer',fontSize:'13px'});
    card.append(title,desc,status,hitBtn,cancel); ov.append(card); document.body.appendChild(ov);
  }

  const desc = document.getElementById('tapDesc');
  const status = document.getElementById('tapStatus');
  const hitBtn = document.getElementById('tapHitBtn');
  const cancel = document.getElementById('tapCancel');

  desc.textContent = `Hit ${required} time(s) within ${(windowMs/1000).toFixed(1)}s (Monster #${idNum})`;
  status.textContent = `Hits: 0 / ${required} · Time left: ${(windowMs/1000).toFixed(1)}s`;

  let hits=0, done=false, resolveFn;
  ov.style.display='flex';
  const start=Date.now();
  const timer=setInterval(()=>{
    const remain=Math.max(0, windowMs - (Date.now()-start));
    status.textContent = `Hits: ${hits} / ${required} · Time left: ${(remain/1000).toFixed(1)}s`;
    if(remain<=0){ clearInterval(timer); if(!done) finish(false); }
  },50);

  function finish(ok){ done=true; ov.style.display='none'; clearInterval(timer); hitBtn.onclick=null; cancel.onclick=null; resolveFn?.(ok); }
  hitBtn.onclick=()=>{ hits++; try{clickSound.play().catch(()=>{});}catch{}; if(hits>=required && !done) finish(true); };
  cancel.onclick=()=> !done && finish(false);

  return new Promise((resolve)=>{ resolveFn=resolve; });
}
