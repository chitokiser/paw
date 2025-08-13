// js/map_demo.js  — 테스트 전용: mid=23을 항상 현재 위치에 스폰
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDoc, setDoc, updateDoc, increment,
  serverTimestamp, doc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// ---------- Firebase ----------
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

// ---------- Demo identity ----------
function getGuestId(){
  let id = localStorage.getItem('guestId');
  if(!id){ id = 'guest-' + Math.random().toString(36).slice(2,8); localStorage.setItem('guestId', id); }
  return id;
}
const userAddress = getGuestId();

// ---------- Utils ----------
const tRad = d => d*Math.PI/180;
function getDistance(a,b,c,d){
  const R=6371000, φ1=tRad(a), φ2=tRad(c), dφ=tRad(c-a), dλ=tRad(d-b);
  const A=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));
}
function stepTowards(lat, lon, tgtLat, tgtLon, meters){
  if (meters<=0) return {lat, lon};
  const dist = getDistance(lat, lon, tgtLat, tgtLon);
  if (dist===0 || meters>=dist) return {lat:tgtLat, lon:tgtLon};
  const r = meters/dist;
  return { lat: lat + (tgtLat-lat)*r, lon: lon + (tgtLon-lon)*r };
}

// ---------- Toast ----------
let eventToast = null;
function showEvent(type,msg){
  if(!eventToast) eventToast = document.getElementById('eventToast');
  eventToast.className=type; eventToast.textContent=msg;
  eventToast.style.display='block'; setTimeout(()=>eventToast.style.display='none',1600);
}

// ---------- User stats ----------
const userStats = { totalDistanceM:0, totalGP:0 };
async function ensureUserDoc(){
  await setDoc(doc(db,'users',userAddress),{
    address:userAddress, updatedAt:serverTimestamp()
  },{merge:true});
  const snap = await getDoc(doc(db,'users',userAddress));
  if (snap.exists()){
    const d=snap.data();
    userStats.totalDistanceM = Number(d.totalDistanceM||0);
    userStats.totalGP = Number(d.totalGP||0);
  }
}
async function awardGP(gpUnits, lat, lon, totalDistanceM){
  if(gpUnits<=0) return;
  await addDoc(collection(db,'walk_logs'),{
    address:userAddress, gp:gpUnits, metersCounted:gpUnits*10, lat, lon, totalDistanceM,
    createdAt:serverTimestamp()
  });
  await updateDoc(doc(db,'users',userAddress),{
    totalGP:increment(gpUnits), totalDistanceM:increment(gpUnits*10), updatedAt:serverTimestamp()
  });
  userStats.totalGP += gpUnits; userStats.totalDistanceM += gpUnits*10;
}

// ---------- Sprite helpers (단일 시트, X축만 진행) ----------
(function injectCSS(){
  const css = `
  .sprite{position:relative;width:var(--fw,256px);height:var(--fh,288px);
    background-image:var(--img);background-repeat:no-repeat;background-position:0 0;
    image-rendering:pixelated;will-change:transform,background-position;transform-origin:50% 50%}
  .sprite.play{animation-timing-function:steps(var(--frames));animation-iteration-count:infinite;
    animation-name:var(--anim);animation-duration:var(--dur,800ms)}
  .sprite.play-once{animation-timing-function:steps(var(--frames));animation-iteration-count:1;
    animation-fill-mode:forwards;animation-name:var(--anim);animation-duration:var(--dur,600ms)}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  .mon-bob{animation:bob 2.2s ease-in-out infinite}
  .mon-chase{filter:drop-shadow(0 0 6px rgba(255,80,80,.6))}
  `;
  const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s);
})();
function makeAnim(frW, frames){
  const name = `spr_${frW}_${frames}_${Math.random().toString(36).slice(2)}`;
  const totalX = -(frW*frames);
  const css = `@keyframes ${name}{from{background-position:0 0}to{background-position:${totalX}px 0}}`;
  const st = document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  return name;
}
function createSprite({img, frames, fps, frameW, frameH, offsetY}){
  const el = document.createElement('div');
  el.className = 'sprite mon-bob play';
  el.style.setProperty('--fw', `${frameW}px`);
  el.style.setProperty('--fh', `${frameH}px`);
  el.style.setProperty('--img', `url(${img})`);
  el.style.backgroundPositionY = `-${offsetY}px`;
  el.style.setProperty('--frames', frames);
  el.style.setProperty('--dur', `${Math.round(1000*(frames/fps))}ms`);
  el.style.setProperty('--anim', makeAnim(frameW, frames));
  return el;
}

// ---------- Main ----------
async function main(){
  await ensureUserDoc();

  // Leaflet map
  const map = L.map('map',{maxZoom:22}).setView([37.5665,126.9780], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  // 현재 위치 → 사용자/몬스터 위치 동시 배치
  let userLat=null, userLon=null;
  await new Promise((res)=>{
    if (!navigator.geolocation){ res(); return; }
    navigator.geolocation.getCurrentPosition(p=>{
      userLat=p.coords.latitude; userLon=p.coords.longitude;
      res();
    }, ()=>res(), {enableHighAccuracy:true, timeout:7000});
  });
  if (userLat==null){ userLat=37.5665; userLon=126.9780; } // fallback(서울시청)

  // 사용자 마커
  const userIcon=L.divIcon({className:'', html:'🧍', iconSize:[28,28], iconAnchor:[14,14]});
  const userMarker=L.marker([userLat,userLon],{icon:userIcon}).addTo(map).bindPopup(userAddress);
  map.setView([userLat,userLon], 19);

  // ---- 테스트 몬스터(mid=23) : 항상 현재 위치에 스폰 ----
  const SHEET = "https://puppi.netlify.app/geolocation/sprites/1.png"; // 768×1152
  const FRAME_W = 256, FRAME_H = 288;
  const WALK = { frames:3, fps:8,  offsetY:0   };
  const ATK  = { frames:3, fps:10, offsetY:288 };

  const mon = {
    mid:23,
    lat:userLat, lon:userLon, // <- 강제 현재 위치
    speed:1.2, aggroRange:12, attackRange:6, attackCooldownMs:3000,
    lastAttack:0, state:'patrol',
    walk:{img:SHEET, ...WALK}, atk:{img:SHEET, ...ATK},
    frameW:FRAME_W, frameH:FRAME_H
  };

  // 스프라이트 DivIcon 생성
  const walkEl = createSprite({img:mon.walk.img, frames:mon.walk.frames, fps:mon.walk.fps,
                               frameW:FRAME_W, frameH:FRAME_H, offsetY:mon.walk.offsetY});
  const icon = L.divIcon({className:'', html:walkEl.outerHTML, iconSize:[FRAME_W,FRAME_H], iconAnchor:[FRAME_W/2,FRAME_H/2]});
  mon.marker = L.marker([mon.lat, mon.lon], {icon}).addTo(map).bindPopup('Monster #23');

  // DOM 참조
  const root = mon.marker.getElement();
  mon._spr = root ? root.querySelector('.sprite') : null;

  // 간단한 클릭 전투(가중치 낮게)
  mon.marker.on('click', async ()=>{
    const myP = Math.max(1, Math.floor(userStats.totalGP*0.5 + (userStats.totalDistanceM||0)/1000));
    const enemyP = 3;
    const p = 1/(1+Math.exp(-(myP-enemyP)/3));
    const pWin = Math.min(0.9, Math.max(0.1, p));
    const success = Math.random() < pWin;
    if (success){
      await awardGP(5, mon.lat, mon.lon, Math.round(userStats.totalDistanceM));
      showEvent('reward','+5 GP (테스트 승리)');
    }else{
      showEvent('lost','실패…');
    }
  });

  // 위치 업데이트(사용자 따라오기 테스트 느낌)
  let lastT=Date.now();
  setInterval(()=>{
    const now=Date.now(); const dt=Math.min(0.25,(now-lastT)/1000); lastT=now;
    // 간단 추격: 사용자 기준으로 약간 따라붙기
    const step = stepTowards(mon.lat, mon.lon, userLat, userLon, mon.speed*dt*1.5);
    mon.lat=step.lat; mon.lon=step.lon;
    mon.marker.setLatLng([mon.lat, mon.lon]);
  }, 100);

  // 사용자의 실제 이동 반영(워치)
  if (navigator.geolocation){
    navigator.geolocation.watchPosition(p=>{
      userLat=p.coords.latitude; userLon=p.coords.longitude;
      userMarker.setLatLng([userLat,userLon]);
    },()=>{}, {enableHighAccuracy:true});
  }
}

main();
