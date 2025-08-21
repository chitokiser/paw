// /geolocation/js/authGate.js
import { auth, db } from './firebase.js';
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  updateProfile, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const MIN_PW = 6;

function injectCSS(){
  if (document.getElementById('auth-gate-css')) return;
  const s=document.createElement('style'); s.id='auth-gate-css';
  s.textContent = `
  .gate-dim{position:fixed;inset:0;background:#0b0f1a;display:flex;align-items:center;justify-content:center;z-index:999999;}
  .gate-card{width:min(420px,92vw);background:#111827;color:#e5e7eb;border:1px solid #243244;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.4);padding:16px}
  .gate-title{font-weight:800;font-size:18px;margin-bottom:8px}
  .gate-row{display:flex;gap:8px;margin:6px 0}
  .gate-row input{flex:1;padding:10px;border-radius:10px;border:1px solid #314459;background:#0f172a;color:#e5e7eb}
  .gate-actions{display:flex;gap:8px;margin-top:10px}
  .gate-actions button{flex:1;padding:10px;border-radius:10px;border:none;cursor:pointer;font-weight:800}
  .btn-main{background:#2563eb;color:#fff}
  .btn-sub{background:#334155;color:#e5e7eb}
  .gate-msg{margin-top:6px;color:#fca5a5;font-weight:700;min-height:1em}
  `;
  document.head.appendChild(s);
}

function renderGate(resolve){
  injectCSS();
  const wrap=document.createElement('div'); wrap.className='gate-dim';
  wrap.innerHTML = `
    <div class="gate-card">
      <div class="gate-title">로그인/회원가입</div>
      <div class="gate-row"><input id="g-email" type="email" placeholder="이메일 (대화명 규칙: 이메일 형식)"/></div>
     <div class="gate-row"><input id="g-pass"  type="password" minlength="4" placeholder="비밀번호 (4자리 이상)"/></div>
  <div class="gate-row"><input id="g-pass2" type="password" minlength="4" placeholder="비밀번호 확인"/></div>
  <div class="gate-actions">
    <div class="gate-actions">
  <button class="btn-main" id="g-login">로그인</button>
  <button class="btn-sub" id="g-signup">회원가입</button>
</div>
<div class="gate-actions">
  <button class="btn-main" id="g-google">Google로 로그인</button>
</div>

  </div>
  <div class="gate-msg" id="g-msg"></div>
</div>`;
  document.body.appendChild(wrap);

  const $ = (sel)=>wrap.querySelector(sel);
  const emailEl = $('#g-email'), passEl = $('#g-pass'), pass2El = $('#g-pass2'), msgEl = $('#g-msg');

  const showErr = (e)=>{ msgEl.textContent = (e?.message || e || '오류'); };
  const clearMsg = ()=>{ msgEl.textContent = ''; };
  const validEmail = (v)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  async function ensureUserDoc(user){
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return;

    // 회원 DB 정책 반영
    const nickname = (user.email || '').toLowerCase();
    const level = 1;
    const hp = level * 1000;

    await setDoc(ref, {
      uid: user.uid,
      character: 1,            // 케릭터: 기본값 1
      nickname,                // 대화명: 이메일 형식
      email: user.email || '',
      level,                   // 가입성공하면 1
      hp,                      // HP = 레벨 x 1000
      exp: 0,                  // 경험치EXP = 몬스터 파워 (전투에서 가산)
      nextLevelExp: (level+1) * 20000, // 레벨업 조건
      attack: level,           // 공격력 = 레벨 + 장착무기 (무기는 전투 시 가산)
      defense: 10,             // 기본값 10 (블록체인 연동 예정)
      chainPoint: 0,           // 기본값 0 (죽으면 초기화)
      distanceM: 0,            // 이동거리 필드
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    try { await updateProfile(user, { displayName: nickname }); } catch {}
  }

  $('#g-login').addEventListener('click', async ()=>{
    try{
      const email = (emailEl.value || '').trim();
      const pass  = passEl.value || '';
      if (!validEmail(email)) return showErr('이메일 형식이 아닙니다');
      if (pass.length < MIN_PW) return showErr(`비밀번호는 ${MIN_PW}자리 이상`);
      clearMsg();
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await ensureUserDoc(cred.user);
      wrap.remove(); resolve(cred.user);
    }catch(e){ showErr(e); }
  });

  $('#g-signup').addEventListener('click', async ()=>{
    try{
      const email = (emailEl.value || '').trim();
      const pass  = passEl.value || '';
      const pass2 = pass2El.value || '';
      if (!validEmail(email)) return showErr('이메일 형식이 아닙니다');
      if (pass.length < MIN_PW) return showErr(`비밀번호는 ${MIN_PW}자리 이상`);
      if (pass !== pass2) return showErr('비밀번호가 일치하지 않습니다');
      clearMsg();
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await ensureUserDoc(cred.user);
      wrap.remove(); resolve(cred.user);
    }catch(e){ showErr(e); }
  });

  return wrap;
}

wrap.querySelector('#g-google').addEventListener('click', async ()=>{
  try {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    await ensureUserDoc(cred.user); // DB 정책 반영
    wrap.remove(); resolve(cred.user);
  } catch(e) {
    showErr(e);
  }
});



/** 로그인 완료될 때까지 대기. */
export function ensureSignedIn(){
  return new Promise((resolve)=>{
    const unsub = onAuthStateChanged(auth, async (u)=>{
      if (u) { try{unsub();}catch{} resolve(u); }
      else { renderGate(resolve); }
    });
  });
}
