// ./js/admin.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, setDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ====== 설정 ====== */
// TODO: 필요 시 .env 또는 서버에서 주입하도록 변경하세요.
const ADMIN_PASS = "1234"; // 데모용. 반드시 교체!
const firebaseConfig = {
  apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.appspot.com",
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* ====== 지도 ====== */
const map = L.map("map", { maxZoom: 22 }).setView([21.0285, 105.8542], 16);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

// Geocoder
const geocoder = L.Control.geocoder({
  defaultMarkGeocode: false
})
  .on("markgeocode", function(e) {
    const center = e.geocode.center;
    map.setView(center, 18);
    setLatLon(center.lat, center.lng);
  })
  .addTo(map);

let pickMarker = null;
map.on("click", (e) => {
  const { lat, lng } = e.latlng;
  setLatLon(lat, lng);
});

function setLatLon(lat, lon) {
  // 마커 갱신
  if (!pickMarker) {
    pickMarker = L.marker([lat, lon], { draggable: true }).addTo(map);
    pickMarker.on("dragend", () => {
      const p = pickMarker.getLatLng();
      setLatLon(p.lat, p.lng);
    });
  } else {
    pickMarker.setLatLng([lat, lon]);
  }

  // 텍스트 표시
  const ct = document.getElementById("coordText");
  if (ct) ct.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

  // 폼 동시 반영
  setInputValue("m_lat", lat);
  setInputValue("m_lon", lon);
  setInputValue("t_lat", lat);
  setInputValue("t_lon", lon);
}

function setInputValue(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = String(v);
}

/* ====== 유틸 ====== */
function valNum(elId, def = null, min = null) {
  const el = document.getElementById(elId);
  if (!el) return def;
  const n = Number(el.value);
  if (Number.isNaN(n)) return def;
  if (min != null && n < min) return min;
  return n;
}
function valStr(elId, def = "") {
  const el = document.getElementById(elId);
  const s = (el?.value ?? "").trim();
  return s || def;
}
function checkPass(inputId) {
  const pass = valStr(inputId, "");
  return pass && pass === ADMIN_PASS;
}
function toast(msg) {
  alert(msg); // 간단 처리. 필요하면 커스텀 토스트 추가
}

/* ====== 몬스터 등록/수정 ====== */
const monsterForm = document.getElementById("monsterForm");
if (monsterForm) {
  monsterForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!checkPass("m_pass")) { toast("관리 비밀번호가 올바르지 않습니다."); return; }

    const lat = valNum("m_lat");
    const lon = valNum("m_lon");
    const imageURL = valStr("imageURL");
    const power = valNum("power", 20, 1);
    const mid = valNum("mid", 0, 0);
    const size = valNum("size", 96, 24);
    const range = valNum("m_range", null, 10);        // null이면 MonsterGuard 기본값 사용
    const damage = valNum("m_damage", null, 1);
    const cooldownMs = valNum("m_cooldown", null, 200);

    if (lat == null || lon == null) { toast("지도를 클릭해 좌표를 선택하세요."); return; }

    const payload = {
      lat, lon,
      imageURL,
      power,
      mid,
      ...(size ? { size } : {}),
      ...(range ? { range } : {}),
      ...(damage ? { damage } : {}),
      ...(cooldownMs ? { cooldownMs } : {}),
      updatedAt: serverTimestamp()
    };

    const docId = valStr("m_docId", "");
    try {
      if (docId) {
        await setDoc(doc(db, "monsters", docId), payload, { merge: true });
        toast(`몬스터 업데이트 완료 (doc: ${docId})`);
      } else {
        const ref = await addDoc(collection(db, "monsters"), { ...payload, createdAt: serverTimestamp() });
        toast(`몬스터 등록 완료 (doc: ${ref.id})`);
        setInputValue("m_docId", ref.id);
      }
    } catch (err) {
      console.warn(err);
      toast("몬스터 등록/수정 중 오류가 발생했습니다.");
    }
  });
}

/* ====== 망루 등록/수정 ====== */
const towerForm = document.getElementById("towerForm");
if (towerForm) {
  towerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!checkPass("t_pass")) { toast("관리 비밀번호가 올바르지 않습니다."); return; }

    const lat = valNum("t_lat");
    const lon = valNum("t_lon");
    const range = valNum("t_range", 60, 10);
    const iconUrl = valStr("t_icon", "https://puppi.netlify.app/images/mon/tower.png");

    if (lat == null || lon == null) { toast("지도를 클릭해 좌표를 선택하세요."); return; }

    const payload = {
      lat, lon,
      range,
      iconUrl,
      updatedAt: serverTimestamp()
    };

    const docId = valStr("t_docId", "");
    try {
      if (docId) {
        await setDoc(doc(db, "towers", docId), payload, { merge: true });
        toast(`망루 업데이트 완료 (doc: ${docId})`);
      } else {
        const ref = await addDoc(collection(db, "towers"), { ...payload, createdAt: serverTimestamp() });
        toast(`망루 등록 완료 (doc: ${ref.id})`);
        setInputValue("t_docId", ref.id);
      }
    } catch (err) {
      console.warn(err);
      toast("망루 등록/수정 중 오류가 발생했습니다.");
    }
  });
}

/* ====== 초기 좌표 세팅 (현재 위치 시도) ====== */
(async function initPosition(){
  try {
    await new Promise(res=>{
      if (!navigator.geolocation){ res(); return; }
      navigator.geolocation.getCurrentPosition(
        p=>{ setLatLon(p.coords.latitude, p.coords.longitude); map.setView([p.coords.latitude, p.coords.longitude], 18); res(); },
        ()=>res(), { enableHighAccuracy:true, timeout:6000 }
      );
    });
  } catch {}
})();
