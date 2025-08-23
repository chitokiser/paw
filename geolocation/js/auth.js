// /geolocation/js/auth.js
import { auth, db } from './firebase.js';

import {
  // Auth
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js';

import {
  // Firestore
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';

/* ──────────────────────────────────────────
 * 공통: 에러를 한국어로 보기 좋게
 * ────────────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PW   = 6;

function toKoreanAuthMsg(e){
  const code = e?.code || '';
  if (code.includes('invalid-email'))            return '이메일 형식이 올바르지 않습니다.';
  if (code.includes('email-already-in-use'))     return '이미 가입된 이메일입니다.';
  if (code.includes('weak-password'))            return '비밀번호는 6자리 이상이어야 합니다.';
  if (code.includes('wrong-password'))           return '비밀번호가 올바르지 않습니다.';
  if (code.includes('user-not-found'))           return '가입되지 않은 계정입니다.';
  if (code.includes('popup-blocked'))            return '브라우저가 팝업을 차단했습니다. 허용 후 다시 시도하세요.';
  if (code.includes('popup-closed-by-user'))     return '팝업이 닫혔습니다. 다시 시도해 주세요.';
  if (code.includes('operation-not-allowed'))    return '제공자가 비활성화되었습니다. 콘솔 설정을 확인하세요.';
  if (code.includes('configuration-not-found'))  return '인증 제공자/도메인 설정이 누락되었습니다.';
  return e?.message || '요청을 처리하지 못했습니다.';
}

/* ──────────────────────────────────────────
 * Firestore: 사용자 문서 보장 (읽기 1회만)
 *  - 이미 있으면 아무것도 하지 않음
 *  - 없으면 최소 필드로 생성
 * ────────────────────────────────────────── */
export async function ensureUserDoc(uid, email=''){
  const ref  = doc(db, 'users', uid);
  const snap = await getDoc(ref);              // ⚠️ 최초 1회 읽기
  if (snap.exists()) return;

  const level = 1;
  await setDoc(ref, {
    uid,
    character: 1,
    nickname: (email || '').toLowerCase(),
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

/* ──────────────────────────────────────────
 * 이메일/비밀번호
 * ────────────────────────────────────────── */
export async function registerWithEmail(email, password){
  const em = String(email||'').trim();
  const pw = String(password||'').trim();
  if (!EMAIL_RE.test(em)) throw new Error('이메일 형식이 아닙니다.');
  if (pw.length < MIN_PW) throw new Error(`비밀번호는 ${MIN_PW}자리 이상이어야 합니다.`);

  try {
    const cred = await createUserWithEmailAndPassword(auth, em, pw);
    const u    = cred.user;

    // displayName = 이메일 (대화명 정책)
    try { await updateProfile(u, { displayName: em }); } catch {}

    await ensureUserDoc(u.uid, u.email || '');
    return u;
  } catch (e) {
    throw new Error(toKoreanAuthMsg(e));
  }
}

export async function loginWithEmail(email, password){
  const em = String(email||'').trim();
  const pw = String(password||'').trim();
  if (!EMAIL_RE.test(em)) throw new Error('이메일 형식이 아닙니다.');
  if (pw.length < 1)      throw new Error('비밀번호를 입력해 주세요.');

  try {
    const cred = await signInWithEmailAndPassword(auth, em, pw);
    const u    = cred.user;
    await ensureUserDoc(u.uid, u.email || '');
    return u;
  } catch (e) {
    throw new Error(toKoreanAuthMsg(e));
  }
}

/* ──────────────────────────────────────────
 * Google 로그인 (팝업 기본)
 *  - 프로젝트 요구사항: 팝업 우선
 *  - 필요 시 redirect 함수도 함께 제공
 * ────────────────────────────────────────── */
const googleProvider = new GoogleAuthProvider();
// 필요하면 계정 선택 유도
// googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function loginWithGooglePopup(){
  try {
    const res = await signInWithPopup(auth, googleProvider);
    const u = res?.user;
    if (!u) throw new Error('로그인 실패: 사용자 정보가 없습니다.');

    if (!u.displayName && u.email) {
      try { await updateProfile(u, { displayName: u.email }); } catch {}
    }
    await ensureUserDoc(u.uid, u.email || '');
    return u;
  } catch (e) {
    throw new Error(toKoreanAuthMsg(e));
  }
}

/* (옵션) Redirect 방식 — 모바일/팝업 불가 환경 대응 */
const REDIR_FLAG = 'google_redirect_pending';

export async function loginWithGoogleRedirect(){
  try {
    sessionStorage.setItem(REDIR_FLAG, '1');
    await signInWithRedirect(auth, googleProvider);
  } catch (e) {
    sessionStorage.removeItem(REDIR_FLAG);
    throw new Error(toKoreanAuthMsg(e));
  }
}

/** 앱 초기 부트 시 1회 호출하면, 리다이렉트 복귀 결과를 처리해 줍니다. */
export async function handleGoogleRedirectResult(){
  if (!sessionStorage.getItem(REDIR_FLAG)) return null; // 복귀 아님
  try {
    const res = await getRedirectResult(auth);
    sessionStorage.removeItem(REDIR_FLAG);
    const u = res?.user;
    if (!u) return null;

    if (!u.displayName && u.email) {
      try { await updateProfile(u, { displayName: u.email }); } catch {}
    }
    await ensureUserDoc(u.uid, u.email || '');
    return u;
  } catch (e) {
    sessionStorage.removeItem(REDIR_FLAG);
    throw new Error(toKoreanAuthMsg(e));
  }
}

/* ──────────────────────────────────────────
 * 세션 콜백 / 로그아웃
 * ────────────────────────────────────────── */
export function onAuth(cb){ return onAuthStateChanged(auth, cb); }

export async function logout(){
  try { await signOut(auth); } catch {}
}
