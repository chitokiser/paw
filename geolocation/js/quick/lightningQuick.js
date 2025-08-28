// /geolocation/js/quick/lightningQuick.js
import { ensureAudio, playLightningImpact } from '../audio.js';
import { useItem } from '../items.js'; // ← 중앙집중 로직 사용
import { spawnLightningAt } from '../fx.js';

export function setupLightningQuickUse({ map, inv, toast, playerMarker, getCurrentBattleTarget }) {
  const hasTouch = matchMedia?.('(pointer: coarse)')?.matches || ('ontouchstart' in window);

  const isTypingElement = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return ['input','textarea','select','button'].includes(tag) || !!el.isContentEditable;
  };

  async function triggerLightning() {
    try { ensureAudio(); } catch {}

    const all = (typeof inv.getAll === 'function' ? inv.getAll() : (inv.items || {})) || {};
    const cnt = Number(all.lightning_summon?.qty || 0);
    if (cnt <= 0) { toast?.('벼락소환 아이템이 없습니다'); return; }

    // 기존 이펙트 느낌 유지(선호 시)
    try {
      const ctrl = (typeof getCurrentBattleTarget === 'function' ? getCurrentBattleTarget() : null) || null;
      const pos = ctrl?.getLatLng?.();
      if (pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng)) {
        spawnLightningAt(map, pos.lat, pos.lng, { flashScreen: true, shake: true });
        playLightningImpact?.({ intensity: 1.0, withBoom: true });
      }
    } catch {}

    // 중앙 로직으로 실제 사용/데미지
    await useItem('lightning_summon', { map, inv, toast, getCurrentBattleTarget });

    refreshBadge();
  }

  document.addEventListener('keydown', (e) => {
    if (!e || e.repeat) return;
    if (isTypingElement(e.target)) return;
    if ((e.key || '').toLowerCase() !== 'l') return;
    e.preventDefault(); e.stopPropagation();
    triggerLightning();
  }, { capture: true });

  let btn = null, badge = null;
  if (hasTouch) {
    btn = document.createElement('button');
    btn.id = 'lightning-quick-btn';
    btn.title = '벼락소환 (L)';
    btn.innerHTML = '⚡';
    Object.assign(btn.style, {
      position: 'fixed', right: '16px', bottom: '84px',
      width: '56px', height: '56px', borderRadius: '16px',
      border: 'none', background: '#111827', color: '#fff',
      fontSize: '26px', boxShadow: '0 10px 30px rgba(0,0,0,.35)',
      zIndex: 2147483647
    });
    btn.addEventListener('click', triggerLightning, { passive: true });
    document.body.appendChild(btn);

    badge = document.createElement('div');
    Object.assign(badge.style, {
      position: 'fixed', right: '12px', bottom: '78px',
      minWidth: '20px', padding: '2px 6px', borderRadius: '999px',
      background: '#f59e0b', color: '#111', fontWeight: '800',
      fontSize: '12px', textAlign: 'center', zIndex: 2147483647
    });
    document.body.appendChild(badge);
  }

  function refreshBadge() {
    if (!badge) return;
    const all = (typeof inv.getAll === 'function' ? inv.getAll() : (inv.items || {})) || {};
    const cnt = Number(all.lightning_summon?.qty || 0);
    badge.textContent = 'x' + cnt;
    badge.style.display = cnt > 0 ? 'block' : 'none';
  }

  try {
    const prev = inv._onChange;
    inv._onChange = (items) => { try { prev?.(items); } catch {} refreshBadge(); };
  } catch {}
  refreshBadge();

  // 전역 디버그 훅(선택)
  try { window.triggerLightningSummon = triggerLightning; } catch {}
}
