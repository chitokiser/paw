// /geolocation/js/battle.js
import { getEquippedWeapon } from './equipment.js';

// 현재 전투 타깃 getter(외부에서 읽음)
export let getCurrentBattleTarget = () => null;
export function _setCurrentBattleTarget(fn){ getCurrentBattleTarget = fn; }

// === Battle Target Helpers (drop-in, no import) ===
(function(){
  if (window.setBattleTarget) return; // 이미 있으면 재정의 금지
  window.__currentBattleTarget = null;    // 현재 전투 타깃(SSOT)
  window.__lastHitMonster = null;         // 최근 피격 대상(폴백)
  window.setBattleTarget = function(t){
    window.__currentBattleTarget = t || null;
    // 레거시 호환(기존 코드가 쓰던 변수)
    window.__battleCtrlLast = window.__currentBattleTarget;
  };
})();

// FX / 오디오
import {
  spawnImpactAt as fxSpawnImpactAt,
  shakeMap as fxShakeMap,
  spawnCritLabelAt, spawnLightningAt,
  flashCritRingOnMarker
} from './fx.js';
import {
  playAttackImpact as importedPlayAttackImpact,
  playCrit, playDeathForMid, playDeath, playMonsterHitForMid,
  playThunderBoom
} from './audio.js';

// 죽은 몬스터 전역 레지스트리 + 헬퍼
window.__pf_deadMonsters = window.__pf_deadMonsters || new Set();

export const markMonsterDead = (id) => {
  try { window.__pf_deadMonsters.add(id); } catch {}
};

export const isMonsterDead = (id) => {
  try {
    if (window.__pf_deadMonsters.has(id)) return true;
    // (쿨다운 TTL도 죽은 것으로 간주)
    const ttl = Number(localStorage.getItem('mon_cd:'+id) || 0);
    return ttl > Date.now();
  } catch { return false; }
};

export function createAttachMonsterBattle({
  db, map, playerMarker, dog, Score, toast,
  ensureAudio, setFacingByLatLng, attackOnceToward,

  // 주입 가능(있으면 우선)
  spawnImpactAt: injSpawnImpactAt,
  shakeMap: injShakeMap,
  playAttackImpact, playFail,

  // HUD/인벤토리/RT
  attachHPBar, transferMonsterInventory, getGuestId,
  monstersGuard, setHUD,

  // 스프라이트 어태치(선택)
  attachSpriteToMarker: injAttachSpriteToMarker
}) {
  const _spawnImpactAt = injSpawnImpactAt || fxSpawnImpactAt;
  const _shakeMap      = injShakeMap      || fxShakeMap;
  const _playAttackImpact = playAttackImpact || importedPlayAttackImpact;
  const _attachSpriteToMarker = injAttachSpriteToMarker || null;

  // ── 시야 보정
  const FACING_THRESH_PX = 8;
  const faceTowards = (targetLL) => {
    const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
    const p2 = map.latLngToLayerPoint(targetLL);
    const dx = p2.x - p1.x;
    const dir = dx > FACING_THRESH_PX ? 'right' : (dx < -FACING_THRESH_PX ? 'left' : null);
    if (dir) { try { setFacingByLatLng(map, playerMarker, targetLL, dir); } catch {} }
  };

  // 히트 FX
  const showHitFX = (marker, lat, lng, { crit = false } = {}) => {
    try {
      _spawnImpactAt(map, lat, lng);
      if (crit) {
        spawnCritLabelAt?.(map, lat, lng, { text: 'CRIT!', ms: 700 });
        flashCritRingOnMarker?.(marker, { ms: 500 });
      }
    } catch {}
    try { _playAttackImpact({ intensity: crit ? 1.6 : 1.15, includeWhoosh: crit, critical: crit }); } catch {}
    try { _shakeMap(); } catch {}
    if (crit) { try { playCrit(); } catch {} }
  };

  function _getSheetURLAndScale(marker, mid, frameW = 200, frameH = 200) {
    const root = marker?.getElement();
    let url = '', scale = 1;
    if (root) {
      const el = root.querySelector('.ani-first') || root.querySelector('.mon-wrap') || root;
      if (el) {
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundImage || '';
        const m  = bg.match(/url\(["']?(.+?)["']?\)/i);
        if (m) url = m[1];
        const rect = el.getBoundingClientRect();
        const shownW = rect.width  || (marker?.options?.icon?.options?.iconSize?.[0] || frameW);
        const shownH = rect.height || (marker?.options?.icon?.options?.iconSize?.[1] || frameH);
        const sx = shownW / frameW, sy = shownH / frameH;
        scale = Math.max(0.01, Math.min(sx, sy));
      }
    }
    if (!url && mid != null) url = `https://puppi.netlify.app/images/ani/${encodeURIComponent(mid)}.png`;
    return { url, scale };
  }

  function attachMonsterBattle(marker, monsterId, raw = {}) {
    if (!marker || !monsterId) return;

    const data = {
      lat: raw.lat, lon: raw.lon,
      mid: raw.mid ?? raw.mId ?? raw.animId ?? null,
      power: Number.isFinite(raw.power) ? +raw.power : 20,
      hp: Number.isFinite(raw.hp) ? +raw.hp : undefined,
      cooldownMs: Number.isFinite(raw.cooldownMs) ? +raw.cooldownMs : 2000,
      approachMaxM: Number.isFinite(raw.approachMaxM) ? +raw.approachMaxM : 10,
      meleeRange: Number.isFinite(raw.meleeRange) ? +raw.meleeRange : 1.6,
      approachSpeedMps: Number.isFinite(raw.approachSpeedMps) ? +raw.approachSpeedMps : 6.2,
      critChance: Number.isFinite(raw.critChance) ? +raw.critChance : 0.3
    };

    // HP Bar
    let hpLeft = Math.max(1, Number(data.hp ?? data.power));
    const hpMax0 = hpLeft; // 처치 보상 산정 기준(스폰 시 체력/파워)
    let hpUI = { set: () => {} };
    setTimeout(() => { try { hpUI = attachHPBar(marker, hpLeft) || { set: () => {} }; hpUI.set(hpLeft); } catch {} }, 0);

    const clearActive = () => {
      try {
        if (window.__activeBattleCtrl && window.__activeBattleCtrl.id === monsterId) window.__activeBattleCtrl = null;
        if (window.__battleCtrlById instanceof Map) window.__battleCtrlById.delete(monsterId);
      } catch {}
    };

    const setDead = () => {
      markMonsterDead(monsterId);
      try { marker.options.interactive = false; marker.off('click'); marker._pf_dead = true; } catch {}
      try { monstersGuard?.stopAttacksFrom?.(monsterId); } catch {}
      try {
        const ttl = Number(data.cooldownMs || 60000);
        monstersGuard?.markKilled?.(monsterId, ttl);
        localStorage.setItem('mon_cd:' + monsterId, String(Date.now() + ttl));
      } catch {}
      clearActive();
      try { marker.getElement()?.querySelector?.('.hpbar, .hp-bar, .hp')?.remove?.(); } catch {}
      // ✅ 사망 시 현재 타깃이면 해제
      try {
        const cur = window.__currentBattleTarget;
        if (cur && (cur === marker._pf_ctrl || cur?.id === monsterId)) {
          window.setBattleTarget?.(null);
        }
      } catch {}
    };

    const win = async () => {
      setDead();
      try { if (data.mid) playDeathForMid(data.mid); else playDeath?.(); } catch {}

      // === EXP & CP 보상 (기존 구조 준수) ===
      try {
        const expGain = Math.max(1, Math.round(hpMax0 * 0.5));   // 예: 체력의 50%
        const cpGain  = Math.max(0, Math.floor(hpMax0 / 10));    // 예: 체력의 10% (정수)

        if (typeof Score?.addExp === 'function') {
          await Score.addExp(expGain);
          toast?.(`EXP +${expGain}`);
        }
        if (cpGain > 0 && typeof Score?.addCP === 'function') {
          await Score.addCP(cpGain);
          toast?.(`+${cpGain} CP (처치 보상)`);
        }
      } catch (e) { console.warn('[battle] EXP/CP reward fail', e); }

      // 전리품 이동
      try {
        const gid = (getGuestId?.() || Score?.getGuestId?.() || localStorage.getItem('guestId') || 'guest');
        const moved = await transferMonsterInventory(db, { monsterId, guestId: gid });
        toast(moved?.length ? `전리품: ${moved.map(it => `${it.name || it.id} x${it.qty || 1}`).join(', ')}` : `처치 완료!`);
      } catch (e) { console.warn('[battle] loot transfer fail', e); toast('전리품 이전 실패.'); }

      setTimeout(() => { try { map.removeLayer(marker); } catch {} }, 900);
    };

    const fail = () => { try { playFail?.(); } catch {}; toast('실패… 다시!'); };

    // === 외부 컨트롤러(스킬/번개/도트 등 외부 피해 반영용) ===
    const ctrl = {
      id: monsterId,
      marker,
      getLatLng: () => marker.getLatLng?.(),
      isDead: () => !!marker._pf_dead,
      /** 몬스터가 외부 요인으로 피해(양수) */
      async hit(amount = 1, opts = {}) {
        if (marker._pf_dead) return;
        const nowLL = marker.getLatLng();
        try {
          if (opts.lightning) {
            // ⚡ 벼락 이펙트 + 사운드
            spawnLightningAt?.(map, nowLL.lat, nowLL.lng, { flashScreen:true, shake:true });
            try { playThunderBoom?.({ intensity: 1.2 }); } catch {}
          } else {
            showHitFX(marker, nowLL.lat, nowLL.lng, { crit: !!opts.crit });
          }
          _playAttackImpact({ intensity: opts.lightning ? 1.8 : 1.2, includeWhoosh:false });
          _shakeMap();
        } catch {}
        const dmg = Math.max(1, Math.floor(amount));
        hpLeft = Math.max(0, hpLeft - dmg);
        try { hpUI.set(hpLeft); } catch {}

        // ✅ 전투 중 타깃 고정(스킬 사용 대비)
        try {
          window.__lastHitMonster = ctrl;
          window.setBattleTarget?.(ctrl);
        } catch {}

        if (hpLeft <= 0) { await win(); }
      },
      /** 몬스터가 플레이어를 타격 */
      hitPlayer(amount = 1) {
        if (marker._pf_dead || isMonsterDead(monsterId)) return;
        const dmg = Math.max(1, Math.floor(amount));
        try { ensureAudio?.(); } catch {}
        try {
          const mid = data?.mid ?? marker?.options?.raw?.mid ?? marker?.getElement?.()?.dataset?.mid;
          if (mid != null) playMonsterHitForMid(mid, { volume: 1 });
          else playMonsterHitForMid('default', { volume: 0.95 });
        } catch {}
        try { Score?.deductHP?.(dmg); } catch(e){ console.warn('[battle] hitPlayer fail', e); }
      }
    };

    // 전역 레지스트리 등록
    try {
      marker._pf_ctrl = ctrl;
      window.__battleCtrlById = window.__battleCtrlById || new Map();
      // ✅ 여러 식별자를 동일 ctrl로 브릿징(주변검색이 내보낸 id/uid/docId 다 흡수)
  const _cands = new Set([
    monsterId,
    (raw && (raw.docId || raw.id || raw.uid || raw.monsterId)),
    marker?.options?.raw?.docId,
    marker?.options?.raw?.id,
    marker?._leaflet_id
  ].filter(Boolean));
  for (const k of _cands) { try { window.__battleCtrlById.set(k, ctrl); } catch {} }
      // 기본 getter: 활성 컨트롤러가 죽지 않았으면 반환
      _setCurrentBattleTarget(() => {
        const c = window.__activeBattleCtrl || window.__currentBattleTarget || null;
        return (c && c.isDead && c.isDead()) ? null : c;
      });
      // 외부에서 플레이어 데미지 적용하는 전역 훅(필요 시 사용)
      if (!window.__applyPlayerDamage) {
        window.__applyPlayerDamage = (fromId, dmg) => {
          try {
            if (isMonsterDead(fromId)) return;
            const c = window.__battleCtrlById?.get(fromId);
            if (!c || c.isDead?.()) return;
            c.hitPlayer?.(Math.max(1, Math.floor(dmg)));
          } catch {}
        };
      }
    } catch {}

    // === 클릭(전투 진입/평타 트리거)
    marker.options.interactive = true;
    marker.on('click', async () => {
      console.log('Monster clicked! ID:', monsterId);
      if (marker._pf_dead || isMonsterDead(monsterId)) return;
      try { ensureAudio?.(); } catch {}
      if (attachMonsterBattle._busy) return;
      attachMonsterBattle._busy = true;

      try {
        // ✅ 전투 타깃 지정(SSOT)
        window.__activeBattleCtrl = ctrl;
        window.setBattleTarget?.(ctrl);

        const w = getEquippedWeapon?.();
        const wpAtk   = Math.max(0, Number(w?.baseAtk || 0));
        const wpCritA = Math.max(0, Number(w?.extraCrit || 0));
        const CRIT_MULTI = 2.0;

        const uLL = playerMarker.getLatLng();
        const mLL = marker.getLatLng();
        const dist0 = map.distance(uLL, mLL);

        if (dist0 > data.approachMaxM) {
          try { playFail?.(); } catch {}
          toast(`먼저 가까이 가세요 (현재 ${Math.round(dist0)}m / 필요 ${data.approachMaxM}m)`);
          return;
        }

        if (dist0 > data.meleeRange) {
          await dashToMeleeDynamic({
            map, playerMarker,
            getTargetLatLng: () => marker.getLatLng(),
            speedMps: data.approachSpeedMps,
            meleeRangeM: data.meleeRange,
            softRangeM: Math.max(data.meleeRange + 1.2, 3.0),
            timeoutMs: 2200,
            onStep: (lat, lng) => { try { dog?.update?.(lat, lng); } catch {} },
            shouldStop: () => marker._pf_dead === true
          });
        }
        if (marker._pf_dead) return;

        const nowLL = marker.getLatLng();
        faceTowards(nowLL);
        await attackOnceToward(map, playerMarker, nowLL.lat, nowLL.lng);
        if (marker._pf_dead) return;

        const critChance = Math.min(0.95, Math.max(0, (data.critChance || 0) + wpCritA));
        const isCrit = Math.random() < critChance;
        let damage = Math.max(1, 1 + wpAtk);
        if (isCrit) damage = Math.ceil(damage * CRIT_MULTI);

        showHitFX(marker, nowLL.lat, nowLL.lng, { crit: isCrit });
        try { dog?.playBark?.(); } catch {}

        if (_attachSpriteToMarker && data.mid != null) {
          try {
            const { url, scale } = _getSheetURLAndScale(marker, data.mid, 200, 200);
            _attachSpriteToMarker(
              marker,
              { url, frameW: 200, frameH: 200, frames: 4, once: true, fps: 12 },
              { scale, classNameExtra: 'mon-hit-anim' }
            );
          } catch (e) { console.warn('[battle] sprite fail', e); }
        }

        // 플레이어 → 몬스터 HP 감소
        hpLeft = Math.max(0, hpLeft - Math.max(1, Math.floor(damage)));
        try { hpUI.set(hpLeft); } catch {}

        // ✅ 전투 중 타깃/최근 피격 갱신
        try {
          window.__lastHitMonster = ctrl;
          window.setBattleTarget?.(ctrl);
        } catch {}

        if (hpLeft <= 0) await win();

      } catch (e) {
        console.warn('[battle] attack flow error', e);
      } finally {
        attachMonsterBattle._busy = false;
        window.__pf_dashing = false;
      }
    });

    try { marker.bringToFront?.(); } catch {}
    return ctrl;
  }

  attachMonsterBattle._busy = false;
  return attachMonsterBattle;
}

/* 부드러운 대시 */
function dashToMeleeDynamic({
  map, playerMarker,
  getTargetLatLng,
  speedMps = 6.2,
  meleeRangeM = 1.6,
  softRangeM = 3.0,
  timeoutMs = 2000,
  onStep = null,
  shouldStop = null
}) {
  return new Promise((resolve) => {
    window.__pf_dashing = true;
    let start = performance.now();
    let last  = start;
    let lastDist = Infinity;
    let notCloserFrames = 0;

    const tick = (now) => {
      if (typeof shouldStop === 'function' && shouldStop()) return done();

      const dt  = Math.max(0.016, (now - last) / 1000); last = now;
      const cur = playerMarker.getLatLng();
      const tgt = getTargetLatLng();
      const dist = map.distance(cur, tgt);

      if (dist <= meleeRangeM) return done();
      if ((now - start) >= timeoutMs) return done();

      if (dist <= softRangeM) {
        if (dist >= lastDist - 0.05) {
          if (++notCloserFrames >= 6) return done();
        } else { notCloserFrames = 0; }
      }

      const step = speedMps * dt;
      const t = Math.min(1, step / Math.max(dist, 1e-6));
      const newLat = cur.lat + (tgt.lat - cur.lat) * t;
      const newLng = cur.lng + (tgt.lng - cur.lng) * t;
      playerMarker.setLatLng([newLat, newLng]);
      try { onStep?.(newLat, newLng); } catch {}

      lastDist = dist;
      requestAnimationFrame(tick);
    };

    const done = () => { window.__pf_dashing = false; resolve(); };
    requestAnimationFrame(tick);
  });
}

export default createAttachMonsterBattle;
