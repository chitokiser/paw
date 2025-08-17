import { db } from './firebase.js';
import {
  collection, query, where, onSnapshot,
  doc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { ensureAudio, playFail, playDeath, playAttackImpact } from './audio.js';
import { injectCSS, toast, ensureHUD, setHUD, addStartGate } from './ui.js';
import { DEFAULT_IMG, makeImageDivIcon, makePlayerDivIcon,
         getChallengeDurationMs, getGuestId, haversineM, isInRange, distanceToM, setFacingByLatLng } from './utils.js';

import { TowerGuard } from "./tower.js";
import { Score } from "./score.js";
import { WalkPoints } from "./walk.js";
import { MonsterGuard } from "./monster.js";
import { ensureImpactCSS, spawnImpactAt, spawnExplosionAt, shakeMap, attachHPBar } from './fx.js';
import { swingSwordAt, attackOnceToward } from './playerFx.js';
import DogCompanion from './dogCompanion.js';

import { createAttachMonsterBattle } from './battle.js';
import { RealTimeMonsters } from './monstersRT.js';
import { transferMonsterInventory } from './inventoryTransfer.js';
import { Inventory } from "./inventory.js";
import { InventoryUI } from "./inventoryUI.js";

injectCSS(); ensureImpactCSS();

let map, playerMarker;

/* ===== 보물(타일 기반 구독) ===== */
function _tileSizeDeg(){ return 0.01; }
function _tilesFromBounds(bounds, g = _tileSizeDeg()){
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
  const y0 = Math.floor(sw.lat/g), y1 = Math.floor(ne.lat/g);
  const x0 = Math.floor(sw.lng/g), x1 = Math.floor(ne.lng/g);
  const tiles = [];
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
  return tiles.slice(0, 10);
}

const _treasures = new Map(); // id -> { marker, hp:{set}, maxHits }

/** 보물 아이콘 */
function _makeTreasureIcon(size = 44, imageURL = 'https://puppi.netlify.app/images/event/tresure.png') {
  const s = Math.max(24, Number(size) || 44);
  const html = `
    <div class="mon-wrap" style="position:relative;width:${s}px;height:${s}px;">
      <img src="${imageURL}" alt="treasure" draggable="false"
           style="width:100%;height:100%;object-fit:contain;pointer-events:none;"/>
    </div>
  `;
  return L.divIcon({ className: '', html, iconSize: [s, s], iconAnchor: [s/2, s/2] });
}

/** 보물 1타 처리 (트랜잭션: hitsLeft 감소, 0이면 종료) */
async function _hitTreasure(docId, data){
  try{
    const ref = doc(db, 'treasures', docId);
    const res = await runTransaction(db, async (tx)=>{
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('notfound');
      const d = snap.data() || {};
      if (d.dead === true || d.alive === false) throw new Error('already');
      const power = Math.max(1, Number(d.power ?? 1));
      const left0 = Number.isFinite(d.hitsLeft) ? Number(d.hitsLeft) : power;
      const left = Math.max(0, left0 - 1);
      if (left <= 0){
        tx.update(ref, {
          hitsLeft: 0, alive: false, dead: true,
          claimedAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
      }else{
        tx.update(ref, { hitsLeft: left, updatedAt: serverTimestamp() });
      }
      return { left, power };
    });

    // 이펙트/사운드/UI
    try{
      spawnImpactAt(map, data.lat, data.lon);
      playAttackImpact({ intensity: 0.7 });
      shakeMap();
    }catch{}

    const cache = _treasures.get(docId);
    if (cache?.hp) {
      cache.hp.set(res.left); // HP바 갱신
    }

    if (res.left <= 0){
      toast('보물 오픈!');
      const mk = cache?.marker;
      if (mk){ try { map.removeLayer(mk); } catch{}; }
      _treasures.delete(docId);
    }else{
      toast(`보물 타격! (남은 타격: ${res.left}/${res.power})`);
    }
  }catch(e){
    if (String(e?.message||'').includes('already')){
      toast('이미 미션을 완료하였습니다.');
    }else{
      console.warn('[treasure] hit error', e);
      toast('타격 처리 중 문제가 발생했습니다.');
    }
  }
}

/** 마커 생성/갱신 */
function _upsertTreasureMarker(docId, data) {
  const { lat, lon, imageURL, size = 44, alive = true } = data || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || alive === false) {
    const cached = _treasures.get(docId);
    if (cached) {
      try { map.removeLayer(cached.marker); } catch {}
      _treasures.delete(docId);
    }
    return;
  }
  const icon = _makeTreasureIcon(size, imageURL);
  const cached = _treasures.get(docId);

  // power/hitsLeft 계산
  const power = Math.max(1, Number(data.power ?? 1));
  const left  = Number.isFinite(data.hitsLeft) ? Math.max(0, Number(data.hitsLeft)) : power;

  if (!cached) {
    const marker = L.marker([lat, lon], { icon, zIndexOffset: 10000 }).addTo(map);

    // HP바 부착(남은 타격 수 표시)
    let hp = null;
    try { hp = attachHPBar(marker, power); hp.set(left); } catch {}

    // 클릭 = 1타 (근접 체크 포함)
    marker.on('click', ()=>{
      try{
        const u = playerMarker?.getLatLng?.(); if (!u) return;
        const distM = map.distance([lat, lon], u);
        const meleeRange = 12; // 근접 사거리(원하면 조절)
        if (distM > meleeRange){
          toast(`너무 멉니다. (${distM.toFixed(1)}m)`);
          return;
        }
      }catch{}
      _hitTreasure(docId, data);
    });

    _treasures.set(docId, { marker, hp, maxHits: power });
  } else {
    cached.marker.setLatLng([lat, lon]);
    cached.marker.setIcon(icon);
    if (cached.hp) cached.hp.set(left);
  }
}

let _unsubTreasures = null;
let _lastTileKey = '';

function _watchTreasuresForViewport() {
  if (!map) return;
  const tiles = _tilesFromBounds(map.getBounds());
  if (!tiles.length) return;

  const key = tiles.join(',');
  if (key === _lastTileKey) return;
  _lastTileKey = key;

  if (_unsubTreasures) { try { _unsubTreasures(); } catch {} _unsubTreasures = null; }

  const baseCol = collection(db, 'treasures');
  const qy = query(
    baseCol,
    where('type', '==', 'treasure'),
    where('tile', 'in', tiles)
  );
  console.log('[treasure] subscribe tiles:', tiles);

  _unsubTreasures = onSnapshot(qy, (snap) => {
    snap.docChanges().forEach((ch) => {
      const id = ch.doc.id;
      const data = ch.doc.data() || {};
      if (ch.type === 'removed') {
        const mk = _treasures.get(id)?.marker;
        if (mk) { try { map.removeLayer(mk); } catch {} _treasures.delete(id); }
        return;
      }
      _upsertTreasureMarker(id, data);
    });
  }, (err) => {
    console.warn('[treasure] onSnapshot error', err);
  });
}

/* ================================= */

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
  try { await inv.load({ autoListen: true }); await invUI.mount(); console.log('[InventoryUI] mounted'); } catch (e) { console.error('[InventoryUI] failed to mount/load:', e); }

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
      if (!window.__pf_dashing) {
        playerMarker.setLatLng([userLat, userLon]);
        dog.update(userLat, userLon);
      }
      walkPath.addLatLng([userLat,userLon]);
      if (Number.isFinite(lastLat)&&Number.isFinite(lastLon)){
        const seg = haversineM(lastLat,lastLon,userLat,userLon);
        if (seg>=0.5){
          totalWalkedM+=seg; localStorage.setItem('ui_total_walk_m', String(totalWalkedM));
          setHUD({ distanceM: totalWalkedM });
        }
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
    getUserLatLng: ()=> {
      const {lat, lng} = playerMarker.getLatLng();
      return [lat, lng];
    },
    onUserHit: (damage)=>{
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
      try {
        const { lat: uLat, lng: uLng } = playerMarker.getLatLng();
        spawnExplosionAt(map, uLat, uLng, { size: 95, hue: 0, crit: false });
        shakeMap();
        playAttackImpact({ intensity: 1.0 });
      } catch {}
    },
    renderMarkers: false
  });
  monstersGuard.start?.();

  // 첫 입력에서 오디오/타이머/가드 재개
  window.addEventListener('pointerdown', () => {
    try { ensureAudio(); } catch {}
    try { towers.resumeAudio?.(); } catch {}
    try { monstersGuard.resumeAudio?.(); } catch {}
    try { towers.start?.(); } catch {}
    try { monstersGuard.start?.(); } catch {}
  }, { once:true, passive:true });

  // 시작 게이트
  addStartGate(()=>{
    try { ensureAudio(); } catch {}
    try { towers.setUserReady?.(true); } catch {}
    try { monstersGuard.setUserReady?.(true); } catch {}
  });

  // 전투/마커(몬스터)
  const attachMonsterBattle = createAttachMonsterBattle({
    db, map, playerMarker, dog, Score, toast,
    ensureAudio, isInRange, distanceToM, setFacingByLatLng,
    swingSwordAt, attackOnceToward, spawnImpactAt, spawnExplosionAt, shakeMap, playAttackImpact, playFail, playDeath,
    attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
    monstersGuard, setHUD
  });

  const rtMon = new RealTimeMonsters({
    db, map,
    makeImageDivIcon, DEFAULT_IMG,
    attachMonsterBattle,
    monstersGuard
  });
  rtMon.start();

  // 보물 구독 시작
  _watchTreasuresForViewport();
  map.on('moveend', _watchTreasuresForViewport);
}

main();
