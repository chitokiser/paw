// /geolocation/js/battle.js
// Refactored: minimal DB writes (no alive/dead toggles), robust FX fallback,
// safe cooldown/loot transfer, and compact readable structure.

/**
 * Factory to create an attachMonsterBattle(marker, id, data) binder
 * that wires click-to-fight interactions for a given monster marker.
 *
 * Expectations (injected):
 * - db: Firestore instance
 * - map: Leaflet map
 * - playerMarker: Leaflet marker (player)
 * - dog: DogCompanion (optional)
 * - Score: points/energy handler (awardGP, saveToChainMock, etc)
 * - toast: (msg:string)=>void
 * - ensureAudio, isInRange, distanceToM, setFacingByLatLng
 * - swingSwordAt, attackOnceToward
 * - spawnImpactAt, spawnExplosionAt (optional), shakeMap, playAttackImpact, playFail, playDeath
 * - attachHPBar, getChallengeDurationMs
 * - transferMonsterInventory: (db, { monsterId, guestId }) => Promise<loot[]>
 * - getGuestId: () => string
 * - monstersGuard: optional guard with markKilled(monId, ttlMs), stopAttacksFrom(monId)
 * - setHUD: optional HUD updater
 */
export function createAttachMonsterBattle({
  db, map, playerMarker, dog, Score, toast,
  ensureAudio, isInRange, distanceToM, setFacingByLatLng,
  swingSwordAt, attackOnceToward, spawnImpactAt, spawnExplosionAt, shakeMap, playAttackImpact, playFail, playDeath,
  attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
  monstersGuard, setHUD
}){
  // ───────────────────────────── helpers ─────────────────────────────
  const FACING_THRESHOLD_PX = 8; // hysteresis to avoid jitter

  const getFacingDirLR = (map, playerMarker, targetLL, thresholdPx = FACING_THRESHOLD_PX) => {
    const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
    const p2 = map.latLngToLayerPoint(targetLL);
    const dx = p2.x - p1.x;
    if (dx >  thresholdPx) return 'right';
    if (dx < -thresholdPx) return 'left';
    return null; // keep
  };

  const faceTowards = (map, playerMarker, targetLL) => {
    const dir = getFacingDirLR(map, playerMarker, targetLL);
    if (dir) { try { setFacingByLatLng(map, playerMarker, targetLL, dir); } catch {} }
    return dir;
  };

  /** Safe hit FX: uses explosion if available else simple impact */
  const showHitFX = (lat, lon, { crit=false } = {}) => {
    try {
      if (typeof spawnExplosionAt === 'function') {
        spawnExplosionAt(map, lat, lon, { size: crit ? 140 : 110, hue: crit ? 48 : 20, crit });
      } else {
        spawnImpactAt(map, lat, lon);
      }
    } catch (e) {
      console.warn('[battle] hit FX failed, fallback to impact', e);
      try { spawnImpactAt(map, lat, lon); } catch {}
    }
  };

  /** Normalize args: (marker,id,data) | ({marker,id,data}) */
  const normalizeArgs = (...args) => {
    if (args.length === 3) return { marker: args[0], id: args[1], data: args[2] || {} };
    if (args.length === 1 && args[0] && typeof args[0] === 'object') {
      const o = args[0];
      return { marker: o.marker, id: o.id, data: o.data || o.mon || o.meta || {} };
    }
    return { marker: args?.[0], id: args?.[1], data: args?.[2] || {} };
  };

  // ─────────────────────── binder: attachMonsterBattle ───────────────────────
  function attachMonsterBattle(...rawArgs){
    const { marker, id: monsterId, data: rawData } = normalizeArgs(...rawArgs);
    if (!marker || !monsterId) { console.warn('[battle] invalid args'); return; }

    // parsed monster data with defaults
    const data = {
      lat: rawData.lat, lon: rawData.lon,
      power: Number.isFinite(rawData.power) ? Number(rawData.power) : 20,
      hp: Number.isFinite(rawData.hp) ? Number(rawData.hp) : undefined,
      cooldownMs: Number.isFinite(rawData.cooldownMs) ? Number(rawData.cooldownMs) : 2000,
      approachMaxM:     Number.isFinite(rawData.approachMaxM)     ? Number(rawData.approachMaxM)     : 10,
      meleeRange:       Number.isFinite(rawData.meleeRange)       ? Number(rawData.meleeRange)       : 1.6,
      approachSpeedMps: Number.isFinite(rawData.approachSpeedMps) ? Number(rawData.approachSpeedMps) : 6.2,
      critChance:       Number.isFinite(rawData.critChance)       ? Number(rawData.critChance)       : 0.2,
    };

    // HP bar & initial HUD
    let hpLeft = Math.max(1, Number(data.hp ?? data.power));
    let hpUI = { set: () => {} };
    setTimeout(() => {
      try { hpUI = attachHPBar(marker, hpLeft) || { set: ()=>{} }; } catch {}
      try { hpUI.set(hpLeft); } catch {}
      try {
        setHUD?.({ timeLeft: '-', hitsLeft: hpLeft, earn: data.power, chain: Score.getChainTotal() });
      } catch {}
    }, 0);

    // time-attack HUD
    let chal = null; // { remain, deadline, timer }
    const stop = () => {
      if (chal?.timer) clearInterval(chal.timer);
      chal = null;
      try { setHUD?.({ timeLeft: '-', hitsLeft: '-', earn: data.power, chain: Score.getChainTotal() }); } catch {}
    };
    const hud = () => {
      if (!chal) return;
      const left = Math.max(0, chal.deadline - Date.now());
      try { setHUD?.({ timeLeft: (left/1000).toFixed(1)+'s', hitsLeft: chal.remain, earn: data.power }); } catch {}
    };

    // mark death locally (no DB writes): disable interaction & auto-attacks
    const setDead = () => {
      try { marker.options.interactive = false; } catch {}
      try { marker.off('click'); } catch {}
      try { marker._pf_dead = true; } catch {}
      try {
        const ttl = Number(data.cooldownMs || 60_000);
        monstersGuard?.markKilled?.(monsterId, ttl);
      } catch {}
      try { monstersGuard?.stopAttacksFrom?.(monsterId); } catch {}
    };

    // victory flow: score → local cooldown → loot transfer (single DB txn) → remove
    const win = async () => {
      stop();
      setDead(); // first of all, prevent any further hits

      try { playDeath(); } catch {}

      // GP & mock chain save
      try {
        const distM = Math.round(Score.getStats().totalDistanceM);
        await Score.awardGP(data.power, data.lat, data.lon, distM);
        Score.updateEnergyUI();
        const tx = await Score.saveToChainMock(data.power);
        setHUD?.({ chain: tx.total });
      } catch (e) { console.warn('[battle] score/chain fail', e); }

      // local cooldown timestamp (no DB)
      try { localStorage.setItem('mon_cd:'+monsterId, String(Date.now() + data.cooldownMs)); } catch {}

      // loot transfer (only DB transaction in this flow)
      try {
        // ✅ guestId 안전 확보 (getGuestId → Score.getGuestId → localStorage → 'guest')
        const gid =
          (typeof getGuestId === 'function' && getGuestId()) ||
          (typeof Score?.getGuestId === 'function' && Score.getGuestId()) ||
          localStorage.getItem('guestId') ||
          'guest';

        const moved = await transferMonsterInventory(db, { monsterId, guestId: gid });
        toast(moved?.length
          ? `+${data.power} GP & 전리품: ${moved.map(it => `${it.name || it.id} x${it.qty || 1}`).join(', ')}`
          : `+${data.power} GP!`);
      } catch (e) {
        console.warn('[battle] loot transfer fail', e);
        toast('전리품 이전 실패. 잠시 후 다시 시도해 주세요.');
      }

      // remove marker after short delay for FX
      setTimeout(() => { try { map.removeLayer(marker); } catch {} }, 900);
    };

    const fail = () => { stop(); try { playFail(); } catch {}; toast('실패… 다시!'); };

    // click-to-fight binding
    marker.options.interactive = true;
    marker.on('click', async () => {
      if (marker._pf_dead) return; // ignore
      try { ensureAudio(); } catch {}
      if (attachMonsterBattle._busy) return;
      attachMonsterBattle._busy = true;

      try {
        const uLL = playerMarker.getLatLng();
        const mLL = marker.getLatLng();

        const approachMaxM = data.approachMaxM;
        const meleeRangeM  = data.meleeRange;
        const softRangeM   = Math.max(meleeRangeM + 1.2, 3.0);
        const speedMps     = data.approachSpeedMps;

        const dist0 = map.distance(uLL, mLL);
        if (dist0 > approachMaxM) {
          try { playFail(); } catch {}
          toast(`먼저 가까이 가세요 (현재 ${Math.round(dist0)}m / 필요 ${approachMaxM}m)`);
          return;
        }

        // approach: dynamic dash (timeout / soft-range)
        if (dist0 > meleeRangeM) {
          await dashToMeleeDynamic({
            map, playerMarker,
            getTargetLatLng: () => marker.getLatLng(),
            speedMps, meleeRangeM, softRangeM, timeoutMs: 2200,
            onStep: (lat, lng) => { try { dog?.update?.(lat, lng); } catch {} },
            shouldStop: () => marker._pf_dead === true
          });
        }
        if (marker._pf_dead) return;

        // facing & attack FX
        const nowLL = marker.getLatLng();
        const curLL = playerMarker.getLatLng();
        faceTowards(map, playerMarker, nowLL);
        try { dog?.setFacingByTarget?.(curLL.lat, curLL.lng, nowLL.lat, nowLL.lng); } catch {}

        try {
          await attackOnceToward(map, playerMarker, nowLL.lat, nowLL.lng);
          if (marker._pf_dead) return;
          const isCrit = Math.random() < data.critChance;
          showHitFX(nowLL.lat, nowLL.lng, { crit: isCrit });
          shakeMap();
          playAttackImpact({ intensity: isCrit ? 1.6 : 1.15, includeWhoosh: isCrit });
          dog?.playBark?.();
        } catch (e) { console.warn('[battle] attack fx error', e); }

        // start/maintain time-attack window
        if (!chal) {
          const ms = getChallengeDurationMs(data.power);
          chal = {
            remain: Math.max(1, data.power),
            deadline: Date.now() + ms,
            timer: setInterval(() => {
              if (!chal) return;
              if (marker._pf_dead) { fail(); return; }
              if (Date.now() >= chal.deadline) fail(); else hud();
            }, 80)
          };
          hud();
        }
        if (Date.now() >= chal.deadline) return fail();

        // apply damage (1 hit = 1 hp)
        hpLeft = Math.max(0, hpLeft - 1);
        chal.remain = Math.max(0, chal.remain - 1);
        try { hpUI.set(hpLeft); } catch {}
        if (hpLeft <= 0) await win(); else hud();

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

/* ────────────────────────────────────────────────────────────────
   Flexible dash: follows moving target; stops on timeout/soft-range
   onStep: (lat, lng) => void
   shouldStop: () => boolean (if true, ends immediately)
   ──────────────────────────────────────────────────────────────── */
function dashToMeleeDynamic({
  map, playerMarker,
  getTargetLatLng,
  speedMps = 6.2,
  meleeRangeM = 1.6,
  softRangeM  = 3.0,
  timeoutMs   = 2000,
  onStep      = null,
  shouldStop  = null
}){
  return new Promise((resolve) => {
    window.__pf_dashing = true;
    let start = performance.now();
    let last  = start;
    let lastDist = Infinity;
    let notCloserFrames = 0;

    const tick = (now) => {
      if (typeof shouldStop === 'function' && shouldStop()) return done();

      const dt = Math.max(0.016, (now - last) / 1000); last = now;
      const cur = playerMarker.getLatLng();
      const tgt = getTargetLatLng();
      const dist = map.distance(cur, tgt);

      if (dist <= meleeRangeM) return done();
      if ((now - start) >= timeoutMs) return done();

      if (dist <= softRangeM) {
        if (dist >= lastDist - 0.05) {
          notCloserFrames++;
          if (notCloserFrames >= 6) return done(); // ≈100ms stagnation near target
        } else {
          notCloserFrames = 0;
        }
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
