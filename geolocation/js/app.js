// /geolocation/js/app.js
import { onAuth, loginWithGooglePopup } from './auth.js';
import { main } from './main.js';

function showAuthGate() {
  document.getElementById('auth-gate')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'auth-gate';
  Object.assign(wrap.style, {
    position:'fixed', inset:'0',
    background:'linear-gradient(180deg,#0b1220,#0b1220e6)',
    display:'grid', placeItems:'center', zIndex:999999
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    width:'min(420px,92vw)', background:'#111827', color:'#e5e7eb',
    borderRadius:'16px', boxShadow:'0 20px 60px rgba(0,0,0,.45)', padding:'18px'
  });
  card.innerHTML = `
    <div style="font-weight:800;font-size:20px;margin-bottom:14px;">PUPPI - 로그인</div>
    <button id="btn-google" style="
      width:100%;padding:12px;border-radius:12px;border:none;
      background:#fff;color:#111;font-weight:800;
      display:flex;align-items:center;justify-content:center;gap:8px;">
      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" height="20" alt="">
      Google로 계속하기
    </button>
    <div id="auth-msg" style="min-height:18px;margin-top:10px;color:#fca5a5;font-size:12px;"></div>
  `;

  const msg = card.querySelector('#auth-msg');
  card.querySelector('#btn-google').addEventListener('click', async () => {
    msg.textContent = '';
    try {
      await loginWithGooglePopup();    // ⬅️ 팝업 호출
    } catch (e) {
      msg.textContent = e?.message || '로그인 실패';
    }
  });

  wrap.appendChild(card);
  document.body.appendChild(wrap);
}
function hideAuthGate(){ document.getElementById('auth-gate')?.remove(); }

/* 부팅: 팝업만 사용 → 리다이렉트 결과 처리 없음 */
(function boot(){
  console.log('[APP] boot() start, location=', location.href);
  showAuthGate();

  onAuth(async (user)=>{
    console.log('[APP] onAuth state:', !!user, user?.uid);
    if (user){
      hideAuthGate();
      try { await main(); }
      catch (e){ console.error('main start fail', e); showAuthGate(); }
    } else {
      // 미인증 상태: 게이트 유지
    }
  });
})();
