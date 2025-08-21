// /geolocation/js/battle.js
import { getEquippedWeapon } from './equipment.js';
export let getCurrentBattleTarget = () => null;   // { getLatLng:()=>LatLng, hit:(dmg,opts)=>Promise<void> } | null
export function _setCurrentBattleTarget(fn){ getCurrentBattleTarget = fn; }

// fx.js 유틸 (있으면 사용, 없으면 주입 폴백 사용)
import {
  spawnImpactAt as fxSpawnImpactAt,
  shakeMap as fxShakeMap,
  spawnCritLabelAt,spawnLightningAt,
  flashCritRingOnMarker
} from './fx.js';

// audio.js 사운드 (주입이 없을 때 폴백으로 사용)
import { playAttackImpact as importedPlayAttackImpact } from './audio.js';

export function createAttachMonsterBattle({
  db, map, playerMarker, dog, Score, toast,
  ensureAudio, setFacingByLatLng, attackOnceToward,

  // 주입되는 것들: 있으면 주입 우선
  spawnImpactAt: injSpawnImpactAt,
  shakeMap: injShakeMap,
  playAttackImpact, playFail, playDeath,

  attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
  monstersGuard, setHUD,

  // 외부에서 스프라이트 어태치 함수를 넘길 수 있음
  attachSpriteToMarker: injAttachSpriteToMarker
}) {

  // 폴백 구성: 주입 → import 기본
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

  // ── 크리티컬/일반 히트 FX 묶음
  const showHitFX = (marker, lat, lon, { crit = false } = {}) => {
    try {
      if (crit && typeof spawnExplosionAt === 'function') {
        // 크리티컬: 더 큰 폭발 + 황금톤
        spawnExplosionAt(map, lat, lon, { size: 140, hue: 48, crit: true });
      } else {
        _spawnImpactAt(map, lat, lon);
      }
    } catch {
      // 최후 폴백
      try { _spawnImpactAt(map, lat, lon); } catch {}
    }

    // 크리 시각 피드백(존재하면 사용)
    if (crit) {
      try { spawnCritLabelAt?.(map, lat, lon, { text: 'CRIT!', ms: 700 }); } catch {}
      try { flashCritRingOnMarker?.(marker, { ms: 500 }); } catch {}
    }

    try { _shakeMap(); } catch {}

    // 사운드: 정책에 맞게 critical 플래그 전달
    try {
      _playAttackImpact({
        intensity: crit ? 1.6 : 1.15,
        includeWhoosh: crit,
        critical: crit
      });
    } catch {}
  };

  // 마커 DOM에서 실제 표시 크기 기준으로 스프라이트 스케일 추정
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
      // 기본 크리티컬 30% (장비가 추가 크확을 더할 수 있음)
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

    // 로컬 사망 처리
    const setDead = () => {
      try { marker.options.interactive = false; marker.off('click'); marker._pf_dead = true; } catch {}
      try { monstersGuard?.stopAttacksFrom?.(monsterId); } catch {}
      try {
        const ttl = Number(data.cooldownMs || 60000);
        monstersGuard?.markKilled?.(monsterId, ttl);
      } catch {}
    };

    const win = async () => {
      stopHUD(); setDead();
      try { playDeath(); } catch {}

      try {
        const distM = Math.round(Score.getStats().totalDistanceM);
        await Score.awardGP(data.power, data.lat, data.lon, distM);
        Score.updateEnergyUI();
        const tx = await Score.saveToChainMock(data.power);
        setHUD?.({ chain: tx.total });
      } catch (e) { console.warn('[battle] score/chain fail', e); }

      try { localStorage.setItem('mon_cd:' + monsterId, String(Date.now() + data.cooldownMs)); } catch {}

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

      setTimeout(() => { try { map.removeLayer(marker); } catch {} }, 900);
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
        // --- 무기 스펙 적용 ---
        const w = getEquippedWeapon();
        const wpAtk   = Math.max(0, Number(w?.baseAtk || 0));     // 기본 공격력(+힛 수)
        const wpCritA = Math.max(0, Number(w?.extraCrit || 0));   // 추가 크확(0~)
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

        // 크리/데미지 계산
        const critChance = Math.min(0.95, Math.max(0, (data.critChance || 0) + wpCritA));
        const isCrit = Math.random() < critChance;
        let damage = Math.max(1, 1 + wpAtk); // 맨손=1, 장검=1+baseAtk
        if (isCrit) damage = Math.ceil(damage * CRIT_MULTI);

        // 시각/청각 연출(크리 강조 포함)
        showHitFX(marker, nowLL.lat, nowLL.lng, { crit: isCrit });
        try { dog?.playBark?.(); } catch {}

        // 마커-위 4컷 히트 스프라이트
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

           // === 외부에서 이 몬스터에 피해를 가할 수 있는 컨트롤러 ===
    const ctrl = {
      id: monsterId,
      marker,
      getLatLng: () => marker.getLatLng(),
      isDead: () => !!marker._pf_dead,
      /** 외부 히트: amount만큼 피해. opts: { lightning?:boolean } */
    async hit(amount = 1, opts = {}) {
  if (marker._pf_dead) return;
  const nowLL = marker.getLatLng();

  try {
    if (opts.lightning && typeof spawnLightningAt === 'function') {
      spawnLightningAt(map, nowLL.lat, nowLL.lng, { flashScreen:true, shake:true });
    } else {
      showHitFX(marker, nowLL.lat, nowLL.lng, { crit: !!opts.crit }); // ✅ marker 인자 추가
    }
    _shakeMap(); // ✅ 래퍼 사용
    _playAttackImpact({ intensity: opts.lightning ? 1.8 : 1.2, includeWhoosh:false });
  } catch {}

        // HUD/HP 처리
        const dmg = Math.max(1, Math.floor(amount));
        hpLeft = Math.max(0, hpLeft - dmg);
        if (chal){
          chal.remain = Math.max(0, chal.remain - dmg);
          hud();
        }
        try { hpUI.set(hpLeft); } catch {}

        if (hpLeft <= 0) { await win(); }
      }
    };
    // 글로벌로 "현재/마지막" 전투 타겟 컨트롤 보관
    try {
      marker._pf_ctrl = ctrl;
      window.__battleCtrlById = window.__battleCtrlById || new Map();
      window.__battleCtrlById.set(monsterId, ctrl);
      window.__activeBattleCtrl = ctrl;
     // getCurrentBattleTarget()가 항상 최신 ctrl을 반환하도록 연결
      try { _setCurrentBattleTarget(() => window.__activeBattleCtrl || null); } catch {}
    } catch {}


        // 타임어택 HUD 시작(없으면)
        if (!chal) {
          const ms = getChallengeDurationMs(data.power);
          chal = {
            remain: Math.max(1, hpLeft), // 실제 HP 기준
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
