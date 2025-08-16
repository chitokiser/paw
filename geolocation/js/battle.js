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

  // 내부에서 참조해야 하므로 먼저 선언형 함수로 만든 뒤 반환합니다.
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

    // ── 클릭 전투: "사정거리 안이면 빠르게 접근→붙은 뒤 공격" ──────────
    marker.options.interactive = true;
    marker.on('click', async () => {
      try { ensureAudio(); } catch {}
      if (attachMonsterBattle._dashing) return;

      const mLL = marker.getLatLng();
      const uLL = playerMarker.getLatLng();

      // 문서 값 있으면 우선 적용
      const approachMaxM     = Number(data.approachMaxM     ?? 25);  // 접근 허용 범위
      const meleeRange       = Number(data.meleeRange       ?? 1.1); // 정지/타격 거리
      const approachSpeedMps = Number(data.approachSpeedMps ?? 6.2); // 접근 속도

      // 현재 거리
      const distM = L.latLng(uLL).distanceTo(L.latLng(mLL));
      if (distM > approachMaxM) {
        try { playFail(); } catch {}
        toast(`먼저 가까이 가세요 (현재 ${Math.round(distM)}m / 필요 ${approachMaxM}m)`);
        return;
      }

      // 1) 접근(대시): 목표 앞 meleeRange 지점까지 빠르게
      await dashToMelee(L.latLng(mLL), meleeRange, approachSpeedMps);

      // 2) 붙은 뒤 실제 타격 (오차 가드)
      const cur = playerMarker.getLatLng();
      const afterDash = L.latLng(cur).distanceTo(L.latLng(mLL));
      if (afterDash > meleeRange + 0.15) return;

      try { setFacingByLatLng(map, playerMarker, { lat: mLL.lat, lng: mLL.lng }, 'right'); } catch {}
      try { dog?.setFacingByTarget?.(cur.lat, cur.lng, mLL.lat, mLL.lng); } catch {}
      try {
        swingSwordAt(map, playerMarker, mLL.lat, mLL.lng, true);
        spawnImpactAt(map, mLL.lat, mLL.lng);
        shakeMap();
        playAttackImpact({ intensity: 1.15 });
        dog?.playBark?.();
      } catch {}

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
    });

    // ── 대시 유틸: 이징으로 "빠르게 접근" 느낌 ───────────────────────
    async function dashToMelee(targetLL, meleeRange = 1.1, speedMps = 6.2) {
      attachMonsterBattle._dashing = true;
      window.__pf_dashing = true; // app.js의 GPS setLatLng 가드에 사용

      // easeInOutCubic
      const ease = t => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2);

      try {
        const startLL = playerMarker.getLatLng();
        const totalDist = L.latLng(startLL).distanceTo(targetLL); // m
        const moveDist  = Math.max(0, totalDist - meleeRange);
        if (moveDist <= 0) return;

        const duration = (moveDist / Math.max(0.1, speedMps)) * 1000; // ms
        const start = performance.now();

        // 목표 앞 정지 지점
        const kStop = (totalDist - meleeRange) / totalDist;
        const stopLL = L.latLng(
          startLL.lat + (targetLL.lat - startLL.lat) * kStop,
          startLL.lng + (targetLL.lng - startLL.lng) * kStop
        );

        // 진행방향 바라보기
        try { setFacingByLatLng(map, playerMarker, stopLL, 'right'); } catch {}

        await new Promise(resolve => {
          const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const e = ease(t);
            const lat = startLL.lat + (stopLL.lat - startLL.lat) * e;
            const lng = startLL.lng + (stopLL.lng - startLL.lng) * e;
            const cur = L.latLng(lat, lng);

            try { playerMarker.setLatLng(cur); } catch {}
            try { dog?.update?.(cur.lat, cur.lng); } catch {}

            if (t < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
      } finally {
        attachMonsterBattle._dashing = false;
        window.__pf_dashing = false;
      }
    }

    try { marker.bringToFront?.(); } catch {}
  }

  // 연타 방지 플래그 초기값
  attachMonsterBattle._dashing = false;

  return attachMonsterBattle;
}

// 이름/기본 둘 다 export (import 방식 혼용 대비)
export default createAttachMonsterBattle;
