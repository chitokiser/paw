// /geolocation/js/app.js
import { onAuth, loginWithGoogleRedirect, handleGoogleRedirectResult } from './auth.js';
import { main } from './main.js';

// 중복 로드 가드(스크립트 2번 삽입 방지)
if (window.__PUPPI_APP_LOADED__) {
  throw new Error('app.js loaded twice');
}
window.__PUPPI_APP_LOADED__ = true;

function showAuthGate(){
  document.getElementById('auth-gate')?.remove();

  const wrap = document.createElement('div');
  wrap.id = 'auth-gate';
  Object.assign(wrap.style, {
    position:'fixed', inset:'0',
    background:'linear-gradient(180deg,#0b1220,#0b1220e6)',
    display:'grid', placeItems:'center', zIndex: 999999
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    width:'min(420px,92vw)', background:'#111827', color:'#e5e7eb',
    borderRadius:'16px', boxShadow:'0 20px 60px rgba(0,0,0,.45)', padding:'18px'
  });
  card.innerHTML = `
    <div style="font-weight:800;font-size:20px;margin-bottom:12px;">PUPPI - 로그인</div>
    <button id="btn-google" style="width:100%;padding:10px;border-radius:12px;background:#fff;color:#111;font-weight:800;border:1px solid #e5e7eb">
      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;vertical-align:middle;margin-right:8px"/>
      Google로 계속하기
    </button>
    <div id="auth-msg" style="min-height:18px;margin-top:8px;color:#fca5a5;font-size:12px;"></div>
  `;

  const msg  = card.querySelector('#auth-msg');
  const btnG = card.querySelector('#btn-google');

  // 버튼에서만 리다이렉트 시작 (자동 호출 절대 금지)
  btnG.addEventListener('click', async ()=>{
    msg.textContent = '';
    btnG.disabled = true;
    try { await loginWithGoogleRedirect(); } // 여기서 구글로 이동
    catch(e){ msg.textContent = e?.message || 'Google 로그인 실패'; btnG.disabled = false; }
  });

  wrap.appendChild(card);
  document.body.appendChild(wrap);
}

function hideAuthGate(){ document.getElementById('auth-gate')?.remove(); }

// 최초 게이트 표시
showAuthGate();

// 리다이렉트 복귀 시 결과 1회 회수(플래그 없으면 아무 일도 안 함 → 루프 방지)
handleGoogleRedirectResult().catch(err=>{
  console.warn('[redirect handle] fail:', err);
});

// 인증 상태에 따라 게임 부트
let started = false;
onAuth(async (user)=>{
  if (user && !started){
    started = true;
    try { localStorage.setItem('guestId', user.uid); } catch {}
    hideAuthGate();
    try { await main(); }
    catch(e){
      console.error('main start fail', e);
      started = false;
      showAuthGate();
    }
  } else if (!user){
    showAuthGate();
  }
});
