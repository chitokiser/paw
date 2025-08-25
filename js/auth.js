// /geolocation/js/auth.js
// 게스트 전용. Firebase 세션이 남아 있으면 강제 로그아웃해서 이메일이 안 들어가게 함.

const LS_KEY = "pup_guest_id";
function makeId() {
  if (crypto?.getRandomValues) {
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    return Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}
export function getGuestId() {
  let id = localStorage.getItem(LS_KEY);
  if (!id) { id = makeId(); localStorage.setItem(LS_KEY, id); }
  return id;
}

// ✅ 남아있는 Firebase 세션이 있으면 정리 (있어도 없어도 에러 없이 지나감)
(async function killFirebaseAuthIfAny(){
  try {
    const mod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const { getAuth, signOut } = mod;
    const auth = getAuth();
    if (auth?.currentUser) { await signOut(auth); }
    // Firebase가 남긴 localStorage 캐시도 정리(키 접두사)
    Object.keys(localStorage).forEach(k=>{
      if (k.startsWith("firebase:authUser:")) localStorage.removeItem(k);
    });
  } catch (_) { /* Firebase 미로딩이면 여기로 옴 */ }
})();

// 기존 인터페이스 유지
export function onAuth(cb) {
  const user = { uid: getGuestId(), isGuest: true };
  window.GH_MODE = "guest";           // ← 전역 플래그
  window.GH_UID  = user.uid;
  queueMicrotask(()=>cb(user));
}
export async function loginWithGooglePopup() {
  throw new Error("이제 Google 로그인은 사용하지 않습니다. 게스트로 진행하세요.");
}
export function currentUser(){ return { uid: getGuestId(), isGuest:true }; }
export async function ensureUserDoc(_data = {}) {
  return {
    uid: getGuestId(),
    isGuest: true,
    saved: false,          // 서버에 저장 안 됨
  };
}

/** (선택) main.js에서 사용할 수 있도록 간단한 헬퍼도 내보내기 */
export function isGuest() { return true; }