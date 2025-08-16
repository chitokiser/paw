// ./js/admin.js
console.log('[admin] script loaded');
window.addEventListener('DOMContentLoaded', ()=>console.log('[admin] DOM ready'));

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, setDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ====== 설정 ====== */
// TODO: 반드시 실제 배포 전에 안전하게 교체/환경변수화 하세요.
const ADMIN_PASS = "1234"; // 데모용
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
const geocoder = L.Control.geocoder({ defaultMarkGeocode: false })
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
  if (!pickMarker) {
    pickMarker = L.marker([lat, lon], { draggable: true }).addTo(map);
    pickMarker.on("dragend", () => {
      const p = pickMarker.getLatLng();
      setLatLon(p.lat, p.lng);
    });
  } else {
    pickMarker.setLatLng([lat, lon]);
  }
  const ct = document.getElementById("coordText");
  if (ct) ct.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
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

function tileFromLatLon(lat, lon, g = 0.01) {
  const fy = Math.floor(lat / g);
  const fx = Math.floor(lon / g);
  return `${fy}_${fx}`;
}

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
function toast(msg) { alert(msg); }

/* ====== 아이템/드랍 파서 ====== */
/** 텍스트 → 배열 파싱 (JSON 배열 또는 라인/CSV)
 *  - JSON: [{"id":"potion_small","name":"Small Potion","qty":2,"rarity":"common"}]
 *  - 라인/CSV: id|name|qty|rarity  또는  id,qty
 */
function parseItemArray(text) {
  const t = (text || "").trim();
  if (!t) return [];
  if (t.startsWith("[") && t.endsWith("]")) {
    try { const arr = JSON.parse(t); return Array.isArray(arr) ? sanitizeItems(arr) : []; }
    catch { return []; }
  }
  const lines = t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for (const ln of lines) {
    const raw = ln.includes("|") ? ln.split("|") : ln.split(",");
    const [id, name, qty, rarity] = raw.map(s=> (s||"").trim());
    if (!id) continue;
    out.push({ id, name: name || id, qty: qty ? Number(qty) : 1, rarity: (rarity || 'common').toLowerCase() });
  }
  return sanitizeItems(out);
}
function sanitizeItems(arr){
  return (arr||[])
    .map(it=>({
      id: String(it.id||"").trim(),
      name: String(it.name||it.id||"").trim(),
      qty: Math.max(1, Number(it.qty||1)),
      rarity: String((it.rarity||'common')).toLowerCase()
    }))
    .filter(it=>!!it.id);
}

/** lootTable 파서 (id|name|rarity|chance|min|max) */
function parseLootTable(text){
  const t = (text || "").trim();
  if (!t) return [];
  if (t.startsWith("[") && t.endsWith("]")) {
    try { const arr = JSON.parse(t); return Array.isArray(arr) ? sanitizeLoot(arr) : []; }
    catch { return []; }
  }
  const lines = t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for (const ln of lines) {
    const raw = ln.includes("|") ? ln.split("|") : ln.split(",");
    const [id, name, rarity, chance, min, max] = raw.map(s=> (s||"").trim());
    if (!id) continue;
    out.push({
      id,
      name: name || id,
      rarity: (rarity || 'common').toLowerCase(),
      chance: chance ? Number(chance) : undefined,
      min: min ? Number(min) : undefined,
      max: max ? Number(max) : undefined
    });
  }
  return sanitizeLoot(out);
}
function sanitizeLoot(arr){
  return (arr||[])
    .map(it=>({
      id: String(it.id||"").trim(),
      name: String(it.name||it.id||"").trim(),
      rarity: String((it.rarity||'common')).toLowerCase(),
      chance: (typeof it.chance === 'number') ? it.chance : undefined,
      min: Number.isFinite(it.min) ? Number(it.min) : undefined,
      max: Number.isFinite(it.max) ? Number(it.max) : undefined
    }))
    .filter(it=>!!it.id);
}

/** 첫 번째 아이템 ‘빨간약’ 보장 */
function ensureFirstIsRedPotion(items){
  const RED = { id:'red_potion', name:'빨간약', qty:1, rarity:'common' };
  const arr = Array.isArray(items) ? [...items] : [];
  const idx = arr.findIndex(it=>it.id==='red_potion' || it.name==='빨간약');
  if (idx === -1) return [RED, ...arr];
  const exist = arr[idx];
  const merged = { ...RED, qty: Math.max(1, Number(exist.qty||1)) };
  const rest = arr.filter((_,i)=>i!==idx).filter(it=>!(it.id==='red_potion'||it.name==='빨간약'));
  return [merged, ...rest];
}

/* ====== 드롭다운 피커: 카탈로그 ======
 * 필요에 따라 자유롭게 추가/수정
 */
const ITEM_CATALOG = [
  { id:'red_potion',   name:'빨간약',        rarity:'common',  hint:'+에너지 10' }, // 첫 아이템 권장
  { id:'potion_small', name:'Small Potion',  rarity:'common' },
  { id:'potion_mid',   name:'Medium Potion', rarity:'uncommon' },
  { id:'bone_fragment',name:'Bone Fragment', rarity:'common' },
  { id:'mystic_orb',   name:'Mystic Orb',    rarity:'rare' },
];

/* ====== 폼 UI에 드롭다운 섹션 주입 ====== */
const monsterForm = document.getElementById("monsterForm");
if (monsterForm) {
  // 1) items / loot 텍스트에어리어가 없다면 만들어 붙임
  let itemsTA = document.getElementById('m_items');
  if (!itemsTA) {
    itemsTA = document.createElement('textarea');
    itemsTA.id = 'm_items';
    itemsTA.placeholder = "아이템 라인 예) red_potion|빨간약|1|common";
    itemsTA.style.width = '100%'; itemsTA.rows = 4;
    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.innerHTML = '<h4>드롭 아이템(고정 지급)</h4>';
    wrap.appendChild(itemsTA);
    monsterForm.appendChild(wrap);
  }

  let lootTA = document.getElementById('m_loot');
  if (!lootTA) {
    lootTA = document.createElement('textarea');
    lootTA.id = 'm_loot';
    lootTA.placeholder = "루트 테이블 라인 예) mystic_orb|Mystic Orb|rare|0.1|1|1";
    lootTA.style.width = '100%'; lootTA.rows = 4;
    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.innerHTML = '<h4>루트 테이블(확률 지급)</h4>';
    wrap.appendChild(lootTA);
    monsterForm.appendChild(wrap);
  }

  // 2) 드롭다운 + 입력 + 추가버튼 UI 만들기
  const pickerCard = document.createElement('div');
  pickerCard.className = 'card';
  pickerCard.innerHTML = `
    <h4>드롭다운으로 선택 추가</h4>
    <div class="row">
      <div>
        <label>아이템 선택</label>
        <select id="itemSelect"></select>
      </div>
      <div>
        <label>수량(qty)</label>
        <input id="itemQty" type="number" value="1" min="1"/>
      </div>
    </div>
    <div class="row">
      <div>
        <label>희귀도(rarity)</label>
        <select id="itemRarity">
          <option value="common">common</option>
          <option value="uncommon">uncommon</option>
          <option value="rare">rare</option>
          <option value="epic">epic</option>
          <option value="legendary">legendary</option>
        </select>
      </div>
      <div>
        <button type="button" id="btnAddItem">아이템 추가 → 위 ‘드롭 아이템(고정)’에 누적</button>
      </div>
    </div>

    <hr style="margin:8px 0"/>

    <div class="row">
      <div>
        <label>루트(확률) 선택</label>
        <select id="lootSelect"></select>
      </div>
      <div>
        <label>확률(chance 0~1), min, max</label>
        <div style="display:flex; gap:6px;">
          <input id="lootChance" type="number" step="0.01" min="0" max="1" value="0.2" style="flex:1" />
          <input id="lootMin" type="number" min="1" value="1" style="flex:1" />
          <input id="lootMax" type="number" min="1" value="1" style="flex:1" />
        </div>
      </div>
    </div>
    <div class="row">
      <div>
        <label>희귀도(rarity)</label>
        <select id="lootRarity">
          <option value="common">common</option>
          <option value="uncommon">uncommon</option>
          <option value="rare" selected>rare</option>
          <option value="epic">epic</option>
          <option value="legendary">legendary</option>
        </select>
      </div>
      <div>
        <button type="button" id="btnAddLoot">루트 추가 → 위 ‘루트 테이블(확률)’에 누적</button>
      </div>
    </div>
    <div class="muted" style="margin-top:6px">
      • 아이템 라인 포맷: <code>id|name|qty|rarity</code><br/>
      • 루트 라인 포맷: <code>id|name|rarity|chance|min|max</code>
    </div>
  `;
  monsterForm.appendChild(pickerCard);

  // 3) 옵션 채우기
  const itemSel = pickerCard.querySelector('#itemSelect');
  const lootSel = pickerCard.querySelector('#lootSelect');
  ITEM_CATALOG.forEach(it=>{
    const o1 = document.createElement('option');
    o1.value = it.id; o1.textContent = `${it.name} (${it.id})${it.hint? ' - '+it.hint:''}`;
    itemSel.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = it.id; o2.textContent = `${it.name} (${it.id})`;
    lootSel.appendChild(o2);
  });

  // 4) 추가 버튼 로직
  pickerCard.querySelector('#btnAddItem').addEventListener('click', ()=>{
    const id = itemSel.value;
    const def = ITEM_CATALOG.find(x=>x.id===id);
    const qty = Math.max(1, Number(pickerCard.querySelector('#itemQty').value)||1);
    const rarity = String(pickerCard.querySelector('#itemRarity').value||def?.rarity||'common').toLowerCase();
    const name = def?.name || id;
    // 라인 포맷으로 누적
    const line = `${id}|${name}|${qty}|${rarity}`;
    itemsTA.value = (itemsTA.value.trim() ? itemsTA.value.trim()+'\n' : '') + line;
  });

  pickerCard.querySelector('#btnAddLoot').addEventListener('click', ()=>{
    const id = lootSel.value;
    const def = ITEM_CATALOG.find(x=>x.id===id);
    const chance = Number(pickerCard.querySelector('#lootChance').value);
    const min = Math.max(1, Number(pickerCard.querySelector('#lootMin').value)||1);
    const max = Math.max(min, Number(pickerCard.querySelector('#lootMax').value)||min);
    const rarity = String(pickerCard.querySelector('#lootRarity').value||def?.rarity||'rare').toLowerCase();
    const name = def?.name || id;
    const ch = Number.isFinite(chance) ? Math.max(0, Math.min(1, chance)) : 0.2;
    const line = `${id}|${name}|${rarity}|${ch}|${min}|${max}`;
    lootTA.value = (lootTA.value.trim() ? lootTA.value.trim()+'\n' : '') + line;
  });
}

/* ====== 몬스터 등록/수정 ====== */
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
    const range = valNum("m_range", null, 10);
    const damage = valNum("m_damage", null, 1);
    const cooldownMs = valNum("m_cooldown", null, 200);

    const itemsText = valStr("m_items", "");
    const lootText  = valStr("m_loot", "");

    if (lat == null || lon == null) { toast("지도를 클릭해 좌표를 선택하세요."); return; }

    let items = parseItemArray(itemsText);
    let lootTable = parseLootTable(lootText);
    items = ensureFirstIsRedPotion(items); // 첫 아이템 빨간약 보장

    // ✅ 타일 필드 필수
    const tile = tileFromLatLon(lat, lon);

    const payload = {
      lat, lon, tile,          // ← tile 추가
      imageURL,
      power,
      mid,
      ...(size ? { size } : {}),
      ...(range ? { range } : {}),
      ...(damage ? { damage } : {}),
      ...(cooldownMs ? { cooldownMs } : {}),
      items,
      lootTable,
      updatedAt: serverTimestamp()
    };

    const docId = valStr("m_docId", "");
    try {
      if (docId) {
        // 위치가 바뀌면 tile도 갱신되도록 merge
        await setDoc(doc(db, "monsters", docId), payload, { merge: true });
        toast(`몬스터 업데이트 완료 (doc: ${docId})`);
      } else {
        // ✅ 새 문서는 addDoc으로 생성 (runTransaction 제거)
        const ref = await addDoc(collection(db, "monsters"), {
          ...payload,
          createdAt: serverTimestamp()
        });
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

    const payload = { lat, lon, range, iconUrl, updatedAt: serverTimestamp() };

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
