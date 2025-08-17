// /geolocation/js/battle.js
// ✅ DB 최소화: 죽음/부활 상태는 쓰지 않음, 전리품 이전만 트랜잭션 수행

export function createAttachMonsterBattle({
  db, map, playerMarker, dog, Score, toast,
  ensureAudio, isInRange, distanceToM, setFacingByLatLng,
  swingSwordAt, attackOnceToward, spawnImpactAt, spawnExplosionAt, shakeMap, playAttackImpact, playFail, playDeath,
  attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
  monstersGuard, setHUD
}) {

  const FACING_THRESHOLD_PX = 8;
  function getFacingDirLR(map, playerMarker, targetLL, thresholdPx = FACING_THRESHOLD_PX){
    const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
    const p2 = map.latLngToLayerPoint(targetLL);
    const dx = p2.x - p1.x;
    if (dx >  thresholdPx) return 'right';
    if (dx < -thresholdPx) return 'left';
    return null;
  }
  function faceTowards(map, playerMarker, targetLL){
    const dir = getFacingDirLR(map, playerMarker, targetLL);
    if (dir) { try { setFacingByLatLng(map, playerMarker, targetLL, dir); } catch {} }
    return dir;
  }

  // 안전한 히트 FX: spawnExplosionAt가 없거나 실패해도 기존 spawnImpactAt로 폴백
  function showHitFX(lat, lon, { crit=false } = {}) {
    try {
      if (typeof spawnExplosionAt === 'function') {
        spawnExplosionAt(map, lat, lon, {
          size: crit ? 140 : 110,
          hue:  crit ? 48  : 20,
          crit
        });
      } else {
        spawnImpactAt(map, lat, lon);
      }
    } catch (e) {
      console.warn('hit FX failed, fallback to impact', e);
      try { spawnImpactAt(map, lat, lon); } catch {}
    }
  }

  // 인자 정규화: (marker,id,data) | ({marker,id,data})
  function normalizeArgs(...args){
    if (args.length === 3) return { marker: args[0], id: args[1], data: args[2] || {} };
    if (args.length === 1 && args[0] && typeof args[0] === 'object') {
      const o = args[0];
      return { marker: o.marker, id: o.id, data: o.data || o.mon || o.meta || {} };
    }
    return { marker: args?.[0], id: args?.[1], data: args?.[2] || {} };
  }

  function attachMonsterBattle(...rawArgs){
    const { marker, id: monsterId, data: rawData } = normalizeArgs(...rawArgs);
    if (!marker || !monsterId) { console.warn('[battle] invalid args'); return; }

    const data = {
      lat: rawData.lat, lon: rawData.lon,
      power: Number.isFinite(rawData.power) ? Number(rawData.power) : 20,
      hp: Number.isFinite(rawData.hp) ? Number(rawData.hp) : undefined,
      cooldownMs: Number.isFinite(rawData.cooldownMs) ? Number(rawData.cooldownMs) : 2000,
      approachMaxM:     Number.isFinite(rawData.approachMaxM)     ? Number(rawData.approachMaxM)     : 10,  //유효 사거리
      meleeRange:       Number.isFinite(rawData.meleeRange)       ? Number(rawData.meleeRange)       : 1.6,
      approachSpeedMps: Number.isFinite(rawData.approachSpeedMps) ? Number(rawData.approachSpeedMps) : 6.2,
      critChance: Number.isFinite(rawData.critChance) ? Number(rawData.critChance) : 0.2,
    };

    // HP 바
    let hpLeft = Math.max(1, Number(data.hp ?? data.power));
    let hpUI = { set: ()=>{} };
    setTimeout(() => {
      try { hpUI = attachHPBar(marker, hpLeft) || { set: ()=>{} }; } catch {}
      try { hpUI.set(hpLeft); } catch {}
      try {
        setHUD?.({
          timeLeft: '-',
          hitsLeft: hpLeft,
          earn: data.power,
          chain: Score.getChainTotal()
        });
      } catch {}
    }, 0);

    // 타임어택 HUD
    let chal = null;
    const stop = () => {
      if (chal?.timer) clearInterval(chal.timer);
      chal = null;
      try {
        setHUD?.({ timeLeft: '-', hitsLeft: '-', earn: data.power, chain: Score.getChainTotal() });
      } catch {}
    };
    const hud = () => {
      if (!chal) return;
      const s = Math.max(0, chal.deadline - Date.now());
      try { setHUD?.({ timeLeft: (s/1000).toFixed(1)+'s', hitsLeft: chal.remain, earn: data.power }); } catch {}
    };

    // 🔴 즉시 사망 마킹 + 공격 루프 차단 + 인터랙션 해제
    function setDead(){
      try { marker.options.interactive = false; } catch {}
      try { marker.off('click'); } catch {}
      try { marker._pf_dead = true; } catch {}
     try {
const ttl = Number(data.cooldownMs || 60_000);
 monstersGuard?.markKilled?.(monsterId, ttl);
} catch {}
      try { monstersGuard?.stopAttacksFrom?.(monsterId); } catch {} // 있으면 호출
    }

    // 승리: 로컬 쿨다운만 기록, 전리품 이전만 1회 DB
    async function win(){
      stop();
      setDead(); // 🔴 가장 먼저 호출하여 추가 공격 차단

      try { playDeath(); } catch {}

      try {
        const distM = Math.round(Score.getStats().totalDistanceM);
        await Score.awardGP(data.power, data.lat, data.lon, distM);
        Score.updateEnergyUI();
        const tx = await Score.saveToChainMock(data.power);
        setHUD?.({ chain: tx.total });
      } catch (e){ console.warn('[battle] score/chain fail', e); }

      // ✅ 로컬 쿨다운 기록 (DB X)
      try { localStorage.setItem('mon_cd:'+monsterId, String(Date.now() + data.cooldownMs)); } catch {}

      // 전리품 이전(트랜잭션은 내부 구현)
      try {
        const moved = await transferMonsterInventory({ monsterId, guestId: getGuestId() });
        toast(moved?.length
          ? `+${data.power} GP & 전리품: ${moved.map(it => `${it.name || it.id} x${it.qty || 1}`).join(', ')}`
          : `+${data.power} GP!`);
      } catch (e) {
        console.warn('loot transfer fail', e);
        toast('전리품 이전 실패. 잠시 후 다시 시도해 주세요.');
      }

      // 지도에서 제거(연출 시간 확보)
      setTimeout(()=>{ try { map.removeLayer(marker); } catch {} }, 900);
    }

    function fail(){ stop(); try { playFail(); } catch {}; toast('실패… 다시!'); }

    // 클릭 전투
    marker.options.interactive = true;
    marker.on('click', async ()=>{
      if (marker._pf_dead) return; // 죽은 몬스터 클릭 무시
      try { ensureAudio(); } catch {}
      if (attachMonsterBattle._busy) return;
      attachMonsterBattle._busy = true;

      try {
        const uLL = playerMarker.getLatLng();
        const mLL = marker.getLatLng();

        const approachMaxM = data.approachMaxM;
        const meleeRangeM  = data.meleeRange;
        const softRangeM   = Math.max(meleeRangeM + 1.2, 3.0);
        const approachSpeedMps = data.approachSpeedMps;

        const dist0 = map.distance(uLL, mLL);
        if (dist0 > approachMaxM) {
          try { playFail(); } catch {}
          toast(`먼저 가까이 가세요 (현재 ${Math.round(dist0)}m / 필요 ${approachMaxM}m)`);
          return;
        }

        if (dist0 > meleeRangeM) {
          await dashToMeleeDynamic({
            map, playerMarker,
            getTargetLatLng: ()=> marker.getLatLng(),
            speedMps: approachSpeedMps,
            meleeRangeM, softRangeM, timeoutMs: 2200,
            onStep: (lat,lng)=>{ try { dog?.update?.(lat,lng); } catch {} },
            shouldStop: ()=> marker._pf_dead === true
          });
        }

        if (marker._pf_dead) return; // 대시 도중 죽었으면 중단

        const nowLL = marker.getLatLng();
        const curLL = playerMarker.getLatLng();

        faceTowards(map, playerMarker, nowLL);
        try { dog?.setFacingByTarget?.(curLL.lat, curLL.lng, nowLL.lat, nowLL.lng); } catch {}

        // 연출: 공격 모션 + 폭발 FX + 흔들림 + 사운드
        try {
          await attackOnceToward(map, playerMarker, nowLL.lat, nowLL.lng);
          if (marker._pf_dead) return; // 공격 모션 중 사망했으면 중단
          const isCrit = Math.random() < data.critChance;
          showHitFX(nowLL.lat, nowLL.lng, { crit: isCrit });
          shakeMap();
          playAttackImpact({ intensity: isCrit ? 1.6 : 1.15, includeWhoosh: isCrit });
          dog?.playBark?.();
        } catch (e) { console.warn('attack fx error', e); }

        // 타임어택 시작/유지
        if (!chal) {
          const ms = getChallengeDurationMs(data.power);
          chal = {
            remain: Math.max(1, data.power),
            deadline: Date.now() + ms,
            timer: setInterval(()=>{
              if (!chal) return;
              if (marker._pf_dead) { fail(); return; }
              if (Date.now() >= chal.deadline) fail(); else hud();
            }, 80)
          };
          hud();
        }
        if (Date.now() >= chal.deadline) return fail();

        // 데미지
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
   유연한 대시: 타깃이 움직여도 추적, 시간 초과/소프트 범위에서 종료
   onStep: (lat, lng) => void
   shouldStop: () => boolean (true면 즉시 종료)
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
  return new Promise((resolve)=>{
    window.__pf_dashing = true;
    let start = performance.now();
    let last  = start;
    let lastDist = Infinity;
    let notCloserFrames = 0;

    const tick = (now)=>{
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
          if (notCloserFrames >= 6) return done();
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

    const done = ()=>{ window.__pf_dashing = false; resolve(); };
    requestAnimationFrame(tick);
  });
}

export default createAttachMonsterBattle;
