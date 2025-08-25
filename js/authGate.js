import { loginWithGoogleRedirect, handleGoogleRedirectResult } from './auth.js';

function renderGate(resolve){
  const wrap=document.createElement('div'); wrap.className='gate-dim';
  wrap.innerHTML = `
    <div class="gate-card">
      <div class="gate-title">Google 로그인</div>
      <div class="gate-actions">
        <button class="btn-main" id="g-google">Google 계정으로 로그인</button>
      </div>
      <div class="gate-msg" id="g-msg"></div>
    </div>`;
  document.body.appendChild(wrap);

  wrap.querySelector('#g-google').addEventListener('click', async ()=>{
    try{
      await loginWithGoogleRedirect(); // ✅ redirect 시작
    }catch(e){
      wrap.querySelector('#g-msg').textContent = e.message || e;
    }
  });
}

export async function ensureSignedIn(){
  return new Promise(async (resolve)=>{
    // ✅ redirect 복귀 체크
    const user = await handleGoogleRedirectResult();
    if (user) return resolve(user);

    // 상태 모니터링
    onAuthStateChanged(auth, (u)=>{
      if (u) resolve(u);
      else renderGate(resolve);
    });
  });
}
