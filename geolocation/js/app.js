// app.js (통합본: treasures.js / shops.js 분리 이후)
import { db } from './firebase.js';
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { ensureAudio, playFail, playDeath, playAttackImpact } from './audio.js';
import { injectCSS, toast, ensureHUD, setHUD, addStartGate, mountCornerUI } from './ui.js';
import {
  DEFAULT_IMG, makeImageDivIcon, makePlayerDivIcon,
  getChallengeDurationMs, getGuestId, haversineM, isInRange, distanceToM, setFacingByLatLng
} from './utils.js';

import { TowerGuard } from "./tower.js";
import { Score } from "./score.js";
import { MonsterGuard } from "./monster.js";
import { ensureImpactCSS, spawnImpactAt, shakeMap, attachHPBar,ensureMonsterAniCSS, playMonsterHitSprite } from "./fx.js";
import { swingSwordAt, attackOnceToward } from './playerFx.js';
import DogCompanion from './dogCompanion.js';

import { createAttachMonsterBattle } from './battle.js';
import { RealTimeMonsters } from './monstersRT.js';
import { transferMonsterInventory } from './inventoryTransfer.js';
import { Inventory } from "./inventory.js";
import { InventoryUI } from "./inventoryUI.js";

// ✅ 새로 분리한 모듈
import { Treasures } from './treasures.js';
import { Shops } from './shops.js';

injectCSS();
ensureImpactCSS();

let map, playerMarker;
let userLat = null, userLon = null;

/* ===============================
 * ★ 장검 퀵 장착/해제 UI (추가)
 * =============================== */
function mountQuickEquipUI(inv){
  if (!inv) return;
  if (document.getElementById('quick-equip-box')) return;

  const box = document.createElement('div');
  box.id = 'quick-equip-box';
  box.style.cssText = `
    position: fixed; right: 10px; bottom: 10px; z-index: 9999;
    display: flex; gap: 6px; padding: 8px 10px; background: rgba(0,0,0,.5);
    border-radius: 10px; backdrop-filter: blur(4px); color: #fff; font-size: 12px;
  `;

  const btnEquip = document.createElement('button');
  btnEquip.textContent = '장검 장착';
  btnEquip.style.cssText = 'padding:6px 10px; cursor:pointer;';

  const btnUnequip = document.createElement('button');
  btnUnequip.textContent = '장비 해제';
  btnUnequip.style.cssText = 'padding:6px 10px; cursor:pointer;';

  btnEquip.onclick = async () => {
    try { await inv.equipLongsword({ syncDB:true }); toast?.('장검 장착!'); } catch {}
  };
  btnUnequip.onclick = async () => {
    try { await inv.unequipWeapon({ syncDB:true }); toast?.('장비 해제(맨손)'); } catch {}
  };

  // 초기 상태 반영
  const refresh = () => {
    const cur = inv.getEquippedWeaponId?.() || 'fist';
    btnEquip.disabled = (cur === 'longsword_iron');
    btnUnequip.disabled = (cur !== 'longsword_iron');
  };
  refresh();

  // 장착 변경 이벤트 구독
  window.addEventListener('equip:changed', (e)=>{
    const id = e?.detail?.id;
    btnEquip.disabled = (id === 'longsword_iron');
    btnUnequip.disabled = (id !== 'longsword_iron');
  });

  box.appendChild(btnEquip);
  box.appendChild(btnUnequip);
  document.body.appendChild(box);
}

async function main(){
  // ===== Score/HUD =====
  await Score.init({ db, getGuestId, toast, playFail });
  Score.attachToHUD(ensureHUD());
  setHUD({ chain: Score.getChainTotal() });
  Score.updateEnergyUI();
  Score.wireRespawn();

  // ===== Inventory + UI =====
  const guestId = getGuestId();
  const inv = new Inventory({ db, guestId, onChange: (items)=>console.log('inv change', items) });
  const invUI = new InventoryUI({
    inventory: inv,
    toast, // ✅ 실제 토스트 노출
    // ✅ 빨간약 사용 시 에너지 +10
    onUseItem: async (id) => {
      if (id === 'red_potion') {
        try {
          if (typeof Score.addEnergy === 'function') {
            await Score.addEnergy(10);
          } else if (typeof Score.recoverEnergy === 'function') {
            await Score.recoverEnergy(10);
          } else if (typeof Score.setEnergy === 'function') {
            const cur = Number(Score.getStats?.().energy ?? 0);
            await Score.setEnergy(cur + 10);
          }
          try { Score.updateEnergyUI?.(); } catch {}
          try { toast('빨간약 사용! (+10 에너지)'); } catch {}
        } catch (e) {
          console.warn('[use red_potion] energy add failed', e);
        }
        await inv.useItem(id, 1); // 효과 후 1개 소모
        return;
      }
      // 기본: 소모만
      await inv.useItem(id, 1);
    },
    onDropItem: async (id)=>{ await inv.dropItem(id, 1); },
  });
  try {
    await inv.load({ autoListen: true }); // ✅ 서버 변경 실시간 반영
    invUI.mount();
    // ★ 장검 장착/해제 퀵 UI 장착
    mountQuickEquipUI(inv);
    console.log('[InventoryUI] mounted (+ long sword equip UI)');
  } catch (e) {
    console.error('[InventoryUI] failed to mount/load:', e);
  }

  // ===== Map =====
  map = L.map('map',{maxZoom:22}).setView([37.5665,126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  // Geolocation
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

  // 코너 UI(줌/홈/인벤토리/HUD 위치 등)
  try { if (typeof mountCornerUI === 'function') mountCornerUI({ map, playerMarker, invUI }); } catch {}

  // Dog
  const dog = new DogCompanion({
    map, lat:userLat, lon:userLon,
    dogUrl:'../images/user/dog.png', dogSize:26, offsetM:0.5,
    barkUrl:'../sounds/puppybark.mp3', barkVolume:0.9
  });
  map.on('click', (e)=>{
    try{ setFacingByLatLng(map, playerMarker, e.latlng, 'right'); }catch{};
    try{
      const { lat: uLat, lng: uLng } = playerMarker?.getLatLng?.() ?? { lat:userLat, lng:userLon };
      dog.setFacingByTarget(uLat, uLng, e.latlng.lat, e.latlng.lng);
    }catch{};
  });

  // Walk path + HUD distance
  const walkPath = L.polyline([[userLat,userLon]], { weight:3, opacity:0.9 }).addTo(map);
  let lastLat=userLat, lastLon=userLon;
  let totalWalkedM = Number(localStorage.getItem('ui_total_walk_m')||0);
  setHUD({ distanceM: totalWalkedM });

  if (navigator.geolocation){
    navigator.geolocation.watchPosition(p=>{
      userLat=p.coords.latitude; userLon=p.coords.longitude;
      playerMarker.setLatLng([userLat, userLon]);
      dog.update(userLat, userLon);
      walkPath.addLatLng([userLat,userLon]);
      if (Number.isFinite(lastLat)&&Number.isFinite(lastLon)){
        const seg = haversineM(lastLat,lastLon,userLat,userLon);
        if (seg>=0.5){
          totalWalkedM+=seg;
          localStorage.setItem('ui_total_walk_m', String(totalWalkedM));
          setHUD({ distanceM: totalWalkedM });
        }
      }
      lastLat=userLat; lastLon=userLon;

      // 이동량 기반 근처 몬스터 재구독(옵션)
      try { maybeRewatchNearbyMonsters(userLat, userLon); } catch {}
    },()=>{}, {enableHighAccuracy:true});
  }

  // Flash on hit
  const flashPlayer = ()=>{
    const el = playerMarker.getElement(); if (!el) return;
    el.classList.remove('player-hit'); void el.offsetWidth; el.classList.add('player-hit');
  };

  // ===== Towers (auto attack) =====
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
      try { spawnImpactAt(map, lat, lng); } catch {}
      try { playAttackImpact({ intensity: 1.0 }); shakeMap(); } catch {}
    }
  });
  towers.setUserReady(true);

  // ===== Real-time monsters (primary) =====
  const monstersGuard = new MonsterGuard({
    map, db,
    rangeDefault:50, fireCooldownMs:1800,
    getUserLatLng: ()=>{
      try { const {lat,lng}=playerMarker.getLatLng(); return [lat,lng]; }
      catch { return [userLat,userLon]; }
    },
    onUserHit: (damage, mon) => {
      flashPlayer();
      Score.deductGP(damage, mon.lat, mon.lon);
      // 1회 재생
    playMonsterHitSprite(map, pos, mid, {
      durationMs: 420,  // 필요시 조절
      scale: 1,         // 필요시 0.8~1.3 등
      basePath: '/images/ani/' // \images\ani\ → 웹경로는 /images/ani/
    });
      try {
        const { lat: uLat, lng: uLng } = playerMarker.getLatLng();
        spawnImpactAt(map, uLat, uLng);
        shakeMap();
        playAttackImpact({ intensity: 1.0 });
      } catch (e) {
        console.warn('onUserHit FX error:', e);
      }
    },
    useTiles: false
  });

  const attachMonsterBattle = createAttachMonsterBattle({
    db, map, playerMarker, dog, Score, toast,
    ensureAudio, isInRange, distanceToM, setFacingByLatLng,
    swingSwordAt, attackOnceToward, spawnImpactAt, shakeMap, playAttackImpact, playFail, playDeath,
    attachHPBar, getChallengeDurationMs,
    transferMonsterInventory, // ✅ 원형 전달
    getGuestId,
    monstersGuard, setHUD
  });

  const rtMon = new RealTimeMonsters({
    db, map,
    makeImageDivIcon, DEFAULT_IMG,
    attachMonsterBattle,
    monstersGuard
  });
  rtMon.start();
  monstersGuard.setUserReady?.(true);
  monstersGuard.start?.();

  // 첫 입력에서 오디오/타이머 재개
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

  // ===== 새로 분리된 컨트롤러 시작 =====
  const treasures = new Treasures({
    db, map, playerMarker, toast,
    attachHPBar, spawnImpactAt, shakeMap, playAttackImpact,
    transferMonsterInventory, // ✅ 원형 전달
    getGuestId, Score, inv: inv 
  });
  treasures.start();

  const shops = new Shops({
    db, map, playerMarker, Score, toast,
    inv: inv,                     // ✅ 올바른 변수명(inv)
    transferMonsterInventory,     // ✅ 원형 전달
    getGuestId                    // ✅ guestId 일관성
  });
  shops.start();

  // ===== Fallback 자동공격 + 주변만 구독(옵션, DB 쓰기 0) =====
  const liveMonsters = new Map();    // id -> data
  const monsterHitAt = new Map();    // id -> lastHitMs
  let fallbackEnabled = true;

  // 근처(BBOX)만 구독 — 전역 전체 구독 대신 비용 절감
  let unsubMon = null;
  let lastWatchLat = userLat, lastWatchLon = userLon;
  function bbox(lat, lon, m=600){ // 약식: 1도 ≈ 111km
    const d = m / 111000;
    return { minLat: lat-d, maxLat: lat+d, minLon: lon-d, maxLon: lon+d };
  }
  function watchNearbyMonsters(lat, lon){
    if (unsubMon) { try{unsubMon();}catch{}; unsubMon = null; }
    const b = bbox(lat, lon, 600);
    const qMon = query(
      collection(db, 'monsters'),
      where('alive', '==', true),
      where('dead', '==', false),
      where('lat', '>=', b.minLat), where('lat', '<=', b.maxLat),
      where('lon', '>=', b.minLon), where('lon', '<=', b.maxLon)
    );
    unsubMon = onSnapshot(qMon, (qs)=>{
      const now = Date.now();
      liveMonsters.clear();
      qs.forEach(s=>{
        const d = s.data()||{};
        const ok = Number(d.respawnAt||0) <= now && Number.isFinite(d.lat) && Number.isFinite(d.lon);
        if (ok) liveMonsters.set(s.id, d);
      });
    });
  }
  function maybeRewatchNearbyMonsters(lat, lon){
    const moved = map?.distance([lastWatchLat,lastWatchLon],[lat,lon]) ?? 0;
    if (moved > 120){
      lastWatchLat = lat; lastWatchLon = lon;
      watchNearbyMonsters(lat, lon);
    }
  }
  watchNearbyMonsters(userLat, userLon);

  // 탭 비활성화 시 일시정지
  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden){
      fallbackEnabled = false;
      try{unsubMon?.();}catch{}; unsubMon=null;
    } else {
      fallbackEnabled = true;
      const { lat, lng } = playerMarker?.getLatLng?.() ?? { lat:userLat, lng:userLon };
      watchNearbyMonsters(lat, lng);
    }
  });

  // 간단 거리/쿨다운 체크 → onUserHit와 동일 이펙트
  const FALLBACK_TICK_MS = 500; // 0.5s
  setInterval(()=>{
    if (!fallbackEnabled) return;
    if (!playerMarker || !map) return;
    const u = playerMarker.getLatLng();
    const uLat = u.lat, uLng = u.lng;

    for (const [id, d] of liveMonsters){
      const range   = Math.max(5,  Number(d.range      ?? 50));
      const damage  = Math.max(1,  Number(d.damage     ?? 1));
      const cdMs    = Math.max(400,Number(d.cooldownMs ?? 1800));

      const dist = map.distance([uLat,uLng],[d.lat,d.lon]);
      if (dist > range) continue;

      const last = monsterHitAt.get(id) || 0;
      if (Date.now() - last < cdMs) continue;

      monsterHitAt.set(id, Date.now());
      try{
        flashPlayer();
        Score.deductGP(damage, d.lat, d.lon);
        spawnImpactAt(map, uLat, uLng);
        shakeMap();
        playAttackImpact({ intensity: 1.0 });
      }catch(e){
        console.warn('[fallback] hit error', e);
      }
    }
  }, FALLBACK_TICK_MS);

  // 디버그/토글
  window.__monFallback = {
    enable: () => { fallbackEnabled = true;  console.log('[fallback] enabled'); },
    disable: () => { fallbackEnabled = false; console.log('[fallback] disabled'); },
    once: () => { fallbackEnabled = true; setTimeout(()=>fallbackEnabled=false, 2500); }
  };

  // 디버깅용(수동 타격/가드 1틱)
  window.__hit = ()=> attackOnceToward(
    map, playerMarker,
    playerMarker.getLatLng().lat + 0.00001,
    playerMarker.getLatLng().lng
  );
  window.__guardsDebug = () => {
    try { towers.tickOnce?.(); } catch {}
    try { monstersGuard.tickOnce?.(); } catch {}
  };
}

main();
