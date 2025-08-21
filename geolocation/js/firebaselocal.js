// firebase.js

//접속 명령어 firebase emulators:start --only hosting,auth,firestore

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-functions.js";

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
export const auth = getAuth(app);
export const functions = getFunctions(app);

/* ✅ 에뮬레이터 강제 플래그:
   - ?emu=1 쿼리
   - localStorage.setItem('emu','1')
*/
const forcedEmu = new URLSearchParams(location.search).get('emu') === '1'
  || localStorage.getItem('emu') === '1';

/* ✅ 로컬/사설 IP/테스트 도메인까지 포괄 */
const h = location.hostname;
const isLocalHost =
  h === 'localhost' ||
  h === '127.0.0.1' ||
  h.endsWith('.local') ||
  /^192\.168\.\d+\.\d+$/.test(h) ||
  /^10\.\d+\.\d+\.\d+$/.test(h) ||
  /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h);

if (forcedEmu || isLocalHost) {
  // ⚠️ 프로토콜은 http, 호스트는 IP/호스트명 정확히
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  // connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  console.log('[firebase] Using emulators');
} else {
  console.log('[firebase] Using production backends');
}
