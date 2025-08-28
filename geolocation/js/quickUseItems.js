// quickUse.js 
(function () {
  'use strict';

  // ensureAudio, playThunderBoom, playLightningImpact, spawnLightningAt, spawnMajesticExplosionAt
  // 는 전역에 이미 로드되어 있다고 가정

  // 안전한 터치 감지(구형 브라우저 호환)
  function detectTouch() {
    try {
      if ('ontouchstart' in window) return true;
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) {}
    return false;
  }

  function isTypingElement(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select', 'button'].includes(tag)) return true;
    return !!el.isContentEditable;
  }

  /* ──────────────────────────────────────────────────────────────
   * 벼락소환 퀵 사용: 데스크탑=L키, 모바일=플로팅 버튼
   * ────────────────────────────────────────────────────────────── */
  function setupLightningQuickUse({ map, inv, toast, playerMarker, getCurrentBattleTarget }) {
    const hasTouch = detectTouch();

    let btn = null, badge = null;

    async function triggerLightning() {
      try { if (typeof ensureAudio === 'function') ensureAudio(); } catch (e) {}
      const ctrl =
        (typeof getCurrentBattleTarget === 'function' ? getCurrentBattleTarget() : undefined)
        || window.__battleCtrlLast || null;

      if (!ctrl || (typeof ctrl.isDead === 'function' && ctrl.isDead())) {
        if (typeof toast === 'function') toast('대상이 없습니다. 몬스터를 먼저 공격하세요');
        return;
      }

      const all = (inv && typeof inv.getAll === 'function' ? inv.getAll() : (inv && inv.items) || {}) || {};
      const cnt = Number((all.lightning_summon && all.lightning_summon.qty) || 0);
      if (cnt <= 0) { if (typeof toast === 'function') toast('벼락소환 아이템이 없습니다'); return; }

      try {
        const pos = (typeof ctrl.getLatLng === 'function' ? ctrl.getLatLng() : {}) || {};
        const lat = pos.lat, lng = pos.lng;
        if (lat != null && lng != null) {
          try { if (typeof spawnLightningAt === 'function') spawnLightningAt(map, lat, lng, { flashScreen: true, shake: true }); } catch (e) {}
          try { if (typeof playLightningImpact === 'function') playLightningImpact({ intensity: 1.0, withBoom: true }); } catch (e) {}
        }
      } catch (e) {}

      if (typeof ctrl.hit === 'function') await ctrl.hit(1000, { lightning: true, crit: true });
      if (inv && typeof inv.useItem === 'function') await inv.useItem('lightning_summon', 1); // 소모 처리

      if (typeof toast === 'function') toast('⚡ 벼락! 1000 데미지');
      refreshBadge();
    }

    document.addEventListener('keydown', (e) => {
      if (!e || e.repeat) return;
      if (isTypingElement(e.target)) return;
      if ((e.key || '').toLowerCase() !== 'l') return;
      e.preventDefault();
      e.stopPropagation();
      triggerLightning();
    }, { capture: true });

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
      const all = (inv && typeof inv.getAll === 'function' ? inv.getAll() : (inv && inv.items) || {}) || {};
      const cnt = Number((all.lightning_summon && all.lightning_summon.qty) || 0);
      badge.textContent = 'x' + cnt;
      badge.style.display = cnt > 0 ? 'block' : 'none';
    }

    try {
      const prev = inv && inv._onChange;
      if (inv) inv._onChange = (items) => { try { if (typeof prev === 'function') prev(items); } catch (e) {} refreshBadge(); };
    } catch (e) {}
    refreshBadge();
  }

  /* ──────────────────────────────────────────────────────────────
   * 마제스틱 볼 퀵 사용: 데스크탑=K키, 모바일=플로팅 버튼
   * ────────────────────────────────────────────────────────────── */
  function setupMajesticBallQuickUse({ map, inv, toast, rtMon, playerMarker }) {
    const hasTouch = detectTouch();
    const DAMAGE_RADIUS_M = 20; // 20미터 반경
    const DAMAGE_AMOUNT = 1000; // 1000 데미지

    let btn = null, badge = null;

    async function triggerMajesticBall() {
      try { if (typeof ensureAudio === 'function') ensureAudio(); } catch (e) {}

      const all = (inv && typeof inv.getAll === 'function' ? inv.getAll() : (inv && inv.items) || {}) || {};
      const cnt = Number((all.majestic_ball && all.majestic_ball.qty) || 0);
      if (cnt <= 0) { if (typeof toast === 'function') toast('마제스틱 볼 아이템이 없습니다'); return; }

      // 플레이어 위치
      const playerLL = playerMarker && typeof playerMarker.getLatLng === 'function' ? playerMarker.getLatLng() : null;
      if (!playerLL) { if (typeof toast === 'function') toast('플레이어 위치를 찾을 수 없습니다.'); return; }

      // 화려한 그래픽 효과
      try { if (typeof spawnMajesticExplosionAt === 'function') spawnMajesticExplosionAt(map, playerLL.lat, playerLL.lng); } catch (e) {}
      try { if (typeof playThunderBoom === 'function') playThunderBoom({ intensity: 0.8 }); } catch (e) {}

      let hitCount = 0;

      // 주변 몬스터에게 데미지 (rtMon.reg가 Map이라고 가정)
      const reg = rtMon && rtMon.reg;
      if (reg && typeof reg.forEach === 'function') {
        reg.forEach((rec, id) => {
          try {
            if (!rec || !rec.marker || !rec.data) return;
            const monsterLL = rec.marker.getLatLng();
            const dist = map.distance(playerLL, monsterLL);
            if (dist <= DAMAGE_RADIUS_M) {
              if (typeof window.__applyPlayerDamage === 'function') {
                window.__applyPlayerDamage(id, DAMAGE_AMOUNT);
                hitCount++;
              } else {
                console.warn('window.__applyPlayerDamage 함수를 찾을 수 없습니다.');
              }
            }
          } catch (e) {
            console.warn('마제스틱 볼 데미지 적용 중 오류:', e);
          }
        });
      }

      if (inv && typeof inv.useItem === 'function') await inv.useItem('majestic_ball', 1); // 소모 처리

      if (typeof toast === 'function') toast(`💥 마제스틱 볼 사용! ${hitCount}마리 몬스터에게 ${DAMAGE_AMOUNT} 데미지!`);
      refreshBadge();
    }

    document.addEventListener('keydown', (e) => {
      if (!e || e.repeat) return;
      if (isTypingElement(e.target)) return;
      if ((e.key || '').toLowerCase() !== 'k') return;
      e.preventDefault();
      e.stopPropagation();
      triggerMajesticBall();
    }, { capture: true });

    if (hasTouch) {
      btn = document.createElement('button');
      btn.id = 'majestic-ball-quick-btn';
      btn.title = '마제스틱 볼 (K)';
      btn.innerHTML = '💥';
      Object.assign(btn.style, {
        position: 'fixed', right: '16px', bottom: '148px', // 벼락소환 버튼 위
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
      const all = (inv && typeof inv.getAll === 'function' ? inv.getAll() : (inv && inv.items) || {}) || {};
      const cnt = Number((all.majestic_ball && all.majestic_ball.qty) || 0);
      badge.textContent = 'x' + cnt;
      badge.style.display = cnt > 0 ? 'block' : 'none';
    }

    try {
      const prev = inv && inv._onChange;
      if (inv) inv._onChange = (items) => { try { if (typeof prev === 'function') prev(items); } catch (e) {} refreshBadge(); };
    } catch (e) {}
    refreshBadge();
  }

  // 전역에 내보내기 (export 없이 사용 가능)
  window.setupLightningQuickUse = setupLightningQuickUse;
  window.setupMajesticBallQuickUse = setupMajesticBallQuickUse;
})();
