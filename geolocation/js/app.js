// /geolocation/js/app.js
import { db } from './firebase.js';
import { ensureAudio, playFail, playDeath, playAttackImpact } from './audio.js';
import { injectCSS, toast, ensureHUD, setHUD, addStartGate } from './ui.js';
import {
  DEFAULT_IMG, makeImageDivIcon, makePlayerDivIcon,
  getChallengeDurationMs, getGuestId, haversineM, isInRange, distanceToM,
  setFacingByLatLng
} from './utils.js';

import { TowerGuard } from "./tower.js";
import { Score } from "./score.js";
import { WalkPoints } from "./walk.js";
import { MonsterGuard } from "./monster.js";

import {
  collection, onSnapshot, doc, runTransaction, setDoc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { ensureImpactCSS, spawnImpactAt, shakeMap, attachHPBar } from './fx.js';
import { swingSwordAt } from './playerFx.js';
import { attackOnceToward } from './playerFx.js';

// ★ 강아지(추적+짖음) 통합 모듈
import DogCompanion from './dogCompanion.js';
// ★ 인벤토리 & UI & 드랍
import { Inventory } from './inventory.js';
import { InventoryUI } from './inventoryUI.js';
import { rollDrops } from './loot.js';

/* ===============================
   전투 바인딩 팩토리
   =============================== */
function createAttachMonsterBattle({
  map, playerMarker, dog, Score, toast,
  ensureAudio, isInRange, distanceToM, setFacingByLatLng,
  swingSwordAt, attackOnceToward, spawnImpactAt, shakeMap, playAttackImpact, playFail, playDeath,
  attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
  monstersGuard
}) {
  return function attachMonsterBattle(marker, monsterId, data, sizePx=96) {
    // 초기 HP: power 기준
    let hpLeft = Math.max(1, Number(data.power ?? 20));
    let hpUI = { set: ()=>{} };

    // HP 바 부착 (DOM 생성 이후)
    const setupHP = () => { hpUI = attachHPBar(marker, hpLeft); hpUI.set(hpLeft); };
    setTimeout(setupHP, 0);

    // HUD/타임어택
    let chal = null; // { remain, deadline, timer }

    const stopChallenge = () => {
      if (chal?.timer) clearInterval(chal.timer);
      chal = null;
      try { setHUD({ timeLeft:'-', hitsLeft:'-', earn: data.power, chain: Score.getChainTotal() }); } catch {}
    };

    const updateHUD = () => {
      if (!chal) return;
      const leftMs = Math.max(0, chal.deadline - Date.now());
      const left = (leftMs/1000).toFixed(1) + 's';
      try { setHUD({ timeLeft:left, hitsLeft: chal.remain, earn: data.power }); } catch {}
    };

    async function win() {
      stopChallenge();
      try { playDeath(); } catch {}

      // 점수/체인
      try {
        const distM = Math.round(Score.getStats().totalDistanceM);
        await Score.awardGP(data.power, data.lat, data.lon, distM);
        Score.updateEnergyUI();
        const tx = await Score.saveToChainMock(data.power);
        setHUD({ chain: tx.total });
      } catch {}

      // 전리품 이전
      try {
        const guestId = getGuestId();
        const moved = await transferMonsterInventory({ monsterId: monsterId, guestId });
        if (moved?.length) {
          const summary = moved.map(it => `${it.name || it.id} x${it.qty||1}`).join(', ');
          toast(`+${data.power} GP & 전리품: ${summary}`);
        } else {
          toast(`+${data.power} GP!`);
        }
      } catch (e) {
        console.warn('loot transfer fail:', e);
        toast('전리품 이전 실패. 다시 시도해 주세요.');
      }

      // 맵에서 제거
      setTimeout(() => { try { map.removeLayer(marker); } catch {} }, 900);

      // 서버 플래그(죽음→부활 예약)
  try {
  const now = Date.now();
  const respawnMs = 60_000;
  await setDoc(doc(db, 'monsters', String(monsterId)), {
    alive: false, dead: true, respawnAt: now + respawnMs, updatedAt: now
  }, { merge: true });

  // ✅ 1분 후 실제 부활 쓰기 (alive:true, dead:false, respawnAt:0)
  setTimeout(async () => {
    const monRef = doc(db, 'monsters', String(monsterId));
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(monRef);
        if (!snap.exists()) return;
        const data = snap.data() || {};
        // respawnAt가 지났고 여전히 죽음 상태면 부활시킴
        if ((data.dead === true || data.alive === false) &&
            Number(data.respawnAt || 0) <= Date.now()) {
          tx.update(monRef, {
            alive: true,
            dead: false,
            respawnAt: 0,
            updatedAt: Date.now()
          });
        }
      });
    } catch (e) {
      console.warn('respawn transaction failed:', e);
    }
    // 로컬 자동공격 차단 해제(부활 허용)
    try { monstersGuard?.killedLocal?.delete(String(monsterId)); } catch {}
  }, respawnMs + 120); // 약간 여유
} catch {}

      // 1분 뒤 로컬 차단 해제(부활 허용)
      setTimeout(() => {
        try { monstersGuard?.killedLocal?.delete(String(monsterId)); } catch {}
      }, 60_000 + 100);
    }

    function fail() {
      stopChallenge();
      try { playFail(); } catch {}
      toast('실패… 다시 시도!');
    }

    // 클릭 전투 핸들러
    marker.options.interactive = true;
    marker.on('click', async () => {
      try { ensureAudio(); } catch {}

      // 사거리 10m
      const u = playerMarker.getLatLng();
      const m = marker.getLatLng();
      if (!isInRange(u.lat, u.lng, m.lat, m.lng, 10)) {
        const d = Math.round(distanceToM(u.lat, u.lng, m.lat, m.lng));
        try { attackOnceToward(map, playerMarker, m.lat, m.lng); } catch {}
        toast(`가까이 가세요! (현재 ${d}m)`);
        try { playFail(); } catch {}
        return;
      }

      // 연출
      try { setFacingByLatLng(map, playerMarker, {lat:m.lat, lng:m.lng}, 'right'); } catch {}
      try { dog?.setFacingByTarget?.(u.lat, u.lng, m.lat, m.lng); } catch {}
      try { swingSwordAt(map, playerMarker, m.lat, m.lng, true); } catch {}
      try { spawnImpactAt(map, m.lat, m.lng); } catch {}
      try { shakeMap(); } catch {}
      try { playAttackImpact({ intensity: 1.15 }); } catch {}
      try { dog?.playBark?.(); } catch {}

      // 첫 타에 타임어택 시작
      if (!chal) {
        const durationMs = getChallengeDurationMs(data.power);
        chal = { remain: Math.max(1, data.power), deadline: Date.now() + durationMs, timer: null };
        updateHUD();
        chal.timer = setInterval(() => {
          if (!chal) return;
          if (Date.now() >= chal.deadline) fail();
          else updateHUD();
        }, 80);
      }

      if (Date.now() >= chal.deadline) { fail(); return; }

      // 데미지 적용(1타=1HP)
      chal.remain = Math.max(0, chal.remain - 1);
      hpLeft = Math.max(0, hpLeft - 1);
      try { hpUI.set(hpLeft); } catch {}

      if (hpLeft <= 0) { await win(); }
      else { updateHUD(); }
    });

    // z-index 보정(이미지 위로 HP바/클릭 hit-area 노출)
    try { marker.bringToFront?.(); } catch {}
  };
}

/* ===============================
   전역 준비
   =============================== */
injectCSS();
ensureImpactCSS();

const monstersReg = new Map(); // id -> { marker, data, sizePx, bound }
let map, playerMarker;

/* ===============================
   인벤토리 유틸 (몬스터 -> 유저)
   =============================== */
const DEFAULT_DROP = [
  { id: 'potion_small', name: 'Small Potion', qty: 2, rarity: 'common' },
  { id: 'bone_fragment', name: 'Bone Fragment', qty: 3, rarity: 'common' }
];

function mergeIntoMap(baseMap, arr){
  const map = { ...(baseMap || {}) };
  for (const it of (arr || [])){
    if (!it?.id) continue;
    const key = String(it.id);
    const prev = map[key] || { name: it.name || key, qty: 0, rarity: it.rarity };
    map[key] = {
      name: prev.name || it.name || key,
      qty: Number(prev.qty || 0) + Number(it.qty || 1),
      rarity: prev.rarity || it.rarity || 'common'
    };
  }
  return map;
}

/** 몬스터 전리품 -> 유저 인벤토리(원자적) */
async function transferMonsterInventory({ monsterId, guestId }){
  const monRef = doc(db, 'monsters', String(monsterId));
  const invRef = doc(db, 'inventories', String(guestId));

  const moved = await runTransaction(db, async (tx) => {
    const monSnap = await tx.get(monRef);
    if (!monSnap.exists()) throw new Error('monster doc not found');
    const invSnap = await tx.get(invRef);

    const monData = monSnap.data() || {};
    // 1) items 우선, 2) lootTable 롤링, 3) 기본 드롭
    let items = Array.isArray(monData.items) ? monData.items : null;
    if (!items || items.length === 0) {
      if (Array.isArray(monData.lootTable) && monData.lootTable.length > 0) {
        items = rollDrops(monData.lootTable);
      }
      if (!items || items.length === 0) items = DEFAULT_DROP;
    }

    const invData = invSnap.exists() ? (invSnap.data() || {}) : {};
    const merged = mergeIntoMap(invData.items || {}, items);

    if (!invSnap.exists()){
      tx.set(invRef, { items: merged, updatedAt: Date.now() });
    } else {
      tx.update(invRef, { items: merged, updatedAt: Date.now() });
    }
    tx.update(monRef, { items: [], updatedAt: Date.now() });

    return items;
  });

  return moved || [];
}

/* ===============================
   메인
   =============================== */
async function main(){
  /* 점수/에너지 */
  await Score.init({ db, getGuestId, toast, playFail });
  Score.attachToHUD(ensureHUD());
  setHUD({ chain: Score.getChainTotal() });
  Score.updateEnergyUI();
  Score.wireRespawn();

  /* 유저/인벤토리 */
  const guestId = getGuestId();
  const inventory = new Inventory({ db, guestId, onChange: ()=>{} });
  await inventory.load();
  inventory.listen();
  const invUI = new InventoryUI({
    inventory,
    toast,
    onUseItem: async (id, item) => {
      if (id === 'red_potion') {
        await Score.addEnergy(10);
        toast(`${item.name || '빨간약'} 사용! (+10 에너지)`);
        await inventory.useItem(id, 1);
        return;
      }
      if (id === 'potion_small') {
        toast(`Used ${item.name} (+heal)`);
        await inventory.useItem(id, 1);
        return;
      }
      toast(`Used ${item.name}`);
      await inventory.useItem(id, 1);
    },
    onDropItem: async (id, item) => {
      const ok = confirm(`Drop ${item.name}?`);
      if (!ok) return;
      await inventory.dropItem(id, 1);
      toast(`Dropped ${item.name}`);
    }
  });
  invUI.mount();

  /* 지도 */
  map = L.map('map',{maxZoom:22}).setView([37.5665,126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  /* 현재 위치 */
  let userLat=null, userLon=null;
  await new Promise((res)=>{
    if (!navigator.geolocation){ res(); return; }
    navigator.geolocation.getCurrentPosition(
      p=>{ userLat=p.coords.latitude; userLon=p.coords.longitude; res(); },
      ()=>res(), {enableHighAccuracy:true, timeout:7000}
    );
  });
  if (userLat==null){ userLat=37.5665; userLon=126.9780; }

  /* 플레이어 마커 */
  playerMarker = L.marker([userLat,userLon],{
    icon: makePlayerDivIcon('../images/user/1.png', 48)
  }).addTo(map);
  map.setView([userLat,userLon], 19);

  /* 강아지 컴패니언 */
  const dog = new DogCompanion({
    map, lat: userLat, lon: userLon,
    dogUrl: '../images/user/dog.png', dogSize: 26, offsetM: 0.5,
    barkUrl: '../sounds/puppybark.mp3', barkVolume: 0.9
  });

  // 맵 클릭 시: 플레이어 방향 전환 + 강아지 재배치
  map.on('click', (e) => {
    try { setFacingByLatLng(map, playerMarker, e.latlng, 'right'); } catch {}
    try { dog.setFacingByTarget(userLat, userLon, e.latlng.lat, e.latlng.lng); } catch {}
  });

  // 피격 반짝
  const flashPlayer = () => {
    const el = playerMarker.getElement();
    if (!el) return;
    el.classList.remove('player-hit'); void el.offsetWidth;
    el.classList.add('player-hit');
  };

  /* 이동 경로 & 거리 HUD */
  const walkPath = L.polyline([[userLat,userLon]], { weight: 3, opacity: 0.9 }).addTo(map);
  let lastLat = userLat, lastLon = userLon;
  let totalWalkedM = Number(localStorage.getItem('ui_total_walk_m') || 0);
  setHUD({ distanceM: totalWalkedM });

  if (navigator.geolocation){
    navigator.geolocation.watchPosition(p=>{
      userLat=p.coords.latitude; userLon=p.coords.longitude;
      playerMarker.setLatLng([userLat,userLon]);

      // 강아지 추적
      dog.update(userLat, userLon);

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

  /* 걷기 적립 */
  const walker = new WalkPoints({ toast });
  walker.start();
  window.addEventListener('pagehide', ()=> walker?.stop());

  /* 스타트 게이트 (오디오/루프 활성) */
  let towers, monstersGuard;
  addStartGate(() => {
    try { ensureAudio(); } catch {}
    try { towers?.setUserReady(true); } catch {}
    try { monstersGuard?.setUserReady(true); } catch {}
    try { dog.warmBark(); } catch {}
  });

  /* 망루(타워) 자동 공격 */
  towers = new TowerGuard({
    map, db,
    iconUrl: "https://puppi.netlify.app/images/mon/tower.png",
    rangeDefault: 60,
    fireCooldownMs: 1500,
    getUserLatLng: ()=>[userLat, userLon],
    onUserHit: (damage, towerInfo)=>{
      flashPlayer();
      Score.deductGP(damage, towerInfo.lat, towerInfo.lon);
      try { setFacingByLatLng(map, playerMarker, {lat:towerInfo.lat, lng:towerInfo.lon}, 'right'); } catch {}
      try { dog.setFacingByTarget(userLat, userLon, towerInfo.lat, towerInfo.lon); } catch {}
      try { spawnImpactAt(map, userLat, userLon); } catch {}
      try { playAttackImpact({ intensity: 0.9 }); } catch {}
    }
  });

  // 첫 포인터 시 오디오 재개
  window.addEventListener('pointerdown', ()=>{
    try { ensureAudio(); } catch {}
    try { towers.resumeAudio(); } catch {}
    try { monstersGuard.resumeAudio(); } catch {}
  }, { once:true, passive:true });

  /* 몬스터 자동 공격(망루처럼) — 마커는 여기서 안 그림 */
  monstersGuard = new MonsterGuard({
    map, db,
    iconUrl: "https://puppi.netlify.app/images/mon/monster.png",
    rangeDefault: 50,
    fireCooldownMs: 1800,
    getUserLatLng: ()=>[userLat, userLon],
    onUserHit: (damage, mon)=>{
      flashPlayer();
      Score.deductGP(damage, mon.lat, mon.lon);
    },
    renderMarkers: false
  });

  /* 전투 바인딩 함수 생성 */
  const attachMonsterBattle = createAttachMonsterBattle({
    map, playerMarker, dog, Score, toast,
    ensureAudio, isInRange, distanceToM, setFacingByLatLng,
    swingSwordAt, attackOnceToward, spawnImpactAt, shakeMap, playAttackImpact, playFail, playDeath,
    attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
    monstersGuard
  });

  /* === Firestore 실시간: 추가/수정/삭제 모두 단일화 === */
  onSnapshot(collection(db, 'monsters'), (qs) => {
    const now = Date.now();

    qs.docChanges().forEach(ch => {
      const s = ch.doc;
      const d = s.data() || {};
      const id = s.id;

      const alive = (d.alive !== false) && (d.dead !== true);
      const respawnAt = Number(d.respawnAt || 0);
      const hasPos = Number.isFinite(d.lat) && Number.isFinite(d.lon);
      const shouldShow = alive && respawnAt <= now && hasPos;
      
      // 표시/갱신
      if (shouldShow) {
        if (!monstersReg.has(id)) {
          const n = Number(d.size);
          const sizePx = Number.isNaN(n) ? 96 : Math.max(24, Math.min(n, 256));
          const icon = makeImageDivIcon(d.imagesURL ?? d.imageURL ?? d.iconURL ?? DEFAULT_IMG, sizePx);
          const marker = L.marker([d.lat, d.lon], { icon, interactive: true }).addTo(map);

          const rec = { marker, data: d, sizePx, bound: false };
          monstersReg.set(id, rec);

          // 최초 생성 시 즉시 바인딩
          attachMonsterBattle(marker, id, d, sizePx);
          rec.bound = true;
        } else {
          const rec = monstersReg.get(id);
          rec.marker.setLatLng([d.lat, d.lon]);

          // 아이콘/사이즈 변경 시 DOM 재구성 → 재바인딩 필요
          const n = Number(d.size);
          const newSize = Number.isNaN(n) ? 96 : Math.max(24, Math.min(n, 256));
          const imgChanged =
            (rec.data?.imagesURL ?? rec.data?.imageURL ?? rec.data?.iconURL) !==
            (d.imagesURL ?? d.imageURL ?? d.iconURL);

          if (imgChanged || rec.sizePx !== newSize) {
            rec.marker.setIcon(makeImageDivIcon(d.imagesURL ?? d.imageURL ?? d.iconURL ?? DEFAULT_IMG, newSize));
            rec.sizePx = newSize;
            rec.bound = false; // 아이콘 교체 시 HP바/클릭 재부착 필요
          }
          rec.data = d;

          // 부활(modified) 등으로 아직 바인딩이 없다면 재부착
          if (!rec.bound) {
            attachMonsterBattle(rec.marker, id, d, rec.sizePx);
            rec.bound = true;
          }
          
        }
      }
      // 제거
      else {
        if (monstersReg.has(id)) {
          const rec = monstersReg.get(id);
          try { rec.marker.remove(); } catch {}
          try { map.removeLayer(rec.marker); } catch {}
          try { rec.marker.getElement()?.remove(); } catch {}
          monstersReg.delete(id);
        }
      }
    });
  });
}

main();
