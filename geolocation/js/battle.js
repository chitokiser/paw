// /geolocation/js/battle.js
import { doc, setDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export function createAttachMonsterBattle({
  db, map, playerMarker, dog, Score, toast,
  ensureAudio, isInRange, distanceToM, setFacingByLatLng,
  swingSwordAt, attackOnceToward, spawnImpactAt, shakeMap, playAttackImpact, playFail, playDeath,
  attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
  monstersGuard, setHUD
}) {
  return function attachMonsterBattle(marker, monsterId, data) {
    const power = Math.max(1, Number(data.power ?? 20));

    // HP 바
    let hpLeft = power;
    let hpUI = { set: ()=>{} };
    setTimeout(() => {
      hpUI = attachHPBar(marker, hpLeft);
      hpUI.set(hpLeft);
      // ✅ 전투 시작 전에도 HUD 기본값 노출
      try {
        setHUD?.({
          timeLeft: '-',
          hitsLeft: hpLeft,
          earn: power,
          chain: Score.getChainTotal()
        });
      } catch {}
    }, 0);

    // 타임어택 상태
    let chal = null; // { remain, deadline, timer }

    // HUD 도우미
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

    // 부활 예약(클라이언트 타이머)
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

    // 처치
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

    // 실패
    function fail() { stop(); try { playFail(); } catch {}; toast('실패… 다시!'); }

    // 클릭 전투 핸들러
    marker.options.interactive = true;
    marker.on('click', async () => {
      try { ensureAudio(); } catch {}
      const u = playerMarker.getLatLng(), m = marker.getLatLng();

      // 사거리 10m 가드
      if (!isInRange(u.lat, u.lng, m.lat, m.lng, 10)) {
        const d = Math.round(distanceToM(u.lat, u.lng, m.lat, m.lng));
        try { attackOnceToward(map, playerMarker, m.lat, m.lng); } catch {}
        toast(`가까이 가세요! (현재 ${d}m)`); try { playFail(); } catch {}; return;
      }

      // 연출
      try { setFacingByLatLng(map, playerMarker, { lat: m.lat, lng: m.lng }, 'right'); } catch {}
      try { dog?.setFacingByTarget?.(u.lat, u.lng, m.lat, m.lng); } catch {}
      try {
        swingSwordAt(map, playerMarker, m.lat, m.lng, true);
        spawnImpactAt(map, m.lat, m.lng);
        shakeMap();
        playAttackImpact({ intensity: 1.15 });
        dog?.playBark?.();
      } catch {}

      // 타임어택 시작
      if (!chal) {
        const ms = getChallengeDurationMs(power);
        chal = {
          remain: Math.max(1, power),
          deadline: Date.now() + ms,
          timer: setInterval(() => {
            if (!chal) return;
            if (Date.now() >= chal.deadline) fail();
            else hud();
          }, 80)
        };
        hud(); // 첫 갱신
      }
      if (Date.now() >= chal.deadline) return fail();

      // 데미지 적용
      hpLeft = Math.max(0, hpLeft - 1);
      chal.remain = Math.max(0, chal.remain - 1);
      try { hpUI.set(hpLeft); } catch {}
      if (hpLeft <= 0) await win(); else hud();
    });

    try { marker.bringToFront?.(); } catch {}
  };
}
