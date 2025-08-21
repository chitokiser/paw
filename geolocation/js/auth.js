// /geolocation/js/auth.js
import { auth, db } from './firebase.js';
import {
  onAuthStateChanged, signOut, updateProfile,
  GoogleAuthProvider, signInWithRedirect, getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ───────────────── 메시지 변환 ───────────────── */
function toKoreanAuthMsg(e){
  const code = e?.code || '';
  if (code.includes('configuration-not-found')) return '인증 제공자/도메인 설정 누락 (Firebase 콘솔 확인).';
  if (code.includes('popup-closed-by-user'))   return '로그인이 취소되었습니다.';
  if (code.includes('internal-error'))         return '내부 오류가 발생했습니다. 잠시 후 다시 시도하세요.';
  return e?.message || '로그인 처리 중 오류가 발생했습니다.';
}

/* ───────────────── Firestore 사용자 문서 보장 ───────────────── */
async function ensureUserDoc(uid, email=''){
  const ref = doc(db, 'users', uid);
  const ss  = await getDoc(ref);
  if (ss.exists()) return;

  const level = 1;
  await setDoc(ref, {
    uid,
    character: 1,
    nickname: (email||'').toLowerCase(),
    email: email || '',
    level,
    hp: level * 1000,
    exp: 0,
    attack: level,
    defense: 10,
    chainPoint: 0,
    distanceM: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/* ───────────────── Google Redirect ───────────────── */
const provider = new GoogleAuthProvider();
// 꼭 계정선택을 띄우고 싶다면 주석 해제
// provider.setCustomParameters({ prompt: 'select_account' });

const REDIRECT_FLAG = 'google_redirect_pending';

/** 버튼 클릭에서만 호출: 여기서 페이지가 구글로 이동 */
export async function loginWithGoogleRedirect(){
  try{
    sessionStorage.setItem(REDIRECT_FLAG, '1');
    await signInWithRedirect(auth, provider);
  }catch(e){
    sessionStorage.removeItem(REDIRECT_FLAG);
    throw new Error(toKoreanAuthMsg(e));
  }
}

/** 앱 초기 로드 때 1회만 결과 회수 */
export async function handleGoogleRedirectResult(){
  // 플래그 없으면 복귀 상황 아님 → 아무 것도 하지 않음(루프 방지)
  if (!sessionStorage.getItem(REDIRECT_FLAG)) return null;

  try{
    const res = await getRedirectResult(auth);
    sessionStorage.removeItem(REDIRECT_FLAG);

    if (!res?.user) return null; // 취소/무효
    const user = res.user;

    if (!user.displayName && user.email){
      try { await updateProfile(user, { displayName: user.email }); } catch {}
    }
    await ensureUserDoc(user.uid, user.email || '');
    return user;
  }catch(e){
    sessionStorage.removeItem(REDIRECT_FLAG);
    throw new Error(toKoreanAuthMsg(e));
  }
}

/* ───────────────── 세션/리스너/로그아웃 ───────────────── */
export function onAuth(cb){ return onAuthStateChanged(auth, cb); }

export async function logout(){
  try { await signOut(auth); }
  finally {
    try { localStorage.removeItem('guestId'); } catch {}
    location.reload();
  }
}
