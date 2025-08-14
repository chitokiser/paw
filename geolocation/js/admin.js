// /js/admin.js  — 지정 위치에 몬스터 등록 (size/power 포함), 검증/UX 보강

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ================= Firebase ================= */
const app = initializeApp({
  apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.appspot.com",
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
});
const db = getFirestore(app);

/* ================ Helpers ================ */
const $ = (id) => document.getElementById(id);
const asInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};
const isHttpUrl = (s) => /^https?:\/\/.+/i.test(s || "");

/* ================ Map ================ */
const map = L.map("map").setView([37.5665, 126.9780], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

L.Control.geocoder({ defaultMarkGeocode: false })
  .on("markgeocode", (e) => {
    const bbox = e.geocode.bbox;
    const poly = L.polygon([
      bbox.getSouthEast(),
      bbox.getNorthEast(),
      bbox.getNorthWest(),
      bbox.getSouthWest(),
    ]);
    map.fitBounds(poly.getBounds());
    setClicked(e.geocode.center);
  })
  .addTo(map);

// 현재 위치로 초기 중심 맞추기(가능한 경우)
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (p) => map.setView([p.coords.latitude, p.coords.longitude], 15),
    () => {}, // 실패시 무시(기본 좌표 유지)
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

let clickedLatLng = null;
let currentMarker = null;

map.on("click", (e) => setClicked(e.latlng));

function setClicked(latlng) {
  clickedLatLng = latlng;
  const txt = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
  const coordEl = $("coordText");
  if (coordEl) coordEl.textContent = txt;

  if (currentMarker) map.removeLayer(currentMarker);
  currentMarker = L.marker(latlng).addTo(map).bindPopup("위치 선택됨").openPopup();
}

/* ================ Form ================ */
const form = $("monsterForm");
if (!form) {
  console.error("monsterForm not found in DOM.");
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!clickedLatLng) {
    alert("지도를 클릭해 위치를 선택하세요.");
    return;
  }

  const mid = asInt($("mid")?.value);
  const pass = asInt($("pass")?.value);
  const imageURL = $("imageURL")?.value?.trim();
  const power = asInt($("power")?.value); // 필수
  const size = asInt($("size")?.value);   // 선택

  // ---- 입력 검증 ----
  if (!Number.isFinite(mid) || mid <= 0) {
    alert("몬스터 ID(mid)는 1 이상의 숫자여야 합니다.");
    return;
  }
  if (!Number.isFinite(pass) || pass <= 0) {
    alert("비밀번호(pass)는 1 이상의 숫자여야 합니다.");
    return;
  }
  if (!isHttpUrl(imageURL)) {
    alert("이미지 URL을 올바른 http(s) 주소로 입력하세요.");
    return;
  }
  if (!Number.isFinite(power) || power <= 0) {
    alert("파워(power)는 1 이상의 숫자여야 합니다.");
    return;
  }
  if (size != null && !(Number.isFinite(size) && size > 0)) {
    alert("크기(size)가 있다면 1 이상의 숫자여야 합니다.");
    return;
  }

  // 버튼 잠금(중복 제출 방지)
  const submitBtn = form.querySelector('button[type="submit"]');
  const prevLabel = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "저장 중…";
  }

  try {
    const payload = {
      lat: clickedLatLng.lat,
      lon: clickedLatLng.lng,
      mid,
      pass,
      imagesURL: imageURL, // ← 지도에 표시할 아이콘 URL
      power,               // ← 전투에 사용할 파워(필수)
    };
    if (Number.isFinite(size)) payload.size = size; // 선택: 아이콘 픽셀 크기

    await addDoc(collection(db, "monsters"), payload);

    alert("몬스터 등록 완료!");

    // 폼/마커 리셋
    form.reset();
    if (currentMarker) {
      map.removeLayer(currentMarker);
      currentMarker = null;
    }
    clickedLatLng = null;
    const coordEl = $("coordText");
    if (coordEl) coordEl.textContent = "-";
  } catch (err) {
    console.error(err);
    alert("저장 중 오류가 발생했습니다. 콘솔을 확인하세요.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = prevLabel || "몬스터 등록";
    }
  }
});
