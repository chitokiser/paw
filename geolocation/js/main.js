// /geolocation/js/main.js
import { auth, db } from './firebase.js';
import {
  ensureAudio, playFail, playDeath, playAttackImpact,
  playThunderBoom, playLightningImpact, playReward, playCrit
} from './audio.js';
import { injectCSS, toast, ensureHUD, setHUD, addStartGate, mountCornerUI } from './ui.js';
import { makePlayerDivIcon, getChallengeDurationMs, getGuestId, haversineM } from './utils.js';
import { getInventoryId } from './identity.js';
import { TowerGuard } from './tower.js';
import { Score } from './score.js';
import { MonsterGuard } from './monster.js';

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
import { ensureUserDoc } from './auth.js';

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
  const selectors = [
    '.hud-cp-text',   // 신규
    '#hudCPText',     // 과거 id
    '#hud .cp-text',  // 다른 테마
    '#hud .bp-text',  // “블록체인 포인트”를 bp로 표기했던 테마
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) el.textContent = String(v);
  }
}

/* =============================== 메인 =============================== */
export async function main() {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.warn('[main] no auth user; abort');
    return;
  }

  // 0) 사용자 문서 보장(없으면 생성)
  try { await ensureUserDoc(uid, auth.currentUser?.email || ''); }
  catch (e) { console.warn('[ensureUserDoc] failed (non-fatal)', e); }

  // 1) Score 초기화 & HUD 연결 — Score가 단일 SoT
  const hud = ensureHUD();
  try {
    await Score.init({ db, getGuestId, toast, playFail });
  } catch (e) {
    console.warn('[Score.init] fail 1st', e);
    try {
      await ensureUserDoc(uid, auth.currentUser?.email || '');
      await Score.init({ db, getGuestId, toast, playFail });
    } catch (e2) {
      console.error('[Score.init] fail 2nd', e2);
    }
  }

  try {
    Score.attachToHUD(hud);

    // ✅ HUD는 Score 값만 반영 (hpMax 포함) + cp/chainPoint 동시 전달 + DOM 폴백
    const syncHUD = (s) => {
      const hpMax = Number(s.maxHp ?? s.hpMax ?? (s.level ? s.level * 1000 : 1000));
      const hp    = Math.max(0, Math.min(Number(s.hp ?? 0), hpMax));
      const cp    = Number(s.cp ?? 0);

      setHUD({
        level    : s.level ?? 1,
        hp       : hp,
        hpMax    : hpMax,
        hpPct    : hpMax > 0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0,
        exp      : s.exp ?? 0,
        attack   : s.attack ?? (s.level ?? 1),
        defense  : s.defense ?? 10,
        distanceM: s.distanceM ?? 0,
        cp       : cp,   // 표준 키
        chainPoint: cp,  // 하위호환 키(레거시 HUD 지원)
      });

      // HUD 구현이 setHUD의 cp를 무시해도 DOM 직접 갱신(레거시 선택자 포함)
      __updateCPDom(cp);
    };

    // 초기 1회 + 상태 변경 시마다 동기화
    try { syncHUD(Score.getStats?.() || {}); } catch {}
    Score.onChange(syncHUD);

    // 레거시 훅(있으면만)
    Score.updateEnergyUI?.();
    Score.wireRespawn?.();
  } catch(e){ console.warn('[Score HUD setup] fail', e); }

  // 2) 인벤토리
  const invId = getInventoryId();
  const inv = new Inventory({ db, guestId: invId, onChange: (items)=>console.log('inv change', items) });
  try { await inv.load({ autoListen:true }); }
  catch(e){ console.warn('[Inventory.load] fail', e); }
  try { await inv.load({ autoListen:true }); }
  catch(e){ console.warn('[Inventory.load] fail', e); }

  const invUI = new InventoryUI({
    inventory: inv,
    toast,
    onUseItem: async (id) => {
      if (id === 'red_potion') {
        try {
          const s = Score.getStats?.() || {};
          const hpMax = Number(s.maxHp ?? 1000);
          const newHP = Math.min(hpMax, Number(s.hp ?? 0) + 10);
          await Score.setHP?.(newHP);
          Score.updateHPUI?.();
          toast?.('빨간약 사용! (+10 HP)');
        } catch (e) {
          console.warn('[use red_potion] hp add failed', e);
        }
      }

      // ⚡ 벼락 소환 아이템
      if (id === 'lightning_summon' || id === 'lightning_talisman' || id === '벼락소환') {
        try {
          ensureAudio();
          const tgt = (typeof getCurrentBattleTarget === 'function' ? getCurrentBattleTarget() : null)
            || (typeof window !== 'undefined' ? window.__battleCtrlLast : null)
            || null;
          if (!tgt || tgt.isDead?.()) { toast?.('대상이 없습니다. 몬스터를 먼저 지정하세요.'); return; }

          const ll = tgt.getLatLng?.();
          if (!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) { toast?.('대상 좌표를 찾지 못했습니다.'); return; }
          try { spawnLightningAt(map, ll.lat, ll.lng, { flashScreen: true, shake: true }); } catch {}
          try { playThunderBoom({ intensity: 1.2 }); } catch {}

          await tgt.hit?.(1000, { lightning: true, crit: true });
          await inv.useItem(id, 1);
          toast?.('⚡ 벼락소환! 대상에게 1000 데미지');
        } catch (e) {
          console.warn('[lightning item] use error', e);
          toast?.('아이템 사용에 실패했습니다.');
        }
        return;
      }

      await inv.useItem(id, 1);
    },
    onDropItem: async (id) => { await inv.dropItem(id, 1); },
  });

  try { invUI.mount(); }
  catch (e) { console.error('[InventoryUI] mount failed:', e); }

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
  playerMarker = L.marker([userLat, userLon], {
    icon: makePlayerDivIcon('../images/user/1.png', 38)
  }).addTo(map);
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
    const css = `
      .player-idle img{ animation:playerBreath 1.4s ease-in-out infinite; transform-origin:50% 85%; }
      @keyframes playerBreath{ 0%{transform:scale(1)} 50%{transform:scale(1.025)} 100%{transform:scale(1)} }
    `;
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
    } catch (err) {
      console.warn('[click face] err', err);
    }
  });

  // 이동 경로 + HUD(거리) — 거리 표시는 UI 전용, 적립은 Score가 처리
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
          setHUD({ distanceM: totalWalkedM }); // 시각값만, 적립은 Score가 별도 로직으로
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
        Score.deductHP(damage, mon.lat, mon.lon);
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

  // 실시간 몬스터
  const rtMon = new RealTimeMonsters({ db, map, attachMonsterBattle, monstersGuard });
  rtMon.start();
  try { window.__rtMon = rtMon; } catch {}
  monstersGuard.setUserReady?.(true);
  monstersGuard.start?.();

  // 오디오/타이머 재개
  window.addEventListener('pointerdown', () => {
    try {
      ensureAudio(); towers.resumeAudio?.(); monstersGuard.resumeAudio?.();
      towers.start?.(); monstersGuard.start?.();
    } catch {}
  }, { once: true, passive: true });

  addStartGate(() => {
    try { ensureAudio(); towers.setUserReady?.(true); monstersGuard.setUserReady?.(true); } catch {}
  });

  // 보물 & 상점
  new Treasures({
    db, map, playerMarker, toast,
    attachHPBar, spawnImpactAt, shakeMap, playAttackImpact,
    transferMonsterInventory, getGuestId, Score, inv
  }).start();

  new Shops({
    db, map, playerMarker, Score, toast,
    inv, transferMonsterInventory, getGuestId
  }).start();

  // ⚡ 퀵 사용(데스크탑=L키 / 모바일=플로팅 버튼)
  setupLightningQuickUse({ map, inv, toast });
}

/* ──────────────────────────────────────────────────────────────
 * 벼락소환 퀵 사용: 데스크탑=L키, 모바일=플로팅 버튼
 * ────────────────────────────────────────────────────────────── */
function setupLightningQuickUse({ map, inv, toast }) {
  const hasTouch = matchMedia?.('(pointer: coarse)')?.matches || ('ontouchstart' in window);

  const isTypingElement = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select', 'button'].includes(tag)) return true;
    return !!el.isContentEditable;
  };

  async function triggerLightning() {
    try { ensureAudio(); } catch {}
    const ctrl =
      (typeof getCurrentBattleTarget === 'function' && getCurrentBattleTarget())
      || window.__activeBattleCtrl || null;

    if (!ctrl || ctrl.isDead?.()) { toast?.('대상이 없습니다. 몬스터를 먼저 공격하세요'); return; }

    const all = (typeof inv.getAll === 'function' ? inv.getAll() : (inv.items || {})) || {};
    const cnt = Number(all.lightning_summon?.qty || 0);
    if (cnt <= 0) { toast?.('벼락소환 아이템이 없습니다'); return; }

    try {
      const { lat, lng } = ctrl.getLatLng?.() || {};
      if (lat != null && lng != null) {
        try { spawnLightningAt(map, lat, lng, { flashScreen: true, shake: true }); } catch {}
        try { playLightningImpact({ intensity: 1.0, withBoom: true }); } catch {}
      }
    } catch {}

    await ctrl.hit(1000, { lightning: true, crit: true });
    await inv.dropItem('lightning_summon', 1);

    toast?.('⚡ 벼락! 1000 데미지');
    refreshBadge();
  }

  document.addEventListener('keydown', (e) => {
    if (!e || e.repeat) return;
    if (isTypingElement(e.target)) return;
    if ((e.key || '').toLowerCase() !== 'l') return;
    e.preventDefault();
    e.stopPropagation();
    triggerLightning();
  }, { capture: true });

  let btn = null, badge = null;
  if (hasTouch) {
    btn = document.createElement('button');
    btn.id = 'lightning-quick-btn';
    btn.title = '벼락소환 (L)';
    btn.innerHTML = '⚡';
    Object.assign(btn.style, {
      position: 'fixed', right: '16px', bottom: '84px',
      width: '56px', height: '56px', borderRadius: '16px',
      border: 'none', background: '#111827', color: '#fff',
      fontSize: '26px', boxShadow: '0 10px 30px rgba(0,0,0,.35)',
      zIndex: 2147483647
    });
    btn.addEventListener('click', triggerLightning, { passive: true });
    document.body.appendChild(btn);

    badge = document.createElement('div');
    Object.assign(badge.style, {
      position: 'fixed', right: '12px', bottom: '78px',
      minWidth: '20px', padding: '2px 6px', borderRadius: '999px',
      background: '#f59e0b', color: '#111', fontWeight: '800',
      fontSize: '12px', textAlign: 'center', zIndex: 2147483647
    });
    document.body.appendChild(badge);
  }

  function refreshBadge() {
    if (!badge) return;
    const all = (typeof inv.getAll === 'function' ? inv.getAll() : (inv.items || {})) || {};
    const cnt = Number(all.lightning_summon?.qty || 0);
    badge.textContent = 'x' + cnt;
    badge.style.display = cnt > 0 ? 'block' : 'none';
  }

  try {
    const prev = inv._onChange;
    inv._onChange = (items) => { try { prev?.(items); } catch {} refreshBadge(); };
  } catch {}
  refreshBadge();
}
