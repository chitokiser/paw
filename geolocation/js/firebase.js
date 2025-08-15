// /geolocation/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// ▶ Firebase 프로젝트 키 (실서비스)
const firebaseConfig = {
  apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.appspot.com",
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
};

export const app = initializeApp(firebaseConfig);
// ✅ 에뮬레이터 연결 코드 전부 제거
export const db  = getFirestore(app);
