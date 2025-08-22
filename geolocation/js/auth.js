// /geolocation/js/auth.js
import { auth, db } from './firebase.js';
import {
  onAuthStateChanged, updateProfile,
  GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* Firestore 사용자 문서 보장 */
export async function ensureUserDoc(uid, email=''){
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  const level = 1;
  await setDoc(ref, {
    uid, character: 1,
    nickname: (email||'').toLowerCase(),
    email: email||'',
    level, hp: level*1000, exp:0, attack:level, defense:10,
    chainPoint:0, distanceM:0,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }, { merge:true });
}

/* ───────── Google 팝업 전용 ───────── */
const provider = new GoogleAuthProvider();
// 필요시 계정 선택 유도
// provider.setCustomParameters({ prompt: 'select_account' });

/** 버튼 클릭 시 호출: 팝업 로그인(리다이렉트 사용 안 함) */
export async function loginWithGooglePopup(){
  try {
    const res = await signInWithPopup(auth, provider);
    const u = res?.user;
    if (!u) throw new Error('로그인 실패: 사용자 정보가 없습니다.');
    if (!u.displayName && u.email) {
      try { await updateProfile(u, { displayName: u.email }); } catch {}
    }
    await ensureUserDoc(u.uid, u.email || '');
    return u;
  } catch (e) {
    // 팝업 차단/환경 차단 메시지 보강
    const code = e?.code || '';
    if (code.includes('popup-blocked')) throw new Error('브라우저가 팝업을 차단했습니다. 주소창 오른쪽 팝업 차단 아이콘을 눌러 허용해 주세요.');
    if (code.includes('cancelled') || code.includes('popup-closed')) throw new Error('팝업이 닫혔습니다. 다시 시도해 주세요.');
    throw e;
  }
}

/* 세션 콜백/로그아웃 */
export function onAuth(cb){ return onAuthStateChanged(auth, cb); }
export async function logout(){ try { await signOut(auth); } catch {} }
