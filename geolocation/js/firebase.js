// /geolocation/js/firebase.js
// Firebase v10 modular SDK (CDN). No anonymous/guest auth.
// - Persistent local cache (multi-tab) with fallback to memory.
// - Auto long-poll detection for restricted networks.
// - Exports: app, db, auth, authReady.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================
 * App Config
 * ========================= */
export const CFG = {
  firebase: {
    apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
    authDomain: "puppi-d67a1.firebaseapp.com",
    projectId: "puppi-d67a1",
    storageBucket: "puppi-d67a1.appspot.com",
    messagingSenderId: "552900371836",
    appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
    measurementId: "G-9TZ81RW0PL"
  }
};

export const app = initializeApp(CFG.firebase);

/* =========================
 * Firestore Init (persistent cache → fallback)
 * ========================= */
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    }),
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
  });
} catch (e) {
  console.warn("[firestore] persistent cache init failed → memory cache:", e?.message || e);
  try {
    db = initializeFirestore(app, {
      localCache: memoryLocalCache(),
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false
    });
  } catch (e2) {
    console.error("[firestore] memory cache init failed:", e2?.message || e2);
    initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false
    });
    db = getFirestore(app);
  }
}
export { db };

/* =========================
 * Auth (NO anonymous)
 * ========================= */
export const auth = getAuth(app);

async function ensurePersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.warn("[auth] localPersistence failed → inMemory", e?.code || e);
    await setPersistence(auth, inMemoryPersistence);
  }
}

/** Resolves after the first auth state emission (user may be null). */
export const authReady = (async () => {
  await ensurePersistence();
  await new Promise((res) => {
    const unsub = onAuthStateChanged(auth, () => { try { unsub?.(); } catch {} ; res(); });
  });
})();
