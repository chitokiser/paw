// /geolocation/js/main.js
// - RT/Guard 확실히 start() + 전역 디버그 핸들(window.rt, window.guard)
// - Score가 단일 SoT: HUD 동기화는 Score 상태만 사용
// - 인벤은 identity.getInventoryId() 기준으로 구독
// - 상점/보물/전투/벼락/마제스틱 퀵사용까지 부트스트랩

import { db } from './firebase.js';
import {
  ensureAudio, playFail, playDeath, playAttackImpact,
  playThunderBoom, playLightningImpact, playReward, playCrit ,setMajesticSfxUrl 
} from './audio.js';
import { injectCSS, toast, ensureHUD, setHUD, addStartGate, mountCornerUI } from './ui.js';
import { makePlayerDivIcon, getChallengeDurationMs, getGuestId, haversineM } from './utils.js';
import { getInventoryId } from './identity.js';
import { TowerGuard } from './tower.js';
import { Score } from './score.js';
import { MonsterGuard } from './monster.js';
import { useItem } from './items.js';

import {
  ensureImpactCSS, spawnImpactAt, shakeMap,
  attachHPBar, ensureMonsterAniCSS, setAniBase,
  attachSpriteToMarker, spawnLightningAt
} from './fx.js';

import { attackOnceToward, ensurePlayerFacingCSS, setFacingByLatLng } from './playerFx.js';
import DogCompanion from './dogCompanion.js';

import { createAttachMonsterBattle, getCurrentBattleTarget } from './battle.js';
import { RealTimeMonsters } from './monstersRT.js';
import { transferMonsterInventory } from './inventoryTransfer.js';
import { Inventory } from './inventory.js';
import { InventoryUI } from './inventoryUI.js';
import { Treasures } from './treasures.js';
import { Shops } from './shops.js';

// ✅ 새로 분리된 퀵사용 모듈
import { setupLightningQuickUse } from './quick/lightningQuick.js';
import { setupMajesticBallQuickUse } from './quick/majesticQuick.js';

// ───────────────── CSS/애니 셋업 ─────────────────
injectCSS();
ensureImpactCSS();
ensureMonsterAniCSS();
setAniBase('https://puppi.netlify.app/images/ani/');

let map, playerMarker;
let userLat = null, userLon = null;

/* ──────────────────────────────────────────────────────────────
 * CP DOM 폴백 갱신(레거시 HUD 지원)
 * ────────────────────────────────────────────────────────────── */
function __updateCPDom(cpValue) {
  const v = Number(cpValue ?? 0);
  const sels = ['.hud-cp-text','#hudCPText','#hud .cp-text','#hud .bp-text'];
    for (const sel of sels) {   const el = document.querySelector(sel);  if (el) el.textContent = String(v); }
 }
try {
 const url = new URL('../sounds/hit/maje.mp3', import.meta.url).href;
 setMajesticSfxUrl(url);
} catch {
  // 모듈이 아니거나 import.meta.url 미지원일 때(rare): 프로젝트 구조에 맞게 절대경로로
  setMajesticSfxUrl('/geolocation/sounds/hit/maje.mp3');
}

/* =============================== 메인 =============================== */
export async function main() {
  // 0) 지갑 바인드
  const addr = await Score.bindWallet?.();
  if (!addr) { alert('지갑을 먼저 연결해 주세요'); return; }

  // 1) Score 초기화 & HUD 연결
  const hud = ensureHUD();
  try { await Score.init({ db, getGuestId, toast, playFail }); } catch (e) { console.warn('[Score.init] fail', e); }
  try {
    Score.attachToHUD(hud);
    const syncHUD = (s) => {
      const hpMax = Number(s.maxHp ?? s.hpMax ?? (s.level ? s.level * 1000 : 1000));
      const hp    = Math.max(0, Math.min(Number(s.hp ?? 0), hpMax));
      const cp    = Number(s.cp ?? s.chainPoint ?? 0);
      setHUD({
        level: s.level ?? 1,
        hp, hpMax,
        hpPct: hpMax > 0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0,
        exp: s.exp ?? 0,
        attack: s.attack ?? (s.level ?? 1),
        defense: s.defense ?? 10,
        distanceM: s.distanceM ?? 0,
        cp, chainPoint: cp
      });
      __updateCPDom(cp);
    };
    try { syncHUD(Score.getStats?.() || {}); } catch {}
    Score.onChange?.(syncHUD);
    Score.updateEnergyUI?.();
    Score.wireRespawn?.();
  } catch (e) { console.warn('[Score HUD setup] fail', e); }

  // 2) 인벤토리
  const invId = getInventoryId();
  const inv = new Inventory({ db, guestId: invId, onChange: (items)=>console.log('[inv] change', items) });
  try { await inv.load({ autoListen:true }); } catch (e) { console.warn('[Inventory.load] fail', e); }

  const invUI = new InventoryUI({
    inventory: inv,
    toast,
    // 개별 아이템 사용 로직은 items.js에서; 여기선 인벤만 갱신
  onUseItem: async (id) => {
    // 플레이어 좌표 & 주변 몬스터 리졸브(마제스틱 등 공통)
    const pLL = playerMarker?.getLatLng?.();
    const getNearbyHostiles = (radiusM) => {
      const out = [];
      try {
        const center = playerMarker?.getLatLng?.() || map?.getCenter?.(); if (!center) return out;
        if (window.__rtMon && window.__rtMon.reg instanceof Map) {
          for (const [mid, rec] of window.__rtMon.reg) {
            const ll = rec?.marker?.getLatLng?.(); if (!ll) continue;
            const d = (typeof map?.distance === 'function') ? map.distance(center, ll) : 1e9;
            if (d <= (radiusM || 10)) {
              out.push({
                id: mid, docId: rec?.data?.docId || mid, uid: rec?.data?.uid,
                monsterId: rec?.data?.monsterId, _id: mid,
                getLatLng: () => ll,
                battleCtrl: rec?.battleCtrl, hit: rec?.battleCtrl?.hit
              });
            }
          }
        }
      } catch {}
      return out;
    };
    try {
      await useItem(id, {
        map, inv, toast,
        player: pLL && { lat: pLL.lat, lng: pLL.lng },
        getNearbyHostiles,
      });
    } catch (e) {
      console.warn('[inv use via items.useItem]', e);
    }
  },

    onDropItem: async (id) => { await inv.dropItem(id, 1); },
  });
  try { invUI.mount(); } catch (e) { console.error('[InventoryUI] mount failed:', e); }

  // 3) 지도
  map = L.map('map', { maxZoom: 22 }).setView([37.5665, 126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  await new Promise((res) => {
    if (!navigator.geolocation) { res(); return; }
    navigator.geolocation.getCurrentPosition(
      p => { userLat = p.coords.latitude; userLon = p.coords.longitude; res(); },
      () => res(),
      { enableHighAccuracy: true, timeout: 7000 }
    );
  });
  if (userLat == null) { userLat = 37.5665; userLon = 126.9780; }

  // 플레이어 마커
  playerMarker = L.marker([userLat, userLon], { icon: makePlayerDivIcon('../images/user/1.png', 38) }).addTo(map);
  try { playerMarker.getElement()?.classList?.add('player-idle'); } catch {}
  map.setView([userLat, userLon], 19);

  ensurePlayerFacingCSS();
  try {
    const cur = playerMarker.getLatLng();
    setFacingByLatLng(map, playerMarker, L.latLng(cur.lat, cur.lng + 0.00001), 'right');
  } catch {}

  // idle(숨쉬기) 효과
  (function ensurePlayerIdleCSS() {
    if (document.getElementById('player-idle-css')) return;
    const css = `.player-idle img{animation:playerBreath 1.4s ease-in-out infinite; transform-origin:50% 85%;}
@keyframes playerBreath{0%{transform:scale(1)}50%{transform:scale(1.025)}100%{transform:scale(1)}}`;
    const s = document.createElement('style'); s.id = 'player-idle-css'; s.textContent = css; document.head.appendChild(s);
  })();

  // 코너 UI
  try { mountCornerUI?.({ map, playerMarker, invUI }); } catch {}

  // 강아지 동행
  const dog = new DogCompanion({
    map, lat: userLat, lon: userLon,
    dogUrl: '../images/user/dog.png', dogSize: 26, offsetM: 0.5,
    barkUrl: '../sounds/puppybark.mp3', barkVolume: 0.9
  });

  map.on('click', (e) => {
    try {
      const { lat: uLat, lng: uLng } = playerMarker?.getLatLng?.() ?? { lat: userLat, lng: userLon };
      setFacingByLatLng(map, playerMarker, e.latlng);
      dog.setFacingByTarget(uLat, uLng, e.latlng.lat, e.latlng.lng);
    } catch (err) { console.warn('[click face] err', err); }
  });

  // 이동 경로 + HUD(거리)
  const walkPath = L.polyline([[userLat, userLon]], { weight: 3, opacity: 0.9 }).addTo(map);
  let lastLat = userLat, lastLon = userLon;
  let totalWalkedM = Number(localStorage.getItem('ui_total_walk_m') || 0);
  setHUD({ distanceM: totalWalkedM });

  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(p => {
      userLat = p.coords.latitude; userLon = p.coords.longitude;
      playerMarker.setLatLng([userLat, userLon]);
      dog.update(userLat, userLon);
      walkPath.addLatLng([userLat, userLon]);

      if (Number.isFinite(lastLat) && Number.isFinite(lastLon)) {
        const seg = haversineM(lastLat, lastLon, userLat, userLon);
        if (seg >= 0.5) {
          totalWalkedM += seg;
          localStorage.setItem('ui_total_walk_m', String(totalWalkedM));
          setHUD({ distanceM: totalWalkedM });
        }
      }
      lastLat = userLat; lastLon = userLon;
    }, () => { }, { enableHighAccuracy: true });
  }

  const flashPlayer = () => {
    const el = playerMarker.getElement(); if (!el) return;
    el.classList.remove('player-hit'); void el.offsetWidth; el.classList.add('player-hit');
  };

  // 타워
  const towers = new TowerGuard({
    map, db,
    iconUrl: 'https://puppi.netlify.app/images/mon/tower.png',
    rangeDefault: 60, fireCooldownMs: 1500,
    getUserLatLng: () => {
      const { lat, lng } = playerMarker.getLatLng();
      return [lat, lng];
    },
    onUserHit: (damage) => {
      const { lat, lng } = playerMarker.getLatLng();
      try {
        flashPlayer();
        Score.deductHP(damage, lat, lng);
        spawnImpactAt(map, lat, lng);
        shakeMap();
        playAttackImpact({ intensity: 1.0 });
      } catch {}
    }
  });
  towers.setUserReady(true);

  // 몬스터 가드
  const monstersGuard = new MonsterGuard({
    map, db,
    rangeDefault: 50, fireCooldownMs: 1800,
    getUserLatLng: () => {
      try { const { lat, lng } = playerMarker.getLatLng(); return [lat, lng]; }
      catch { return [userLat, userLon]; }
    },
    onUserHit: (damage, mon) => {
      flashPlayer();
      try {
        Score.deductHP(damage, mon?.lat, mon?.lon);
        const { lat: uLat, lng: uLng } = playerMarker.getLatLng();
        spawnImpactAt(map, uLat, uLng);
        shakeMap();
        playAttackImpact({ intensity: 1.0 });
      } catch {}
    },
    useTiles: true
  });

  // 전투 바인더
  const attachMonsterBattle = createAttachMonsterBattle({
    db, map, playerMarker, dog, Score, toast,
    ensureAudio, setFacingByLatLng, attackOnceToward,
    spawnImpactAt, shakeMap, playAttackImpact, playFail, playDeath,
    attachHPBar, getChallengeDurationMs,
    transferMonsterInventory, getGuestId,
    monstersGuard, setHUD, attachSpriteToMarker
  });

  // 실시간 몬스터 렌더러
  const rtMon = new RealTimeMonsters({ db, map, attachMonsterBattle, monstersGuard });
  rtMon.start();
  try { window.__rtMon = rtMon; } catch {}

  // 전역 디버그
  window.rt = {
    start(){ rtMon.start(); return !!rtMon._started; },
    stop(){ rtMon.stop(); return !!rtMon._started; },
    started(){ return !!rtMon._started; },
    count(){ return rtMon.reg.size; },
    list(){ return Array.from(rtMon.reg.entries()).map(([id, rec]) => ({
      id, lat: rec?.marker?.getLatLng?.()?.lat, lon: rec?.marker?.getLatLng?.()?.lng, anim: rec?.animState
    })); },
    dump(){
      const ids = Array.from(rtMon.reg.keys()).slice(0,10);
      console.log('[rt] started:', rtMon._started, 'count:', rtMon.reg.size, 'sample:', ids);
      return { started: rtMon._started, count: rtMon.reg.size, sample: ids };
    },
    guard:{
      started(){ return !!monstersGuard?._started; },
      ready(v){ monstersGuard.setUserReady?.(!!v); return !!v; },
      cool(id,ms=30000){ monstersGuard.stopAttacksFrom?.(id,ms); return true; },
      kill(id,ms=60000){ monstersGuard.markKilled?.(id,ms); return true; },
    }
  };
  monstersGuard.setUserReady?.(true);
  monstersGuard.start?.();

  try { window.guard = monstersGuard; } catch {}
  window.addEventListener('pointerdown', () => {
    try {
      ensureAudio(); towers.resumeAudio?.(); monstersGuard.resumeAudio?.();
      towers.start?.(); monstersGuard.start?.();
    } catch {}
  }, { once: true, passive: true });
  addStartGate(() => { try { ensureAudio(); towers.setUserReady?.(true); monstersGuard.setUserReady?.(true); } catch {} });

  // 보물 & 상점
  new Treasures({
    db, map, playerMarker, toast,
    attachHPBar, spawnImpactAt, shakeMap, playAttackImpact,
    transferMonsterInventory, getGuestId, Score, inv
  }).start();

  new Shops({ db, map, playerMarker, Score, toast, inv, transferMonsterInventory, getGuestId }).start();

  // ⚡ 벼락소환 퀵 사용 (모듈화)
  setupLightningQuickUse({ map, inv, toast, playerMarker, getCurrentBattleTarget });

  // 💥 마제스틱 볼 퀵 사용 (모듈화)
  setupMajesticBallQuickUse({ map, inv, toast, rtMon, playerMarker });
}
