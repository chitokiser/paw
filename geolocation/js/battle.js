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
import { playAttackImpact as importedPlayAttackImpact } from './audio.js';

export function createAttachMonsterBattle({
  db, map, playerMarker, dog, Score, toast,
  ensureAudio, setFacingByLatLng, attackOnceToward,

  // 주입 가능(있으면 우선)
  spawnImpactAt: injSpawnImpactAt,
  shakeMap: injShakeMap,
  playAttackImpact, playFail, playDeath,

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

  // ───────────────────── 도우미
  const FACING_THRESH_PX = 8;
  const faceTowards = (targetLL) => {
    const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
    const p2 = map.latLngToLayerPoint(targetLL);
    const dx = p2.x - p1.x;
    const dir = dx > FACING_THRESH_PX ? 'right' : (dx < -FACING_THRESH_PX ? 'left' : null);
    if (dir) { try { setFacingByLatLng(map, playerMarker, targetLL, dir); } catch {} }
  };

  // 히트 FX(크리티컬 강조 포함)
  const showHitFX = (marker, lat, lon, { crit = false } = {}) => {
    try {
      if (crit && typeof spawnExplosionAt === 'function') {
        // 있으면 큰 폭발(선택)
        spawnExplosionAt(map, lat, lon, { size: 140, hue: 48, crit: true });
      } else {
        _spawnImpactAt(map, lat, lon);
      }
    } catch { try { _spawnImpactAt(map, lat, lon); } catch {} }

    if (crit) {
      try { spawnCritLabelAt?.(map, lat, lon, { text: 'CRIT!', ms: 700 }); } catch {}
      try { flashCritRingOnMarker?.(marker, { ms: 500 }); } catch {}
    }
    try { _playAttackImpact({ intensity: crit ? 1.6 : 1.15, includeWhoosh: crit, critical: crit }); } catch {}
    try { _shakeMap(); } catch {}
  };

  // 마커 실제 보이는 크기에 맞춰 시트 스케일 추정
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
      url = `https://puppi.netlify.app/images/ani/${encodeURIComponent(mid)}.png`;
    }
    return { url, scale };
  }

  // ───────────────────── 메인
  function attachMonsterBattle(marker, monsterId, raw = {}) {
    if (!marker || !monsterId) return;

    const data = {
      lat: raw.lat, lon: raw.lon,
      mid: raw.mid ?? raw.mId ?? raw.animId ?? null,
      power: Number.isFinite(raw.power) ? +raw.power : 20,     // ✅ 전투 난이도 & EXP/체인 가산용
      hp: Number.isFinite(raw.hp) ? +raw.hp : undefined,
      cooldownMs: Number.isFinite(raw.cooldownMs) ? +raw.cooldownMs : 2000,
      approachMaxM: Number.isFinite(raw.approachMaxM) ? +raw.approachMaxM : 10,
      meleeRange: Number.isFinite(raw.meleeRange) ? +raw.meleeRange : 1.6,
      approachSpeedMps: Number.isFinite(raw.approachSpeedMps) ? +raw.approachSpeedMps : 6.2,
      critChance: Number.isFinite(raw.critChance) ? +raw.critChance : 0.3
    };

    // ── 몬스터 HP 바
    let hpLeft = Math.max(1, Number(data.hp ?? data.power));
    let hpUI = { set: () => {} };
    setTimeout(() => {
      try { hpUI = attachHPBar(marker, hpLeft) || { set: () => {} }; hpUI.set(hpLeft); } catch {}
      // ⛔️ 정책상: 타임어택/필요타격/보상 등 HUD 요소는 더 이상 표시하지 않음
    }, 0);

    // 공격/타깃 정리
    const clearAsActiveTargetIfNeeded = () => {
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
      } catch {}
      clearAsActiveTargetIfNeeded();
      try { marker.getElement()?.querySelector?.('.hpbar, .hp-bar, .hp')?.remove?.(); } catch {}
    };

    const win = async () => {
      setDead();
      try { playDeath?.(); } catch {}

      // ✅ 정책: 승리 시 EXP/체인 포인트(모의)만 가산. GP/에너지 없음.
      try {
        // addExp가 있으면 사용(권장), 없으면 exp 필드 직접 갱신용 훅만 호출하도록 두기
        if (typeof Score?.addExp === 'function') {
          await Score.addExp(data.power);
        }
      } catch (e) { console.warn('[battle] addExp fail', e); }

      // 체인 포인트(모의 누적 유지) — 구현 유무에 따른 안전 가산
      try {
        if (typeof Score?.saveToChainMock === 'function') {
          const tx = await Score.saveToChainMock(data.power);
          try { setHUD?.({ chain: tx.total }); } catch {}
        } else if (typeof Score?.getChainTotal === 'function' && typeof Score?.setChainTotal === 'function') {
          const total = (Score.getChainTotal() || 0) + data.power;
          Score.setChainTotal(total);
          try { setHUD?.({ chain: total }); } catch {}
        }
      } catch(e){ console.warn('[battle] chain add fail', e); }

      // 전리품 이관
      try {
        const gid =
          (typeof getGuestId === 'function' && getGuestId()) ||
          (typeof Score?.getGuestId === 'function' && Score.getGuestId()) ||
          localStorage.getItem('guestId') || 'guest';
        const moved = await transferMonsterInventory(db, { monsterId, guestId: gid });
        toast(moved?.length
          ? `전리품: ${moved.map(it => `${it.name || it.id} x${it.qty || 1}`).join(', ')}`
          : `처치 완료!`);
      } catch (e) {
        console.warn('[battle] loot transfer fail', e);
        toast('전리품 이전 실패. 잠시 후 다시 시도해 주세요.');
      }

      // 마커 제거
      setTimeout(() => { try { map.removeLayer(marker); } catch {} }, 900);
    };

    const fail = () => { try { playFail?.(); } catch {}; toast('실패… 다시!'); };

    // ── 클릭 전투(근접/히트/HP 감소)
    marker.options.interactive = true;
    marker.on('click', async () => {
      if (marker._pf_dead) return;
      try { ensureAudio?.(); } catch {}
      if (attachMonsterBattle._busy) return;
      attachMonsterBattle._busy = true;

      try {
        // 무기 스펙(공격력/크확)
        const w = getEquippedWeapon?.();
        const wpAtk   = Math.max(0, Number(w?.baseAtk || 0));
        const wpCritA = Math.max(0, Number(w?.extraCrit || 0));
        const CRIT_MULTI = 2.0;

        // 접근
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

        // 공격 애니/판정
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

        // === 외부 컨트롤러(번개 등 원격 히트 & 플레이어 피격 훅) ===
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

          /** 🔥 몬스터가 플레이어를 타격(양수=피해). monstersRT 등에서 호출 */
          hitPlayer(amount = 1) {
            const dmg = Math.max(1, Math.floor(amount));
            // Score에 HP 차감 API가 있으면 사용(정책)
            try {
              if (typeof Score?.deductHP === 'function') {
                Score.deductHP(dmg);
              } else if (typeof Score?.deductGP === 'function') {
                // 레거시 호환(기존 모듈이 deductGP만 부를 수 있어 폴백)
                Score.deductHP(dmg);
              }
            } catch(e){ console.warn('[battle] hitPlayer fail', e); }
          }
        };

        // 글로벌 등록(가장 최근 타깃)
        try {
          marker._pf_ctrl = ctrl;
          window.__battleCtrlById = window.__battleCtrlById || new Map();
          window.__battleCtrlById.set(monsterId, ctrl);
          window.__activeBattleCtrl = ctrl;
          _setCurrentBattleTarget(() => {
            const c = window.__activeBattleCtrl || null;
            return (c && c.isDead && c.isDead()) ? null : c;
          });

          // RT/AI가 참조할 수 있도록 “몬스터별 플레이어 타격 훅”도 노출
          window.__applyPlayerDamage = (fromId, dmg) => {
            try {
              const c = window.__battleCtrlById?.get(fromId);
              c?.hitPlayer?.(dmg);
            } catch {}
          };
        } catch {}

        // HP 감소(플레이어 → 몬스터)
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

/* 부드러운 대시(근접까지 이동) */
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
