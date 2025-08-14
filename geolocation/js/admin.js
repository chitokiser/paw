// ./js/admin.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ===== Firebase ===== */
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

/* ===== 지도 기본 세팅 ===== */
const map = L.map('map', { maxZoom: 22 }).setView([37.5665, 126.9780], 15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom: 19,
  attribution:'&copy; OpenStreetMap'
}).addTo(map);

// Geocoder (검색 박스)
if (L.Control && L.Control.Geocoder) {
  L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: '장소 검색…'
  })
  .on('markgeocode', (e)=>{
    const bbox = e.geocode.bbox;
    const center = e.geocode.center;
    map.fitBounds(bbox);
    setSelected(center.lat, center.lng);
  })
  .addTo(map);
}

/* ===== 좌표 선택/마커 ===== */
let selected = { lat: null, lon: null };
let selMarker = null;
const coordText = document.getElementById('coordText');

function setSelected(lat, lon){
  selected.lat = lat;
  selected.lon = lon;
  coordText.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  if (!selMarker){
    selMarker = L.marker([lat, lon], { draggable:true }).addTo(map);
    selMarker.on('dragend', e=>{
      const ll = e.target.getLatLng();
      setSelected(ll.lat, ll.lng);
    });
  }else{
    selMarker.setLatLng([lat, lon]);
  }
}

map.on('click', (e)=> setSelected(e.latlng.lat, e.latlng.lng));

/* ===== 몬스터 등록 폼 핸들러 ===== */
const form = document.getElementById('monsterForm');
form.addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  if (selected.lat==null || selected.lon==null){
    alert('먼저 지도에서 좌표를 선택하세요.');
    return;
  }
  const imageURL = document.getElementById('imageURL').value.trim();
  const power    = Number(document.getElementById('power').value);
  const mid      = Number(document.getElementById('mid').value);
  const pass     = Number(document.getElementById('pass').value);
  const sizeRaw  = document.getElementById('size').value;
  const size     = sizeRaw ? Math.max(24, Math.min(Number(sizeRaw)||96, 256)) : 96;

  if (!imageURL || !power || !mid || !pass){
    alert('필수 항목을 확인하세요.');
    return;
  }

  try{
    await addDoc(collection(db, 'monsters'), {
      imagesURL: imageURL,
      lat: selected.lat,
      lon: selected.lon,
      mid,
      pass,
      power,
      size,
      createdAt: serverTimestamp()
    });
    alert('몬스터가 등록되었습니다!');
  }catch(err){
    console.error(err);
    alert('몬스터 등록 실패: ' + err.message);
  }
});

/* ===== 망루 설치 패널 주입 ===== */
(function injectTowerPanel(){
  const panel = document.createElement('div');
  panel.style.marginTop = '14px';
  panel.innerHTML = `
    <hr style="margin:16px 0; border:none; border-top:1px solid #eee">
    <h3 style="margin:0 0 8px; font-size:18px;">망루 설치</h3>
    <div class="row">
      <div>
        <label for="towerRange">사거리(m)</label>
        <input type="number" id="towerRange" placeholder="예: 60" min="10" value="60" />
        <div class="hint">유저가 이 반경 안으로 들어오면 자동 화살 공격(-1 GP/발)</div>
      </div>
      <div>
        <label for="towerPlaceBtn"> </label>
        <button id="towerPlaceBtn" type="button">현재 선택 좌표에 망루 설치</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const btn = panel.querySelector('#towerPlaceBtn');
  btn.addEventListener('click', async ()=>{
    if (selected.lat==null || selected.lon==null){
      alert('먼저 지도에서 좌표를 선택하세요.');
      return;
    }
    const range = Math.max(10, Number(panel.querySelector('#towerRange').value)||60);
    try{
      await addDoc(collection(db, 'towers'), {
        lat: selected.lat,
        lon: selected.lon,
        range,
        createdAt: serverTimestamp()
      });
      drawTowerPreview(selected.lat, selected.lon, range);
      alert('망루가 설치되었습니다!');
    }catch(err){
      console.error(err);
      alert('망루 설치 실패: ' + err.message);
    }
  });
})();

/* ===== 망루 미리보기를 지도에 그려 즉시 확인 ===== */
function towerIcon(){
  const html = `
    <div style="position:relative;width:48px;height:48px">
      <img src="https://puppi.netlify.app/images/mon/tower.png"
           style="width:100%;height:100%;object-fit:contain;display:block" alt="tower"/>
    </div>`;
  return L.divIcon({ className:'', html, iconSize:[48,48], iconAnchor:[24,48] });
}

function drawTowerPreview(lat, lon, range){
  const marker = L.marker([lat, lon], { icon: towerIcon(), interactive:false }).addTo(map);
  const circle = L.circle([lat, lon], {
    radius: range,
    color:'#ef4444', weight:1, fillColor:'#ef4444', fillOpacity:0.1
  }).addTo(map);
  // 2초 후 연한 표시 유지 (원하면 자동 제거 주석 해제)
  // setTimeout(()=>{ map.removeLayer(marker); map.removeLayer(circle); }, 4000);
}

/* ===== 초기 현재 위치 시도 (선택 편의) ===== */
if (navigator.geolocation){
  navigator.geolocation.getCurrentPosition(
    p=>{
      map.setView([p.coords.latitude, p.coords.longitude], 17);
      setSelected(p.coords.latitude, p.coords.longitude);
    },
    ()=>{}, {enableHighAccuracy:true, timeout:5000}
  );
}
