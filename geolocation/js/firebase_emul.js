// geolocation/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore,
  connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/** 프로젝트 키 (실서비스/에뮬레이터 공용) */
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
export const db  = getFirestore(app);

/** 에뮬레이터 사용 여부 감지
 * - localhost / 127.0.0.1 / 개발 서버(예: 127.0.0.1:5550)
 * - 또는 쿼리파라미터 ?emu=1 로 강제
 */
const host = location.hostname;
const forceEmu = new URLSearchParams(location.search).get("emu") === "1";
const isLocal =
  host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.");
export const isEmulator = forceEmu || isLocal;

if (isEmulator) {
  // 기본 포트 8080 (firebase init 때 바꿨다면 그 값으로)
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  console.log("[Firestore] Emulator connected: 127.0.0.1:8080");
}

