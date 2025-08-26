// /geolocation/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";

import {
  getAuth, signInAnonymously, onAuthStateChanged,
  setPersistence, browserLocalPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

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
    guestMode: true,   // 게스트 허용 (쓰기 금지 정책은 Rules/가드에서 처리)
  }
};

export const app  = initializeApp(CFG.firebase);
export const auth = getAuth(app);
export const db   = getFirestore(app);

async function ensurePersistence(){
  try { await setPersistence(auth, browserLocalPersistence); }
  catch(e){ console.warn('[auth] localPersistence fail → inMemory', e?.code || e); await setPersistence(auth, inMemoryPersistence); }
}

export const authReady = (async () => {
  await ensurePersistence();
  if (!auth.currentUser && CFG.feature.guestMode) {
    try { await signInAnonymously(auth); }
    catch(e){ console.error('[auth] anon fail', e); }
  }
  await new Promise(res => {
    const unsub = onAuthStateChanged(auth, () => { unsub?.(); res(); });
  });
})();


auth.onAuthStateChanged(u=>{
  if (u) hideBanner('guest');          // 로그인된 순간 닫기
});

function guardWrite(fn){
  return async (...args)=>{
    try { return await fn(...args); }
    catch(e){
      if (String(e?.message||'').includes('WALLET_REQUIRED'))
        showBanner('guest', 'Login required to save progress (guest cannot save).');
      throw e;
    }
  };
}
function hideBanner(){ try{ document.getElementById('banner')?.remove(); }catch{} }