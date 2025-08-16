// /geolocation/js/app.js
import { db } from './firebase.js';
import { ensureAudio, playFail, playDeath, playAttackImpact } from './audio.js';
import { injectCSS, toast, ensureHUD, setHUD, addStartGate } from './ui.js';
import { DEFAULT_IMG, makeImageDivIcon, makePlayerDivIcon,
         getChallengeDurationMs, getGuestId, haversineM, isInRange, distanceToM, setFacingByLatLng } from './utils.js';

import { TowerGuard } from "./tower.js";
import { Score } from "./score.js";
import { WalkPoints } from "./walk.js";
import { MonsterGuard } from "./monster.js";
import { ensureImpactCSS, spawnImpactAt, spawnExplosionAt, shakeMap, attachHPBar } from './fx.js';
import { swingSwordAt } from './playerFx.js';
import { attackOnceToward } from './playerFx.js';
import DogCompanion from './dogCompanion.js';

import { createAttachMonsterBattle } from './battle.js';
import { RealTimeMonsters } from './monstersRT.js';
import { transferMonsterInventory } from './inventoryTransfer.js';
import { Inventory } from "./inventory.js";
import { InventoryUI } from "./inventoryUI.js";

injectCSS(); ensureImpactCSS();

let map, playerMarker;

async function main(){
  // Score/HUD
  await Score.init({ db, getGuestId, toast, playFail });
  Score.attachToHUD(ensureHUD());
  setHUD({ chain: Score.getChainTotal() });
  Score.updateEnergyUI();
  Score.wireRespawn();

  // Inventory UI
  const guestId = getGuestId();

  const inv = new Inventory({ db, guestId, onChange: (items)=>console.log('inv change', items) });
  const invUI = new InventoryUI({
    inventory: inv,
    toast: (m)=>console.log('[toast]', m),
    onUseItem: async (id)=>{ await inv.useItem(id, 1); },
    onDropItem: async (id)=>{ await inv.dropItem(id, 1); },
  });

  try {
    await inv.load({ autoListen: true });
    await invUI.mount();
-   invUI.open(); // 처음부터 패널 보이게
    console.log('[InventoryUI] mounted');
  } catch (e) {
    console.error('[InventoryUI] failed to mount/load:', e);
  }


  // app.js, map/marker가 만들어진 뒤
window.__hit = ()=> attackOnceToward(map, playerMarker, playerMarker.getLatLng().lat + 0.00001, playerMarker.getLatLng().lng);


  // Map
  map = L.map('map',{maxZoom:22}).setView([37.5665,126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  // Geolocation
  let userLat=null, userLon=null;
  await new Promise((res)=>{
    if (!navigator.geolocation){ res(); return; }
    navigator.geolocation.getCurrentPosition(
      p=>{ userLat=p.coords.latitude; userLon=p.coords.longitude; res(); },
      ()=>res(), {enableHighAccuracy:true, timeout:7000}
    );
  });
  if (userLat==null){ userLat=37.5665; userLon=126.9780; }

  // Player
  playerMarker = L.marker([userLat,userLon],{ icon: makePlayerDivIcon('../images/user/1.png',38) }).addTo(map);
  map.setView([userLat,userLon], 19);

  // Dog
  const dog = new DogCompanion({
    map, lat:userLat, lon:userLon,
    dogUrl:'../images/user/dog.png', dogSize:26, offsetM:0.5,
    barkUrl:'../sounds/puppybark.mp3', barkVolume:0.9
  });
  map.on('click', (e)=>{ try{ setFacingByLatLng(map, playerMarker, e.latlng, 'right'); }catch{}; try{ dog.setFacingByTarget(userLat, userLon, e.latlng.lat, e.latlng.lng); }catch{}; });

  // Walk path + HUD distance
  const walkPath = L.polyline([[userLat,userLon]], { weight:3, opacity:0.9 }).addTo(map);
  let lastLat=userLat, lastLon=userLon;
  let totalWalkedM = Number(localStorage.getItem('ui_total_walk_m')||0);
  setHUD({ distanceM: totalWalkedM });

  if (navigator.geolocation){
    navigator.geolocation.watchPosition(p=>{
      userLat=p.coords.latitude; userLon=p.coords.longitude;
      playerMarker.setLatLng([userLat,userLon]);
      dog.update(userLat,userLon);
      walkPath.addLatLng([userLat,userLon]);
      if (Number.isFinite(lastLat)&&Number.isFinite(lastLon)){
        const seg = haversineM(lastLat,lastLon,userLat,userLon);
        if (seg>=0.5){ totalWalkedM+=seg; localStorage.setItem('ui_total_walk_m', String(totalWalkedM)); setHUD({ distanceM: totalWalkedM }); }
      }
      if (!window.__pf_dashing) {
  playerMarker.setLatLng([userLat, userLon]);
  dog.update(userLat, userLon);
}

      lastLat=userLat; lastLon=userLon;
    },()=>{}, {enableHighAccuracy:true});
  }

  // Flash on hit
  const flashPlayer = ()=>{
    const el = playerMarker.getElement(); if (!el) return;
    el.classList.remove('player-hit'); void el.offsetWidth; el.classList.add('player-hit');
  };

  // Towers auto attack
const towers = new TowerGuard({
  map, db,
  iconUrl:"https://puppi.netlify.app/images/mon/tower.png",
  rangeDefault:60,
  fireCooldownMs:1500,
  getUserLatLng: ()=> {
    const {lat, lng} = playerMarker.getLatLng();
    return [lat, lng];
  },
  onUserHit: (damage, tower)=>{
    // 유저 현재 위치에서 데미지 반영 + 이펙트
    const { lat, lng } = playerMarker.getLatLng();
    try { flashPlayer(); } catch {}
    try { Score.deductGP(damage, lat, lng); } catch {}
    try { spawnExplosionAt(map, lat, lng, { size: 180, hue: 0 }); } catch {}
    try { playAttackImpact({ intensity: 1.0 }); shakeMap(); } catch {}
  }
});
towers.setUserReady(true);


// Monster auto attack (no markers)
const monstersGuard = new MonsterGuard({
  map, db,
  iconUrl:"https://puppi.netlify.app/images/mon/1.png",
  rangeDefault:50, fireCooldownMs:1800,
  getUserLatLng:()=>[userLat,userLon],
  onUserHit:(damage, mon)=>{
    flashPlayer();
    Score.deductGP(damage, mon.lat, mon.lon);
    // 유저 위치에 타격 폭발
 try {
      const { lat: uLat, lng: uLng } = playerMarker.getLatLng();
      spawnExplosionAt(map, uLat, uLng, { size: 95, hue: 0, crit: false });
      shakeMap();
      playAttackImpact({ intensity: 1.0 });
    } catch {}
    },
    renderMarkers: false
  });

// ▶ 폴러 시작 보장
monstersGuard.start?.();

  // ====== 첫 입력에서 오디오/타이머/가드 재개 ======
window.addEventListener('pointerdown', () => {
  try { ensureAudio(); } catch {}
  try { towers.resumeAudio?.(); } catch {}
  try { monstersGuard.resumeAudio?.(); } catch {}
  // 혹시 start가 아직 안 불렸다면 여기서도 보장
  try { towers.start?.(); } catch {}
  try { monstersGuard.start?.(); } catch {}
}, { once:true, passive:true });

// ====== 게임 시작 게이트: userReady 신호 보장 ======
addStartGate(()=>{
  try { ensureAudio(); } catch {}
  try { towers.setUserReady?.(true); } catch {}
  try { monstersGuard.setUserReady?.(true); } catch {}
});

// (선택) 디버깅용: 즉시 한 틱 돌려보기
window.__guardsDebug = () => {
  try { towers.tickOnce?.(); } catch {}
  try { monstersGuard.tickOnce?.(); } catch {}
};
  // Attach battle factory
  const attachMonsterBattle = createAttachMonsterBattle({
    db, map, playerMarker, dog, Score, toast,
    ensureAudio, isInRange, distanceToM, setFacingByLatLng,
    swingSwordAt, attackOnceToward, spawnImpactAt, spawnExplosionAt, shakeMap, playAttackImpact, playFail, playDeath,
    attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
    monstersGuard, setHUD
  });

 // Real-time monsters
  const rtMon = new RealTimeMonsters({
    db, map,
    makeImageDivIcon, DEFAULT_IMG,
    attachMonsterBattle,
    monstersGuard
  });
  rtMon.start();
}

main();
