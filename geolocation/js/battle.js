// /geolocation/js/battle.js
import { getEquippedWeapon } from './equipment.js';
export let getCurrentBattleTarget = () => null;
export function _setCurrentBattleTarget(fn){ getCurrentBattleTarget = fn; }

import {
  spawnImpactAt as fxSpawnImpactAt,
  shakeMap as fxShakeMap,
  spawnCritLabelAt, spawnLightningAt,
  flashCritRingOnMarker
} from './fx.js';
import { playAttackImpact as importedPlayAttackImpact } from './audio.js';

export function createAttachMonsterBattle({
  db, map, playerMarker, dog, Score, toast,
  ensureAudio, setFacingByLatLng, attackOnceToward,
  spawnImpactAt: injSpawnImpactAt,
  shakeMap: injShakeMap,
  playAttackImpact, playFail, playDeath,
  attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
  monstersGuard, setHUD,
  attachSpriteToMarker: injAttachSpriteToMarker
}) {
  const _spawnImpactAt = injSpawnImpactAt || fxSpawnImpactAt;
  const _shakeMap      = injShakeMap      || fxShakeMap;
  const _playAttackImpact = playAttackImpact || importedPlayAttackImpact;
  const _attachSpriteToMarker = injAttachSpriteToMarker || null;

  const FACING_THRESH_PX = 8;
  const faceTowards = (targetLL) => {
    const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
    const p2 = map.latLngToLayerPoint(targetLL);
    const dx = p2.x - p1.x;
    const dir = dx > FACING_THRESH_PX ? 'right' : (dx < -FACING_THRESH_PX ? 'left' : null);
    if (dir) { try { setFacingByLatLng(map, playerMarker, targetLL, dir); } catch {} }
  };

  const showHitFX = (marker, lat, lon, { crit = false } = {}) => {
    try {
      if (crit && typeof spawnExplosionAt === 'function') {
        spawnExplosionAt(map, lat, lon, { size: 140, hue: 48, crit: true });
      } else {
        _spawnImpactAt(map, lat, lon);
      }
    } catch { try { _spawnImpactAt(map, lat, lon); } catch {} }
    if (crit) {
      try { spawnCritLabelAt?.(map, lat, lon, { text: 'CRIT!', ms: 700 }); } catch {}
      try { flashCritRingOnMarker?.(marker, { ms: 500 }); } catch {}
    }
    try {
      _playAttackImpact({ intensity: crit ? 1.6 : 1.15, includeWhoosh: crit, critical: crit });
    } catch {}
    try { _shakeMap(); } catch {}
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
    if (!url && mid != null) {
      url = `http://127.0.0.1:5550/images/ani/${encodeURIComponent(mid)}.png`;
    }
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

    // HP/UI
    let hpLeft = Math.max(1, Number(data.hp ?? data.power));
    let hpUI = { set: () => {} };
    setTimeout(() => {
      try { hpUI = attachHPBar(marker, hpLeft) || { set: () => {} }; hpUI.set(hpLeft); } catch {}
      try { setHUD?.({ timeLeft: '-', hitsLeft: hpLeft, earn: data.power, chain: Score.getChainTotal() }); } catch {}
    }, 0);

    // 타임어택 HUD
    let chal = null; // { remain, deadline, timer }
    const stopHUD = () => {
      if (chal?.timer) clearInterval(chal.timer);
      chal = null;
      try { setHUD?.({ timeLeft: '-', hitsLeft: '-', earn: data.power, chain: Score.getChainTotal() }); } catch {}
    };
    const tickHUD = () => {
      if (!chal) return;
      const left = Math.max(0, chal.deadline - Date.now());
      try { setHUD?.({ timeLeft: (left / 1000).toFixed(1) + 's', hitsLeft: chal.remain, earn: data.power }); } catch {}
    };

    // 🔒 사망 처리: 공격/타깃/가드/타이머/HP바/마커 모두 정리
    const clearAsActiveTargetIfNeeded = () => {
      try {
        if (window.__activeBattleCtrl && window.__activeBattleCtrl.id === monsterId) {
          window.__activeBattleCtrl = null;
        }
        if (window.__battleCtrlById instanceof Map) {
          window.__battleCtrlById.delete(monsterId);
        }
        if (typeof window !== 'undefined') {
          // 레거시 폴백 변수도 정리
          if (window.__battleCtrlLast && window.__battleCtrlLast.id === monsterId) {
            window.__battleCtrlLast = null;
          }
        }
        // getCurrentBattleTarget는 항상 __activeBattleCtrl를 참조하도록 이미 결선되어 있음
      } catch {}
    };

    const setDead = () => {
      try {
        marker.options.interactive = false;
        marker.off('click');
        marker._pf_dead = true;
      } catch {}
      try { monstersGuard?.stopAttacksFrom?.(monsterId); } catch {}
      try {
        const ttl = Number(data.cooldownMs || 60000);
        monstersGuard?.markKilled?.(monsterId, ttl); // RT 노출 차단(로컬)
      } catch {}
      // HUD/타이머/타깃 정리
      stopHUD();
      clearAsActiveTargetIfNeeded();
      // HP바 UI 제거(attachHPBar 구현에 따라 엘리먼트가 marker DOM 내에 있음)
      try {
        const el = marker.getElement();
        el?.querySelector?.('.hpbar, .hp-bar, .hp')?.remove?.();
      } catch {}
    };

    const win = async () => {
      setDead();
      try { playDeath(); } catch {}

      // 점수/체인
      try {
        const distM = Math.round(Score.getStats().totalDistanceM);
        await Score.awardGP(data.power, data.lat, data.lon, distM);
        Score.updateEnergyUI();
        const tx = await Score.saveToChainMock(data.power);
        setHUD?.({ chain: tx.total });
      } catch (e) { console.warn('[battle] score/chain fail', e); }

      // 로컬 CD 기록 → RT가 다시 불러오지 않도록
      try { localStorage.setItem('mon_cd:' + monsterId, String(Date.now() + data.cooldownMs)); } catch {}

      // 전리품
      try {
        const gid =
          (typeof getGuestId === 'function' && getGuestId()) ||
          (typeof Score?.getGuestId === 'function' && Score.getGuestId()) ||
          localStorage.getItem('guestId') || 'guest';
        const moved = await transferMonsterInventory(db, { monsterId, guestId: gid });
        toast(moved?.length
          ? `+${data.power} GP & 전리품: ${moved.map(it => `${it.name || it.id} x${it.qty || 1}`).join(', ')}`
          : `+${data.power} GP!`);
      } catch (e) {
        console.warn('[battle] loot transfer fail', e);
        toast('전리품 이전 실패. 잠시 후 다시 시도해 주세요.');
      }

      // 마커 제거
      setTimeout(() => {
        try { map.removeLayer(marker); } catch {}
      }, 900);
    };

    const fail = () => { stopHUD(); try { playFail(); } catch {}; toast('실패… 다시!'); };

    // 클릭 전투
    marker.options.interactive = true;
    marker.on('click', async () => {
      if (marker._pf_dead) return;
      try { ensureAudio(); } catch {}
      if (attachMonsterBattle._busy) return;
      attachMonsterBattle._busy = true;

      try {
        // 무기 스펙
        const w = getEquippedWeapon();
        const wpAtk   = Math.max(0, Number(w?.baseAtk || 0));
        const wpCritA = Math.max(0, Number(w?.extraCrit || 0));
        const CRIT_MULTI = 2.0;

        // 접근/대시
        const uLL = playerMarker.getLatLng();
        const mLL = marker.getLatLng();
        const dist0 = map.distance(uLL, mLL);

        if (dist0 > data.approachMaxM) {
          try { playFail(); } catch {}
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

        // 공격 연출 + 판정
        const nowLL = marker.getLatLng();
        faceTowards(nowLL);
        await attackOnceToward(map, playerMarker, nowLL.lat, nowLL.lng);
        if (marker._pf_dead) return;

        // 크리/데미지
        const critChance = Math.min(0.95, Math.max(0, (data.critChance || 0) + wpCritA));
        const isCrit = Math.random() < critChance;
        let damage = Math.max(1, 1 + wpAtk);
        if (isCrit) damage = Math.ceil(damage * CRIT_MULTI);

        // 연출
        showHitFX(marker, nowLL.lat, nowLL.lng, { crit: isCrit });
        try { dog?.playBark?.(); } catch {}

        // 히트 스프라이트
        if (_attachSpriteToMarker && data.mid != null) {
          try {
            const { url, scale } = _getSheetURLAndScale(marker, data.mid, 200, 200);
            _attachSpriteToMarker(
              marker,
              { url, frameW: 200, frameH: 200, frames: 4, once: true, fps: 12 },
              { scale, classNameExtra: 'mon-hit-anim' }
            );
          } catch (e) { console.warn('[battle] attachSpriteToMarker failed', e); }
        }

        // === 외부 히트 컨트롤러(번개 등) ===
        const ctrl = {
          id: monsterId,
          marker,
          getLatLng: () => marker.getLatLng(),
          isDead: () => !!marker._pf_dead,
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

            // HP/HUD
            const dmg = Math.max(1, Math.floor(amount));
            hpLeft = Math.max(0, hpLeft - dmg);
            if (chal){
              chal.remain = Math.max(0, chal.remain - dmg);
              tickHUD();               // ✅ 오타 수정 (hud() → tickHUD())
            }
            try { hpUI.set(hpLeft); } catch {}

            if (hpLeft <= 0) { await win(); }
          }
        };

        // 글로벌 타깃 등록
        try {
          marker._pf_ctrl = ctrl;
          window.__battleCtrlById = window.__battleCtrlById || new Map();
          window.__battleCtrlById.set(monsterId, ctrl);
          window.__activeBattleCtrl = ctrl;
          _setCurrentBattleTarget(() => {
            const c = window.__activeBattleCtrl || null;
            // 죽은 컨트롤러가 남아있으면 즉시 해제
            if (c && c.isDead && c.isDead()) return null;
            return c;
          });
        } catch {}

        // 타임어택 HUD 시작
        if (!chal) {
          const ms = getChallengeDurationMs(data.power);
          chal = {
            remain: Math.max(1, hpLeft),
            deadline: Date.now() + ms,
            timer: setInterval(() => {
              if (!chal) return;
              if (marker._pf_dead) { fail(); return; }
              if (Date.now() >= chal.deadline) fail(); else tickHUD();
            }, 80)
          };
          tickHUD();
        }
        if (Date.now() >= chal.deadline) return fail();

        // HP 감소(무기/크리 반영)
        hpLeft = Math.max(0, hpLeft - damage);
        chal.remain = Math.max(0, chal.remain - damage);
        try { hpUI.set(hpLeft); } catch {}

        if (hpLeft <= 0) await win(); else tickHUD();

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

/* 유연한 대시 */
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
