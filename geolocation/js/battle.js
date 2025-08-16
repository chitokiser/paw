// /geolocation/js/battle.js
import { doc, setDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/**
 * 사용:
 * import { createAttachMonsterBattle } from './battle.js';
 * // 또는
 * import createAttachMonsterBattle from './battle.js';
 */
export function createAttachMonsterBattle({


  db, map, playerMarker, dog, Score, toast,
  ensureAudio, isInRange, distanceToM, setFacingByLatLng,
  swingSwordAt, attackOnceToward, spawnImpactAt, shakeMap, playAttackImpact, playFail, playDeath,
  attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
  monstersGuard, setHUD
}) {

  // px 기준 히스테리시스(지터 방지). 6~10px 권장
const FACING_THRESHOLD_PX = 8;

// 플레이어 위치 대비 타깃이 왼쪽/오른쪽인지 계산
function getFacingDirLR(map, playerMarker, targetLL, thresholdPx = FACING_THRESHOLD_PX){
  const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
  const p2 = map.latLngToLayerPoint(targetLL);
  const dx = p2.x - p1.x;
  if (dx >  thresholdPx) return 'right';
  if (dx < -thresholdPx) return 'left';
  return null; // 거의 정면(미세 지터)일 땐 유지
}

// 계산된 방향으로 실제 페이싱 적용
function faceTowards(map, playerMarker, targetLL){
  const dir = getFacingDirLR(map, playerMarker, targetLL);
  if (dir) { try { setFacingByLatLng(map, playerMarker, targetLL, dir); } catch {} }
  return dir;
}


  function attachMonsterBattle(marker, monsterId, data) {
    const power = Math.max(1, Number(data.power ?? 20));

    // ── HP Bar & 초기 HUD ─────────────────────────────────────────
    let hpLeft = power;
    let hpUI = { set: ()=>{} };
    setTimeout(() => {
      hpUI = attachHPBar(marker, hpLeft);
      hpUI.set(hpLeft);
      try {
        setHUD?.({
          timeLeft: '-',
          hitsLeft: hpLeft,
          earn: power,
          chain: Score.getChainTotal()
        });
      } catch {}
    }, 0);

    // ── 타임어택 상태/HUD ────────────────────────────────────────
    let chal = null; // { remain, deadline, timer }

    const stop = () => {
      if (chal?.timer) clearInterval(chal.timer);
      chal = null;
      try {
        setHUD?.({
          timeLeft: '-',
          hitsLeft: '-',
          earn: power,
          chain: Score.getChainTotal()
        });
      } catch {}
    };

    const hud = () => {
      if (!chal) return;
      const s = Math.max(0, chal.deadline - Date.now());
      try {
        setHUD?.({
          timeLeft: (s / 1000).toFixed(1) + 's',
          hitsLeft: chal.remain,
          earn: power
        });
      } catch {}
    };

    // ── 부활 예약(클라 타이머) ───────────────────────────────────
    async function reviveLater(respawnMs = 60_000) {
      const monRef = doc(db, 'monsters', String(monsterId));
      setTimeout(async () => {
        try {
          await runTransaction(db, async tx => {
            const snap = await tx.get(monRef);
            if (!snap.exists()) return;
            const cur = snap.data() || {};
            if ((cur.dead === true || cur.alive === false) && Number(cur.respawnAt || 0) <= Date.now()) {
              tx.update(monRef, { alive: true, dead: false, respawnAt: 0, updatedAt: Date.now() });
            }
          });
          try { monstersGuard?.killedLocal?.delete(String(monsterId)); } catch {}
        } catch (e) { console.warn('reviveLater failed', e); }
      }, respawnMs + 120);
    }

    // ── 처치 ─────────────────────────────────────────────────────
    async function win() {
      stop();
      try { playDeath(); } catch {}

      // 점수/체인
      try {
        const distM = Math.round(Score.getStats().totalDistanceM);
        await Score.awardGP(power, data.lat, data.lon, distM);
        Score.updateEnergyUI();
        const tx = await Score.saveToChainMock(power);
        setHUD?.({ chain: tx.total });
      } catch {}

      // 전리품 이전
      try {
        const moved = await transferMonsterInventory({ monsterId, guestId: getGuestId() });
        toast(moved?.length
          ? `+${power} GP & 전리품: ${moved.map(it => `${it.name || it.id} x${it.qty || 1}`).join(', ')}`
          : `+${power} GP!`);
      } catch (e) {
        console.warn('loot transfer fail', e);
        toast('전리품 이전 실패. 다시 시도해 주세요.');
      }

      // 지도에서 제거
      setTimeout(() => { try { map.removeLayer(marker); } catch {} }, 900);

      // 죽음 기록 + 부활 예약
      try {
        const now = Date.now(), respawnMs = 60_000;
        await setDoc(doc(db, 'monsters', String(monsterId)), {
          alive: false, dead: true, respawnAt: now + respawnMs, updatedAt: now
        }, { merge: true });
        try { monstersGuard?.markKilled?.(monsterId); } catch {}
        await reviveLater(respawnMs);
      } catch {}
    }

    // ── 실패 ─────────────────────────────────────────────────────
    function fail() { stop(); try { playFail(); } catch {}; toast('실패… 다시!'); }

    // ── 클릭 전투: "접근 → (성공/타임아웃/소프트범위) → 무조건 공격" ─────
    marker.options.interactive = true;
    marker.on('click', async () => {
      try { ensureAudio(); } catch {}
      if (attachMonsterBattle._busy) return;
      attachMonsterBattle._busy = true;

      try {
        const uLL = playerMarker.getLatLng();
        const mLL = marker.getLatLng();

        const approachMaxM     = Number(data.approachMaxM     ?? 25);   // 접근 허용 범위
        const meleeRangeM      = Number(data.meleeRange       ?? 1.6);  // 정지/타격 거리(유연화)
        const softRangeM       = Math.max(meleeRangeM + 1.2, 3.0);      // 지터 대비 소프트 범위
        const approachSpeedMps = Number(data.approachSpeedMps ?? 6.2);  // 접근 속도

        const dist0 = map.distance(uLL, mLL);
        if (dist0 > approachMaxM) {
          try { playFail(); } catch {}
          toast(`먼저 가까이 가세요 (현재 ${Math.round(dist0)}m / 필요 ${approachMaxM}m)`);
          return;
        }

        // 1) 멀면 먼저 유연 대시(타깃 추적 + 타임아웃/소프트범위)
        if (dist0 > meleeRangeM) {
          await dashToMeleeDynamic({
            map, playerMarker,
            getTargetLatLng: () => marker.getLatLng(),
            speedMps: approachSpeedMps,
            meleeRangeM, softRangeM, timeoutMs: 2200
          });
        }

        // 2) 도착했건, 소프트 종료/타임아웃이건 → "무조건" 공격 이펙트 호출
        const nowLL = marker.getLatLng();
        const curLL = playerMarker.getLatLng();

        try { setFacingByLatLng(map, playerMarker, nowLL, 'right'); } catch {}
        try { dog?.setFacingByTarget?.(curLL.lat, curLL.lng, nowLL.lat, nowLL.lng); } catch {}

        try {
          await attackOnceToward(map, playerMarker, nowLL.lat, nowLL.lng);
          spawnImpactAt(map, nowLL.lat, nowLL.lng);
          shakeMap();
          playAttackImpact({ intensity: 1.15 });
          dog?.playBark?.();
        } catch (e) {
          console.warn('attack fx error', e);
        }

        // === 이하 기존 HP/타이머/데미지 ===
        if (!chal) {
          const ms = getChallengeDurationMs(data.power);
          chal = {
            remain: Math.max(1, data.power),
            deadline: Date.now() + ms,
            timer: setInterval(() => {
              if (!chal) return;
              if (Date.now() >= chal.deadline) fail();
              else hud();
            }, 80)
          };
          hud();
        }
        if (Date.now() >= chal.deadline) return fail();

        hpLeft = Math.max(0, hpLeft - 1);
        chal.remain = Math.max(0, chal.remain - 1);
        try { hpUI.set(hpLeft); } catch {}
        if (hpLeft <= 0) await win(); else hud();
      } finally {
        attachMonsterBattle._busy = false;
        window.__pf_dashing = false; // 혹시 남아있으면 정리
      }
    });

    try { marker.bringToFront?.(); } catch {}
  }

  // 연타 방지 플래그 초기값
  attachMonsterBattle._busy = false;

  return attachMonsterBattle;
}

/* ────────────────────────────────────────────────────────────────
   유연한 대시: 타깃이 움직여도 추적, 시간 초과/소프트 범위에서 종료
   → 종료 후에는 "무조건" 공격 호출 쪽에서 이펙트를 재생
   ──────────────────────────────────────────────────────────────── */
function dashToMeleeDynamic({
  map, playerMarker,
  getTargetLatLng,              // () => L.LatLng  (항상 최신 몬스터 위치 반환)
  speedMps = 6.2,
  meleeRangeM = 1.6,            // 정확 근접
  softRangeM  = 3.0,            // 이 안에서 정체면 종료
  timeoutMs   = 2000            // 최대 추적 시간
}){
  return new Promise((resolve)=>{
    window.__pf_dashing = true;
    let start = performance.now();
    let last  = start;
    let lastDist = Infinity;
    let notCloserFrames = 0;

    const tick = (now)=>{
      const dt = Math.max(0.016, (now - last) / 1000); last = now;

      const cur = playerMarker.getLatLng();
      const tgt = getTargetLatLng();
      const dist = map.distance(cur, tgt);

      // 1) 정확 근접
      if (dist <= meleeRangeM) return done();

      // 2) 시간 초과
      if ((now - start) >= timeoutMs) return done();

      // 3) 소프트 범위에서 더 안 가까워지면 종료
      if (dist <= softRangeM) {
        if (dist >= lastDist - 0.05) { // 5cm 이내로 정체
          notCloserFrames++;
          if (notCloserFrames >= 6) return done(); // 6프레임(≈100ms) 정체
        } else {
          notCloserFrames = 0;
        }
      }

      // 이동 스텝
      const step = speedMps * dt;
      const t = Math.min(1, step / Math.max(dist, 1e-6));
      const newLat = cur.lat + (tgt.lat - cur.lat) * t;
      const newLng = cur.lng + (tgt.lng - cur.lng) * t;
      playerMarker.setLatLng([newLat, newLng]);

      try { dog?.update?.(newLat, newLng); } catch {}

      lastDist = dist;
      requestAnimationFrame(tick);
    };

    const done = ()=>{ window.__pf_dashing = false; resolve(); };
    requestAnimationFrame(tick);
  });
}

// 이름/기본 둘 다 export (import 방식 혼용 대비)
export default createAttachMonsterBattle;
