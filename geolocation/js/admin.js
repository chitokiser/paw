// ./js/admin.js
console.log('[admin] script loaded');
window.addEventListener('DOMContentLoaded', ()=>console.log('[admin] DOM ready'));

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, setDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ====== 설정 ====== */
// TODO: 실제 배포 전 환경변수/서버사이드로 안전하게!
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
export { db };

/* ====== 지도 ====== */
const map = L.map("map", { maxZoom: 22 }).setView([21.0285, 105.8542], 16);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

// Geocoder (leaflet-control-geocoder 플러그인 필요)
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

  // 몬스터/타워 좌표
  setInputValue("m_lat", lat);
  setInputValue("m_lon", lon);
  setInputValue("t_lat", lat);
  setInputValue("t_lon", lon);

  // 보물박스 좌표
  setInputValue("tr_lat", lat);
  setInputValue("tr_lon", lon);
  // 상점 좌표
  setInputValue("shop_lat", lat);
  setInputValue("shop_lon", lon);
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
/** 텍스트 → 배열 파싱 (JSON 배열 또는 라인/CSV) */
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

/** 첫 번째 아이템 ‘빨간약’ 보장 (몬스터 전용) */
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

/* ====== 드롭다운 피커: 카탈로그 ====== */
const ITEM_CATALOG = [
  { id:'red_potion',   name:'빨간약',        rarity:'common',  hint:'+에너지 10' },
  { id:'potion_small', name:'Small Potion',  rarity:'common' },
  { id:'potion_mid',   name:'Medium Potion', rarity:'uncommon' },
  { id:'bone_fragment',name:'Bone Fragment', rarity:'common' },
  { id:'mystic_orb',   name:'Mystic Orb',    rarity:'rare' },
];

/* ====== 폼 UI에 드롭다운 섹션 주입 (몬스터) ====== */
const monsterForm = document.getElementById("monsterForm");
if (monsterForm) {
  // items textarea 보장
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

  // loot textarea 보장
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

  // 드롭다운 UI
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

  // 옵션 채우기
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

  // 추가 버튼
  pickerCard.querySelector('#btnAddItem').addEventListener('click', ()=>{
    const id = itemSel.value;
    const def = ITEM_CATALOG.find(x=>x.id===id);
    const qty = Math.max(1, Number(pickerCard.querySelector('#itemQty').value)||1);
    const rarity = String(pickerCard.querySelector('#itemRarity').value||def?.rarity||'common').toLowerCase();
    const name = def?.name || id;
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
  // 몬스터 ID 입력 시 이미지 URL 자동 변경
  const midInput = document.getElementById('mid');
  const monImg   = document.getElementById('imageURL');
  if (midInput && monImg) {
    const applyImg = ()=> {
      const id = String(midInput.value||'').trim();
      if (!id) return;
      monImg.value = `https://puppi.netlify.app/images/mon/${encodeURIComponent(id)}.png`;
    };
    ['input','change','blur','keyup'].forEach(ev => midInput.addEventListener(ev, applyImg));
  }

  monsterForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!checkPass("m_pass")) { toast("관리 비밀번호가 올바르지 않습니다."); return; }

    const lat = valNum("m_lat");
    const lon = valNum("m_lon");
    const imageURL = valStr("imageURL", "https://puppi.netlify.app/images/mon/1.png");
    const power = valNum("power", 20, 1);
    const mid = valNum("mid", 0, 0);
    const size = valNum("size", 96, 24);
    const range = valNum("m_range", null, 10);
    const damage = valNum("m_damage", null, 1);
    const cooldownMs = valNum("m_cooldown", null, 200);
    const animId = valNum("m_animId", null); // HTML에 m_animId 있으면 저장

    const itemsText = valStr("m_items", "");
    const lootText  = valStr("m_loot", "");

    if (lat == null || lon == null) { toast("지도를 클릭해 좌표를 선택하세요."); return; }

    let items = parseItemArray(itemsText);
    let lootTable = parseLootTable(lootText);
    items = ensureFirstIsRedPotion(items);

    const tile = tileFromLatLon(lat, lon);

    const payload = {
      lat, lon, tile,
      imageURL,
      power,
      mid,
      ...(size ? { size } : {}),
      ...(range ? { range } : {}),
      ...(damage ? { damage } : {}),
      ...(cooldownMs ? { cooldownMs } : {}),
      ...(animId ? { animId } : {}),
      items,
      lootTable,
      updatedAt: serverTimestamp()
    };

    const docId = valStr("m_docId", "");
    try {
      if (docId) {
        await setDoc(doc(db, "monsters", docId), payload, { merge: true });
        toast(`몬스터 업데이트 완료 (doc: ${docId})`);
      } else {
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

/* ====== 보물박스 등록/수정 (monsters 컬렉션, type:'treasure') ======
 * HTML 요구 id:
 *  - tr_lat, tr_lon, tr_img, tr_power, tr_items, tr_loot, tr_cooldown, tr_docId, tr_pass
 *  - (선택) tr_add_item, tr_item_id, tr_item_qty, tr_animId
 *  Note: 보물 박스도 몬스터와 동일 스키마(items|lootTable|cooldownMs) 사용
 */
function parseTreasureItems(text){
  const t = (text||'').trim();
  if (!t) return [];
  const lines = t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for (const ln of lines){
    const raw = ln.includes('|') ? ln.split('|') : ln.split(',');
    const [id, name, qty] = raw.map(s=>(s||'').trim());
    if (!id) continue;
    out.push({ id, name: name || id, qty: Math.max(1, Number(qty||1)) });
  }
  return out;
}

// 아이템 추가 버튼(있을 때만 동작)
(function bindTreasureAddItem(){
  const addBtn = document.getElementById('tr_add_item');
  if (!addBtn) return;
  addBtn.addEventListener('click', ()=>{
    const id  = (document.getElementById('tr_item_id')?.value || '').trim();
    const qty = Math.max(1, Number(document.getElementById('tr_item_qty')?.value || 1));
    if (!id){ alert('아이템 ID를 입력하세요.'); return; }
    const name = id;
    const ta = document.getElementById('tr_items');
    const line = `${id}|${name}|${qty}`;
    ta.value = (ta.value.trim() ? ta.value.trim()+'\n' : '') + line;
    const idEl = document.getElementById('tr_item_id');
    const qtyEl = document.getElementById('tr_item_qty');
    if (idEl) idEl.value = '';
    if (qtyEl) qtyEl.value = '1';
  });
})();

const treasureForm = document.getElementById('treasureForm');
if (treasureForm){
  // 입력 필드 수정 가능 보장
  document.getElementById('tr_img')?.removeAttribute('readonly');
  document.getElementById('tr_power')?.removeAttribute('readonly');

  treasureForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    try{
      if (!checkPass('tr_pass')) { toast('관리 비밀번호가 올바르지 않습니다.'); return; }

      const lat = valNum('tr_lat');
      const lon = valNum('tr_lon');
      if (lat == null || lon == null){ toast('지도를 클릭해 좌표를 선택하세요.'); return; }

      const imageURL   = valStr('tr_img', 'https://puppi.netlify.app/images/event/treasure.png');
      let items        = parseTreasureItems(valStr('tr_items',''));
           items  = ensureFirstIsRedPotion(items); // 🔴 보물도 빨간약 보장
      const lootTable  = parseLootTable(valStr('tr_loot',''));
      const power      = valNum('tr_power', 20, 1);
      const cooldownMs = valNum('tr_cooldown', 2000, 0);
      const animId     = valNum('tr_animId', null);

      const base = {
        type: 'treasure',
        lat, lon, tile: tileFromLatLon(lat, lon),
        imageURL,
        size: 44,
        power,
        cooldownMs,
        items,
        ...(lootTable && lootTable.length ? { lootTable } : {}),
        ...(animId ? { animId } : {}),
        updatedAt: serverTimestamp()
      };

      const docId = valStr('tr_docId','').trim();
      if (docId){
        await setDoc(doc(db, 'monsters', docId), base, { merge:true });
        toast(`보물박스 업데이트 완료 (monsters/${docId})`);
      }else{
        const newId = `TR-${base.tile}-${Date.now().toString(36)}`;
        await setDoc(doc(db, 'monsters', newId), {
          ...base,
          createdAt: serverTimestamp()
        }, { merge:true });
        setInputValue('tr_docId', newId);
        toast(`보물박스 등록 완료 (monsters/${newId})`);
      }

      const out = document.getElementById('tr_out');
      if (out) out.textContent = JSON.stringify(base, null, 2);

    }catch(err){
      console.warn('[admin] treasure submit error', err);
      toast('보물박스 등록/수정 중 오류가 발생했습니다.');
      const out = document.getElementById('tr_out'); if (out) out.textContent = String(err);
    }
  });
}

/* ===== 상점 저장 (shops) ===== */
const shopForm = document.getElementById('shopForm');
if (shopForm){
  shopForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    try{
      if (!checkPass('shop_pass')) { toast('관리 비밀번호가 올바르지 않습니다.'); return; }
      const lat = valNum('shop_lat'); const lon = valNum('shop_lon');
      if (lat==null || lon==null){ toast('좌표를 지정하세요.'); return; }
      const name   = valStr('shop_name','상점');
      const imageURL = valStr('shop_img','https://puppi.netlify.app/images/event/shop.png');
      const size   = valNum('shop_size', 48, 24);
      const active = (valStr('shop_active','true')==='true');
      const tile   = tileFromLatLon(lat, lon);
      const docId  = valStr('shop_docId','').trim();

      const payload = {
        type:'shop',
        name, imageURL, size, active,
        lat, lon, tile,
        updatedAt: serverTimestamp()
      };

      if (docId){
        await setDoc(doc(db,'shops',docId), payload, { merge:true });
        toast(`상점 업데이트 완료 (doc: ${docId})`);
      }else{
        const newId = `SHOP-${tile}-${Date.now().toString(36)}`;
        await setDoc(doc(db,'shops', newId), { ...payload, createdAt: serverTimestamp() }, { merge:true });
        setInputValue('shop_docId', newId);
        toast(`상점 생성 완료 (doc: ${newId})`);
      }

      const out = document.getElementById('shop_out');
      if (out) out.textContent = JSON.stringify(payload, null, 2);
    }catch(err){
      console.warn('[admin] shop save error', err);
      toast('상점 저장 중 오류');
    }
  });
}

/* ===== 상점 아이템 저장 (shops/{shopId}/items) ===== */
const shopItemForm = document.getElementById('shopItemForm');
if (shopItemForm){
  shopItemForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    try{
      if (!checkPass('si_pass')) { toast('관리 비밀번호가 올바르지 않습니다.'); return; }
      const shopId = valStr('si_shopId','').trim();
      if (!shopId){ toast('상점 문서ID를 입력하세요.'); return; }

      const itemId   = valStr('si_itemId','').trim().toLowerCase();
      const name     = valStr('si_name', itemId || 'item');
      const iconURL  = valStr('si_icon','');
      const stackable= (valStr('si_stack','true')==='true');
      const buyPriceGP  = valNum('si_buy', 0, 0);
      const sellPriceGP = valNum('si_sell', 0, 0);
      const stockRaw = valStr('si_stock','').trim();
      const stock    = stockRaw ? Math.max(0, Number(stockRaw)) : null; // null=무한
      const active   = (valStr('si_active','true')==='true');
      const baseAtk  = valNum('si_baseAtk', 0, 0);
      const extraInit= valNum('si_extraInit', 0, 0);

      const itemDocId = valStr('si_itemDocId','').trim() || itemId || `item-${Date.now().toString(36)}`;

      const payload = {
        type:'shopItem',
        itemId, name, iconURL: iconURL || null,
        stackable, active,
        buyPriceGP, sellPriceGP,
        stock: stock,            // null=무한
        weapon: (baseAtk>0 || extraInit>0) ? { baseAtk, extraInit } : null,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, `shops/${shopId}/items`, itemDocId), {
        ...payload,
        createdAt: serverTimestamp()
      }, { merge:true });

      toast(`상점 아이템 저장 완료 (shop:${shopId} / item:${itemDocId})`);
      const out = document.getElementById('si_out');
      if (out) out.textContent = JSON.stringify({shopId, itemDocId, ...payload}, null, 2);
    }catch(err){
      console.warn('[admin] shop item save error', err);
      toast('상점 아이템 저장 중 오류');
    }
  });

  // 기본 두 개(빨간약, 장검) 시드 버튼
  document.getElementById('seed_shop_items')?.addEventListener('click', async ()=>{
    try{
      if (!checkPass('si_pass')) { toast('관리 비밀번호가 올바르지 않습니다.'); return; }
      const shopId = valStr('si_shopId','').trim(); if (!shopId){ toast('상점 문서ID 먼저 입력'); return; }
      const batch = [
        {
          id: 'red_potion',
          name: '빨간약',
          iconURL: 'https://puppi.netlify.app/images/items/red_potion.png',
          buyPriceGP: 50, sellPriceGP: 25, stackable:true, stock:null, active:true
        },
        {
          id: 'long_sword',
          name: '장검',
          iconURL: 'https://puppi.netlify.app/images/items/long_sword.png',
          buyPriceGP: 500, sellPriceGP: 250, stackable:false, stock:10, active:true,
          weapon:{ baseAtk:10, extraInit:0 }
        }
      ];
      for (const it of batch){
        await setDoc(doc(db, `shops/${shopId}/items`, it.id), {
          type:'shopItem', itemId: it.id, name: it.name,
          iconURL: it.iconURL, stackable: it.stackable, active: it.active,
          buyPriceGP: it.buyPriceGP, sellPriceGP: it.sellPriceGP,
          stock: it.stock, weapon: it.weapon || null,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        }, { merge:true });
      }
      toast('기본 2개(빨간약/장검) 등록 완료');
    }catch(err){
      console.warn('[admin] seed items error', err);
      toast('시드 등록 실패');
    }
  });
}

/* ====== 초기 좌표 세팅 (현재 위치 시도) ====== */
(async function initPosition(){
  try {
    await new Promise(res=>{
      if (!navigator.geolocation){ res(); return; }
      navigator.geolocation.getCurrentPosition(
        p=>{
          setLatLon(p.coords.latitude, p.coords.longitude);
          map.setView([p.coords.latitude, p.coords.longitude], 18);
          res();
        },
        ()=>res(), { enableHighAccuracy:true, timeout:6000 }
      );
    });
  } catch {}
})();
