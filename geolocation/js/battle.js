// /geolocation/js/battle.js
import { getEquippedWeapon } from './equipment.js';

// 현재 전투 타깃 getter(외부에서 읽음)
export let getCurrentBattleTarget = () => null;
export function _setCurrentBattleTarget(fn){ getCurrentBattleTarget = fn; }

// FX / 오디오
import {
  spawnImpactAt as fxSpawnImpactAt,
  shakeMap as fxShakeMap,
  spawnCritLabelAt, spawnLightningAt,
  flashCritRingOnMarker
} from './fx.js';
import {
  playAttackImpact as importedPlayAttackImpact,
  playCrit, playDeathForMid, playDeath, playMonsterHitForMid
} from './audio.js';

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
  const showHitFX = (marker, lat, lon, { crit = false } = {}) => {
    try {
      _spawnImpactAt(map, lat, lon);
      if (crit) {
        spawnCritLabelAt?.(map, lat, lon, { text: 'CRIT!', ms: 700 });
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
    let hpUI = { set: () => {} };
    setTimeout(() => { try { hpUI = attachHPBar(marker, hpLeft) || { set: () => {} }; hpUI.set(hpLeft); } catch {} }, 0);

    const clearActive = () => {
      try {
        if (window.__activeBattleCtrl && window.__activeBattleCtrl.id === monsterId) window.__activeBattleCtrl = null;
        if (window.__battleCtrlById instanceof Map) window.__battleCtrlById.delete(monsterId);
      } catch {}
    };

    const setDead = () => {
      try { marker.options.interactive = false; marker.off('click'); marker._pf_dead = true; } catch {}
      try { monstersGuard?.stopAttacksFrom?.(monsterId); } catch {}
      try {
        const ttl = Number(data.cooldownMs || 60000);
        monstersGuard?.markKilled?.(monsterId, ttl);
        localStorage.setItem('mon_cd:' + monsterId, String(Date.now() + ttl));
      } catch {}
      clearActive();
      try { marker.getElement()?.querySelector?.('.hpbar, .hp-bar, .hp')?.remove?.(); } catch {}
    };

    const win = async () => {
      setDead();
      try { if (data.mid) playDeathForMid(data.mid); else playDeath?.(); } catch {}

      // EXP 보상
      try {
        const cpGain = Math.max(0, Math.floor(Number(data.power || 0) / 10));
        if (cpGain > 0 && typeof Score?.addCP === 'function') {
          await Score.addCP(cpGain);
          toast?.(`+${cpGain} CP (처치 보상)`);
        }
      } catch (e) { console.warn('[battle] addCP fail', e); }

      // 전리품 이동
      try {
        const gid = (getGuestId?.() || Score?.getGuestId?.() || localStorage.getItem('guestId') || 'guest');
        const moved = await transferMonsterInventory(db, { monsterId, guestId: gid });
        toast(moved?.length ? `전리품: ${moved.map(it => `${it.name || it.id} x${it.qty || 1}`).join(', ')}` : `처치 완료!`);
      } catch (e) { console.warn('[battle] loot transfer fail', e); toast('전리품 이전 실패.'); }

      setTimeout(() => { try { map.removeLayer(marker); } catch {} }, 900);
    };

    const fail = () => { try { playFail?.(); } catch {}; toast('실패… 다시!'); };

    marker.options.interactive = true;
    marker.on('click', async () => {
      if (marker._pf_dead) return;
      try { ensureAudio?.(); } catch {}
      if (attachMonsterBattle._busy) return;
      attachMonsterBattle._busy = true;

      try {
        const w = getEquippedWeapon?.();
        const wpAtk   = Math.max(0, Number(w?.baseAtk || 0));
        const wpCritA = Math.max(0, Number(w?.extraCrit || 0));
        const CRIT_MULTI = 2.0;

        const uLL = playerMarker.getLatLng();
        const mLL = marker.getLatLng();
        const dist0 = map.distance(uLL, mLL);

        if (dist0 > data.approachMaxM) { fail(); toast(`먼저 가까이 가세요 (현재 ${Math.round(dist0)}m / 필요 ${data.approachMaxM}m)`); return; }

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

        // === 외부 컨트롤러 ===
        const ctrl = {
          id: monsterId,
          marker,
          getLatLng: () => marker.getLatLng(),
          isDead: () => !!marker._pf_dead,

          /** 몬스터가 외부 요인으로 피해(양수) */
          async hit(amount = 1, opts = {}) {
            if (marker._pf_dead) return;
            const nowLL = marker.getLatLng();
            try {
              if (opts.lightning && typeof spawnLightningAt === 'function') {
                spawnLightningAt(map, nowLL.lat, nowLL.lng, { flashScreen:true, shake:true });
              } else {
                showHitFX(marker, nowLL.lat, nowLL.lng, { crit: !!opts.crit });
              }
              _playAttackImpact({ intensity: opts.lightning ? 1.8 : 1.2, includeWhoosh:false });
              _shakeMap();
            } catch {}
            const dmg = Math.max(1, Math.floor(amount));
            hpLeft = Math.max(0, hpLeft - dmg);
            try { hpUI.set(hpLeft); } catch {}
            if (hpLeft <= 0) { await win(); }
          },

          /** 몬스터가 플레이어를 타격 */
          hitPlayer(amount = 1) {
            const dmg = Math.max(1, Math.floor(amount));
            try { ensureAudio?.(); } catch {}
            try {
              // 몬스터 전용 히트 음향 (mid 기반)
              const mid = data?.mid ?? marker?.options?.raw?.mid ?? marker?.getElement?.()?.dataset?.mid;
              if (mid != null) playMonsterHitForMid(mid, { volume: 1 });
              else playMonsterHitForMid('default', { volume: 0.95 });
            } catch {}
            try { Score?.deductHP?.(dmg); } catch(e){ console.warn('[battle] hitPlayer fail', e); }
          }
        };

        try {
          marker._pf_ctrl = ctrl;
          window.__battleCtrlById = window.__battleCtrlById || new Map();
          window.__battleCtrlById.set(monsterId, ctrl);
          window.__activeBattleCtrl = ctrl;
          _setCurrentBattleTarget(() => {
            const c = window.__activeBattleCtrl || null;
            return (c && c.isDead && c.isDead()) ? null : c;
          });
          window.__applyPlayerDamage = (fromId, dmg) => {
            try { window.__battleCtrlById?.get(fromId)?.hitPlayer?.(dmg); } catch {}
          };
        } catch {}

        // 플레이어 → 몬스터 HP 감소
        hpLeft = Math.max(0, hpLeft - Math.max(1, Math.floor(damage)));
        try { hpUI.set(hpLeft); } catch {}
        if (hpLeft <= 0) await win();

      } catch (e) {
        console.warn('[battle] attack flow error', e);
      } finally {
        attachMonsterBattle._busy = false;
        window.__pf_dashing = false;
      }
    });

    try { marker.bringToFront?.(); } catch {}
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
