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
import { ensureImpactCSS, spawnImpactAt, shakeMap, attachHPBar } from './fx.js';
import { swingSwordAt } from './playerFx.js';
import { attackOnceToward } from './playerFx.js';
import DogCompanion from './dogCompanion.js';

import { createAttachMonsterBattle } from './battle.js';
import { RealTimeMonsters } from './monstersRT.js';
import { transferMonsterInventory } from './inventoryTransfer.js';

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
  playerMarker = L.marker([userLat,userLon],{ icon: makePlayerDivIcon('../images/user/1.png', 48) }).addTo(map);
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
    rangeDefault:60, fireCooldownMs:1500,
    getUserLatLng:()=>[userLat,userLon],
    onUserHit:(damage, info)=>{
      flashPlayer(); Score.deductGP(damage, info.lat, info.lon);
      try{ setFacingByLatLng(map, playerMarker, {lat:info.lat, lng:info.lon}, 'right'); }catch{}
      try{ dog.setFacingByTarget(userLat,userLon, info.lat, info.lon); }catch{}
      try{ spawnImpactAt(map, userLat, userLon); }catch{}
      try{ playAttackImpact({ intensity:0.9 }); }catch{}
    }
  });

  // Monster auto attack (no markers)
  const monstersGuard = new MonsterGuard({
    map, db,
    iconUrl:"https://puppi.netlify.app/images/mon/monster.png",
    rangeDefault:50, fireCooldownMs:1800,
    getUserLatLng:()=>[userLat,userLon],
    onUserHit:(damage, mon)=>{ flashPlayer(); Score.deductGP(damage, mon.lat, mon.lon); },
    renderMarkers:false
  });

  // Resume audio on first pointer
  window.addEventListener('pointerdown', ()=>{ try{ ensureAudio(); }catch{}; try{ towers.resumeAudio(); }catch{}; try{ monstersGuard.resumeAudio(); }catch{}; }, { once:true, passive:true });

  // Start gate
  addStartGate(()=>{ try{ ensureAudio(); }catch{}; try{ towers.setUserReady(true); }catch{}; try{ monstersGuard.setUserReady(true); }catch{}; try{ dog.warmBark(); }catch{}; });

  // Attach battle factory
  const attachMonsterBattle = createAttachMonsterBattle({
    db, map, playerMarker, dog, Score, toast,
    ensureAudio, isInRange, distanceToM, setFacingByLatLng,
    swingSwordAt, attackOnceToward, spawnImpactAt, shakeMap, playAttackImpact, playFail, playDeath,
    attachHPBar, getChallengeDurationMs, transferMonsterInventory: (args)=>transferMonsterInventory(db, args), getGuestId,
    monstersGuard,
    setHUD
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
