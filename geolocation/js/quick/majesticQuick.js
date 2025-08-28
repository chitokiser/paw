// /geolocation/js/quick/majesticQuick.js
import { ensureAudio } from '../audio.js';
import { useItem } from '../items.js';         // ← 중앙집중 로직 사용 (효과+피해 모두)
import { spawnRadialFlamesAt } from '../fx.js';

export function setupMajesticBallQuickUse({ map, inv, toast, rtMon, playerMarker }) {
  const hasTouch = matchMedia?.('(pointer: coarse)')?.matches || ('ontouchstart' in window);
  const DAMAGE_RADIUS_M = 10;   // 요구사항: 반경 10m
  const DMG = 500;              // 요구사항: 각 -500

  const isTypingElement = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return ['input','textarea','select','button'].includes(tag) || !!el.isContentEditable;
  };

  // rtMon.reg 기반 근접 적 검색기를 items.js에 넘겨줌
  function getNearbyHostiles(radiusM) {
    const out = [];
    if (!rtMon || !(rtMon.reg instanceof Map)) return out;
    const center = playerMarker?.getLatLng?.() || map?.getCenter?.();
    if (!center) return out;

    for (const [id, rec] of rtMon.reg) {
      const ll = rec?.marker?.getLatLng?.(); if (!ll) continue;
      const d = (typeof map?.distance === 'function') ? map.distance(center, ll) : 1e9;
      if (d <= (radiusM || DAMAGE_RADIUS_M)) {
        // items.js의 resolve가 다양한 키를 보니, 가능한 키를 모두 실어 보냄
        out.push({
          id, docId: rec?.data?.docId || id, uid: rec?.data?.uid,
          monsterId: rec?.data?.monsterId, _id: id,
          getLatLng: () => ll,
          battleCtrl: rec?.battleCtrl,   // 있으면 바로 사용
          hit: rec?.battleCtrl?.hit      // ctrl형태면 곧바로 hit 가능
        });
      }
    }
    return out;
  }

  async function triggerMajesticBall() {
    try { ensureAudio(); } catch {}

    const all = (typeof inv.getAll === 'function' ? inv.getAll() : (inv.items || {})) || {};
    const cnt = Number(all.majestic_ball?.qty || 0);
    if (cnt <= 0) { toast?.('마제스틱 볼 아이템이 없습니다'); return; }

    const pLL = playerMarker?.getLatLng?.() || map?.getCenter?.();
    if (!pLL) { toast?.('플레이어 위치를 찾을 수 없습니다.'); return; }

    // 시각 효과(요청: “플레이어 위치에서 화염 원형으로 분출”)
    try { await spawnRadialFlamesAt(map, pLL.lat, pLL.lng, { count: 18, radiusPx: 150, durationMs: 560, shake: true }); } catch {}

    // 중앙 로직으로 실제 사용/피해(-500, 반경 10m)
    await useItem('majestic_ball', {
      map,
      inv,
      player: { lat: pLL.lat, lng: pLL.lng },
      getNearbyHostiles,                 // ← AoE 대상 공급
      // 아래 두 값은 items.js 기본값이 이미 -500 / 10m 이지만,
      // 혹시 별도 CFG가 있을 경우 참고용으로 전달 가능(미사용이면 무시됨)
      damageEach: DMG,
      radiusM: DAMAGE_RADIUS_M
    });

    refreshBadge();
  }

  document.addEventListener('keydown', (e) => {
    if (!e || e.repeat) return;
    if (isTypingElement(e.target)) return;
    if ((e.key || '').toLowerCase() !== 'k') return;
    e.preventDefault(); e.stopPropagation();
    triggerMajesticBall();
  }, { capture: true });

  let btn = null, badge = null;
  if (hasTouch) {
    btn = document.createElement('button');
    btn.id = 'majestic-ball-quick-btn';
    btn.title = '마제스틱 볼 (K)';
    btn.innerHTML = '💥';
    Object.assign(btn.style, {
      position: 'fixed', right: '16px', bottom: '148px',
      width: '56px', height: '56px', borderRadius: '16px',
      border: 'none', background: '#8B008B', color: '#fff',
      fontSize: '26px', boxShadow: '0 10px 30px rgba(0,0,0,.35)',
      zIndex: 2147483647
    });
    btn.addEventListener('click', triggerMajesticBall, { passive: true });
    document.body.appendChild(btn);

    badge = document.createElement('div');
    Object.assign(badge.style, {
      position: 'fixed', right: '12px', bottom: '142px',
      minWidth: '20px', padding: '2px 6px', borderRadius: '999px',
      background: '#f59e0b', color: '#111', fontWeight: '800',
      fontSize: '12px', textAlign: 'center', zIndex: 2147483647
    });
    document.body.appendChild(badge);
  }

  function refreshBadge() {
    if (!badge) return;
    const all = (typeof inv.getAll === 'function' ? inv.getAll() : (inv.items || {})) || {};
    const cnt = Number(all.majestic_ball?.qty || 0);
    badge.textContent = 'x' + cnt;
    badge.style.display = cnt > 0 ? 'block' : 'none';
  }

  try {
    const prev = inv._onChange;
    inv._onChange = (items) => { try { prev?.(items); } catch {} refreshBadge(); };
  } catch {}
  refreshBadge();

  // ✅ 기존 코드가 window.triggerMajesticBall를 호출하더라도 동작하도록 글로벌 패치
  try { window.triggerMajesticBall = triggerMajesticBall; } catch {}
}
