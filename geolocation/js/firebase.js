// /geolocation/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";

// ⚠️ auth 관련은 auth 모듈에서만 가져옵니다.
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

// ⚠️ Firestore 옵션/퍼시스턴스는 firestore 모듈에서 가져옵니다.
import {
  initializeFirestore,
  getFirestore,
  enableIndexedDbPersistence,
  // enableMultiTabIndexedDbPersistence,  // 필요 시 이걸로 교체
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export const CFG = {
  firebase: {
    apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
    authDomain: "puppi-d67a1.firebaseapp.com",
    projectId: "puppi-d67a1",
    storageBucket: "puppi-d67a1.appspot.com",
    messagingSenderId: "552900371836",
    appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
    measurementId: "G-9TZ81RW0PL"
  },
  feature: {
    guestMode: true
  }
};

export const app = initializeApp(CFG.firebase);

// 🔧 Firestore를 장기 폴링 자동 감지로 초기화(네트워크/방화벽 환경 대비)
initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});
export const db = getFirestore(app);

export const auth = getAuth(app);

// ──────────────────────────────────────────────
// 간단 배너 유틸(호출 시 에러 나지 않도록 로컬 정의)
// ──────────────────────────────────────────────
function showBanner(kind = 'guest', msg = '') {
  try {
    let el = document.getElementById('banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'banner';
      Object.assign(el.style, {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        padding: '10px 14px', background: '#111827', color: '#fff',
        borderTop: '1px solid rgba(255,255,255,.15)', fontWeight: '700'
      });
      document.body.appendChild(el);
    }
    el.textContent = msg || (kind === 'guest'
      ? 'Login required to save progress (guest cannot save).'
      : 'Notice');
  } catch {}
}
function hideBanner() {
  try { document.getElementById('banner')?.remove(); } catch {}
}

// ──────────────────────────────────────────────
// Auth persistence → 익명 로그인 → auth 준비 프로미스
// ──────────────────────────────────────────────
async function ensurePersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.warn('[auth] localPersistence fail → inMemory', e?.code || e);
    await setPersistence(auth, inMemoryPersistence);
  }
}

export const authReady = (async () => {
  await ensurePersistence();

  if (!auth.currentUser && CFG.feature.guestMode) {
    try {
      await signInAnonymously(auth);
    } catch (e) {
      console.error('[auth] anon fail', e);
    }
  }

  // onAuthStateChanged는 "함수"로 사용합니다 (메서드 아님)
  await new Promise(res => {
    const unsub = onAuthStateChanged(auth, () => { unsub?.(); res(); });
  });

  // 로그인된 순간 안내 배너가 떠 있었다면 닫기
  try {
    const u = auth.currentUser;
    if (u) hideBanner();
  } catch {}
})();

// (선택) IndexedDB 퍼시스턴스 — 오프라인 에러 최소화
enableIndexedDbPersistence(db).catch((e) => {
  // 다중 탭 등으로 실패할 수 있으니 경고만 남기고 진행
  console.warn('[firestore] enableIndexedDbPersistence fail', e?.code || e);
});
