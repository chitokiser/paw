// /geolocation/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
/* 1) Firebase Web App 설정 (항상 최상단) */
const firebaseConfig = {
  apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.appspot.com",
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
};

/* 2) 앱 초기화 + export */
export const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);


/* 3) 로그인 세션을 로컬에 유지 (권장) */
try {
  await setPersistence(auth, browserLocalPersistence);
} catch (e) {
  console.warn('[firebase] setPersistence fail:', e);
}
