// ./js/admin.js — 관리자 도구(최종) : admin:true 자동주입 + 디버깅 로그 + 한방배포 + 이미지/애니 생략
console.log('[admin] script loaded');
window.addEventListener('DOMContentLoaded', ()=>console.log('[admin] DOM ready'));

import { db } from './firebase.js';
import {
  collection, addDoc, setDoc, doc, serverTimestamp, writeBatch, setLogLevel
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* =========================
 * DEBUG 토글 (?debug 또는 localStorage.pawAdminDebug='1')
 * ========================= */
const DEBUG = (()=>{ try{
  return new URLSearchParams(location.search).has('debug') ||
         localStorage.getItem('pawAdminDebug')==='1';
}catch{} return false; })();
if (DEBUG) setLogLevel('debug');

/* =========================
 * 설정/정책
 * ========================= */
const ADMIN_PASS = '1234';
const SUBMIT_RATE_LIMIT_MS = 1200;
const TILE_GRID_DEG = 0.01;

/* 작은 로거 유틸 */
function log(...a){ try{ console.log('[admin]', ...a); }catch{} }
function setOut(id, data){
  try{
    const el = document.getElementById(id);
    if (!el) { log(`(#${id} 없음)`, data); return; }
    el.textContent = (typeof data==='string') ? data : JSON.stringify(data,null,2);
  }catch(e){ log('setOut error', e); }
}
function toast(m){ alert(m); log(m); }

/* =========================
 * 지도(실패해도 계속)
 * ========================= */
let map = null;
let pickMarker = null;
try {
  const mapEl = document.getElementById('map');
  if (mapEl && window.L) {
    map = L.map('map', { maxZoom: 22 }).setView([21.0285, 105.8542], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    try {
      L.Control.geocoder?.({ defaultMarkGeocode:false })
        ?.on('markgeocode', (e)=>{ const c=e.geocode.center; map.setView(c,18); setLatLon(c.lat,c.lng); })
        ?.addTo(map);
    } catch {}
    map.on('click', (e)=> setLatLon(e.latlng.lat, e.latlng.lng));
  } else {
    log('#map 없음 또는 Leaflet 미로딩 → 지도 스킵');
  }
} catch (e) {
  log('지도 초기화 실패(무시):', e);
}

let _setLLTid = null;
function setLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  try {
    if (map) {
      if (!pickMarker) {
        pickMarker = L.marker([lat, lon], { draggable:true }).addTo(map);
        pickMarker.on('dragend', ()=>{ const p=pickMarker.getLatLng(); setLatLon(p.lat,p.lng); });
      } else {
        pickMarker.setLatLng([lat, lon]);
      }
    }
  } catch {}
  const ct = document.getElementById('coordText'); if (ct) ct.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

  if (_setLLTid) clearTimeout(_setLLTid);
  _setLLTid = setTimeout(()=>{
    setInputValue('m_lat', lat);  setInputValue('m_lon', lon);
    setInputValue('t_lat', lat);  setInputValue('t_lon', lon);
    setInputValue('tr_lat', lat); setInputValue('tr_lon', lon);
    setInputValue('shop_lat', lat); setInputValue('shop_lon', lon);
  }, 40);
}
function setInputValue(id, v){ const el=document.getElementById(id); if(el) el.value=String(v); }

/* =========================
 * 유틸
 * ========================= */
function tileFromLatLon(lat, lon, g=TILE_GRID_DEG) {
  const fy = Math.floor(lat / g);
  const fx = Math.floor(lon / g);
  return `${fy}_${fx}`;
}
const clamp = (n, lo, hi)=>Math.max(lo, Math.min(hi, n));
const numOr = (v, d)=> (Number.isFinite(+v) ? +v : d);
function boolFromStr(s, d=true){
  if (s==null || s==='') return d;
  const t=String(s).trim().toLowerCase();
  if (['true','1','y','yes','on'].includes(t)) return true;
  if (['false','0','n','no','off'].includes(t)) return false;
  return d;
}
function valNum(id, def=null, min=null){ const el=document.getElementById(id); if(!el) return def; const n=Number(el.value); if(!Number.isFinite(n)) return def; return (min!=null?Math.max(min,n):n); }
function valStr(id, def=''){ const el=document.getElementById(id); const s=(el?.value??'').trim(); return s||def; }
function checkPass(id){ const pass=valStr(id,''); return pass && pass===ADMIN_PASS; }

let _lastSubmitAt=0;
function canSubmitNow(){ const now=Date.now(); if(now-_lastSubmitAt<SUBMIT_RATE_LIMIT_MS) return false; _lastSubmitAt=now; return true; }

/* admin:true 자동 주입 */
function addAdmin(obj){ return { admin: true, ...obj }; }

/* =========================
 * 드랍/루트 파서
 * ========================= */
function sanitizeItems(arr){
  return (arr||[]).map(it=>({
    id:String(it.id||'').trim().toLowerCase(),
    name:String(it.name||it.id||'').trim(),
    qty:Math.max(1, Number(it.qty||1)),
    rarity:String(it.rarity||'common').toLowerCase()
  })).filter(it=>!!it.id);
}
function parseItemArray(text){
  const t=(text||'').trim(); if(!t) return [];
  if (t.startsWith('[')&&t.endsWith(']')){ try{ const arr=JSON.parse(t); return Array.isArray(arr)?sanitizeItems(arr):[]; }catch{return [];} }
  const out=[]; for (const ln of t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)){
    const [id,name,qty,rarity]=(ln.includes('|')?ln.split('|'):ln.split(',')).map(s=>(s||'').trim());
    if(!id) continue; out.push({id,name:name||id,qty:qty?Number(qty):1,rarity:(rarity||'common').toLowerCase()});
  } return sanitizeItems(out);
}
function sanitizeLoot(arr){
  return (arr||[]).map(it=>({
    id:String(it.id||'').trim().toLowerCase(),
    name:String(it.name||it.id||'').trim(),
    rarity:String(it.rarity||'common').toLowerCase(),
    chance:(typeof it.chance==='number')?clamp(it.chance,0,1):undefined,
    min:Number.isFinite(it.min)?Math.max(1,Math.floor(it.min)):undefined,
    max:Number.isFinite(it.max)?Math.max(1,Math.floor(it.max)):undefined
  })).filter(it=>!!it.id);
}
function parseLootTable(text){
  const t=(text||'').trim(); if(!t) return [];
  if (t.startsWith('[')&&t.endsWith(']')){ try{ const arr=JSON.parse(t); return Array.isArray(arr)?sanitizeLoot(arr):[]; }catch{return [];} }
  const out=[]; for (const ln of t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)){
    const [id,name,rarity,chance,min,max]=(ln.includes('|')?ln.split('|'):ln.split(',')).map(s=>(s||'').trim());
    if(!id) continue; out.push({id,name:name||id,rarity:(rarity||'common').toLowerCase(),
      chance: chance?Number(chance):undefined, min: min?Number(min):undefined, max: max?Number(max):undefined});
  } return sanitizeLoot(out);
}
function ensureFirstIsRedPotion(items){
  const RED={id:'red_potion',name:'빨간약',qty:1,rarity:'common'};
  const arr=Array.isArray(items)?[...items]:[];
  const idx=arr.findIndex(it=>it.id==='red_potion'||it.name==='빨간약');
  if(idx===-1) return [RED,...arr];
  const exist=arr[idx]; const merged={...RED, qty: Math.max(1, Number(exist.qty||1))};
  const rest=arr.filter((_,i)=>i!==idx).filter(it=>!(it.id==='red_potion'||it.name==='빨간약'));
  return [merged,...rest];
}

/* =========================
 * 드롭다운 카탈로그
 * ========================= */
const ITEM_CATALOG=[
  { id:'red_potion', name:'빨간약', rarity:'common', hint:'+에너지 10' },
  { id:'potion_small', name:'Small Potion', rarity:'common' },
  { id:'potion_mid', name:'Medium Potion', rarity:'uncommon' },
  { id:'bone_fragment', name:'Bone Fragment', rarity:'common' },
  { id:'mystic_orb', name:'Mystic Orb', rarity:'rare' },
  { id:'majestic_ball', name:'마제스틱 볼', rarity:'epic' },
  { id:'lightning_summon', name:'벼락 소환 부적', rarity:'epic' },
  { id:'longsword_iron', name:'철 장검', rarity:'uncommon' },
];

/* =========================
 * 몬스터 폼(애니/이미지 생략, 데미지 자동계산) — HTML 내 요소만 바인딩
 * ========================= */
(function setupMonsterForm(){
  const form = document.getElementById('monsterForm');
  if (!form) return;

  const itemsTA     = document.getElementById('m_items');
  const lootTA      = document.getElementById('m_loot');

  const itemSel     = document.getElementById('itemSelect');
  const itemQty     = document.getElementById('itemQty');
  const itemRarity  = document.getElementById('itemRarity');
  const btnAddItem  = document.getElementById('btnAddItem');

  const lootSel     = document.getElementById('lootSelect');
  const lootChance  = document.getElementById('lootChance');
  const lootMin     = document.getElementById('lootMin');
  const lootMax     = document.getElementById('lootMax');
  const lootRarity  = document.getElementById('lootRarity');
  const btnAddLoot  = document.getElementById('btnAddLoot');

  // 드롭다운 옵션 채우기(비어 있을 때만)
  if (itemSel && itemSel.options.length === 0) {
    ITEM_CATALOG.forEach(it=>{
      const o = document.createElement('option');
      o.value = it.id;
      o.textContent = `${it.name} (${it.id})${it.hint? ' - '+it.hint:''}`;
      itemSel.appendChild(o);
    });
  }
  if (lootSel && lootSel.options.length === 0) {
    ITEM_CATALOG.forEach(it=>{
      const o = document.createElement('option');
      o.value = it.id;
      o.textContent = `${it.name} (${it.id})`;
      lootSel.appendChild(o);
    });
  }

  if (btnAddItem) btnAddItem.addEventListener('click', ()=>{
    if (!itemsTA || !itemSel) return;
    const id     = itemSel.value;
    const def    = ITEM_CATALOG.find(x=>x.id===id);
    const qty    = Math.max(1, Number(itemQty?.value || 1));
    const rarity = String(itemRarity?.value || def?.rarity || 'common').toLowerCase();
    const name   = def?.name || id;
    const line   = `${id}|${name}|${qty}|${rarity}`;
    itemsTA.value = (itemsTA.value.trim() ? itemsTA.value.trim()+'\n' : '') + line;
  });

  if (btnAddLoot) btnAddLoot.addEventListener('click', ()=>{
    if (!lootTA || !lootSel) return;
    const id     = lootSel.value;
    const def    = ITEM_CATALOG.find(x=>x.id===id);
    const chance = Number(lootChance?.value);
    const min    = Math.max(1, Number(lootMin?.value || 1));
    const max    = Math.max(min, Number(lootMax?.value || min));
    const rarity = String(lootRarity?.value || def?.rarity || 'rare').toLowerCase();
    const name   = def?.name || id;
    const ch     = Number.isFinite(chance) ? clamp(chance,0,1) : 0.2;
    const line   = `${id}|${name}|${rarity}|${ch}|${min}|${max}`;
    lootTA.value = (lootTA.value.trim() ? lootTA.value.trim()+'\n' : '') + line;
  });

  // 제출(이미지/애니 생략, 데미지 자동계산) + admin:true
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if (!canSubmitNow()) { return toast('조금만 천천히…'); }
    if (!checkPass('m_pass')) { return toast('관리 비밀번호가 올바르지 않습니다.'); }

    const lat = valNum('m_lat'); const lon = valNum('m_lon');
    if (lat==null || lon==null){ return toast('좌표를 지정하세요.'); }

    const mid        = numOr(valNum('mid', 1, 1), 1);
    const size       = clamp(numOr(valNum('size', 96, 24), 96), 24, 256);
    const range      = clamp(numOr(valNum('m_range', 50, 10), 50), 10, 500);
    const cooldownMs = clamp(numOr(valNum('m_cooldown', 2000, 0), 2000), 0, 3600000);

    const damage = (Math.max(1, Number(mid||1)) * 50) + 100;

    let items     = ensureFirstIsRedPotion(parseItemArray(valStr('m_items','')));
    let lootTable = parseLootTable(valStr('m_loot',''));

    const payload = addAdmin({
      lat, lon, tile: tileFromLatLon(lat, lon),
      mid, size, range, cooldownMs,
      damage,
      ...(items?.length ? { items } : {}),
      ...(lootTable?.length ? { lootTable } : {}),
      updatedAt: serverTimestamp()
    });

    const docId = valStr('m_docId','').trim();
    try{
      if (docId){
        await setDoc(doc(db,'monsters',docId), payload, { merge:true });
        console.info('[monster/save]', { docId, ...payload });
        toast(`몬스터 업데이트 완료 (doc: ${docId})`);
      } else {
        const ref = await addDoc(collection(db,'monsters'), { ...payload, createdAt: serverTimestamp() });
        setInputValue('m_docId', ref.id);
        console.info('[monster/save]', { docId: ref.id, ...payload });
        toast(`몬스터 등록 완료 (doc: ${ref.id})`);
      }
    }catch(err){
      console.error('[admin] monster submit error', err);
      if (err?.code === 'permission-denied') {
        console.warn('→ payload에 admin:true 포함 여부와 Firestore 규칙 배포 상태를 확인하세요.');
      }
      toast('몬스터 저장 중 오류');
    }
  });
})();

/* =========================
 * 망루 / 보물박스 / 상점 (로그 + admin:true)
 * ========================= */
(function setupTower(){
  const form=document.getElementById('towerForm'); if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if (!canSubmitNow()) { return toast('조금만 천천히…'); }
    if (!checkPass('t_pass')) { return toast('관리 비밀번호가 올바르지 않습니다.'); }
    const lat=valNum('t_lat'); const lon=valNum('t_lon'); if(lat==null||lon==null){ return toast('좌표를 지정하세요.'); }
    const range=clamp(numOr(valNum('t_range', 60, 10), 60), 10, 500);
    const iconUrl=valStr('t_icon','https://puppi.netlify.app/images/mon/tower.png');
    const payload=addAdmin({ lat,lon,range,iconUrl,tile:tileFromLatLon(lat,lon),updatedAt:serverTimestamp() });
    const docId=valStr('t_docId','').trim();
    try{
      if (docId) await setDoc(doc(db,'towers',docId), payload, { merge:true });
      else await addDoc(collection(db,'towers'), { ...payload, createdAt: serverTimestamp() });
      console.info('[tower/save]', { docId: docId||'(new)', ...payload });
      toast(`망루 저장 완료`);
    }catch(err){ console.error('[admin] tower submit error', err); toast('망루 저장 오류'); }
  });
})();
(function setupTreasure(){
  function parseTreasureItems(text){
    const t=(text||'').trim(); if(!t) return [];
    const out=[]; for (const ln of t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)){
      const [id,name,qty]=(ln.includes('|')?ln.split('|'):ln.split(',')).map(s=>(s||'').trim());
      if(!id) continue; out.push({ id, name: name||id, qty: Math.max(1, Number(qty||1)) });
    } return sanitizeItems(out);
  }
  document.getElementById('tr_add_item')?.addEventListener('click', ()=>{
    const id=(document.getElementById('tr_item_id')?.value||'').trim().toLowerCase();
    const qty=Math.max(1, Number(document.getElementById('tr_item_qty')?.value||1));
    if(!id) return alert('아이템 ID를 입력하세요.');
    const ta=document.getElementById('tr_items'); const line=`${id}|${id}|${qty}`;
    ta.value=(ta.value.trim()?ta.value.trim()+'\n':'')+line;
    document.getElementById('tr_item_id').value=''; document.getElementById('tr_item_qty').value='1';
  });
  const form=document.getElementById('treasureForm'); if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if (!canSubmitNow()) { return toast('조금만 천천히…'); }
    if (!checkPass('tr_pass')) { return toast('관리 비밀번호가 올바르지 않습니다.'); }
    const lat=valNum('tr_lat'); const lon=valNum('tr_lon'); if(lat==null||lon==null){ return toast('좌표를 지정하세요.'); }
    const imageURL=valStr('tr_img','https://puppi.netlify.app/images/event/treasure.png');
    const power=clamp(numOr(valNum('tr_power',20,1),20),1,1e6);
    const cooldownMs=clamp(numOr(valNum('tr_cooldown',2000,0),2000),0,3600000);
    const animIdRaw=valStr('tr_animId','').trim(); const animId=animIdRaw?animIdRaw:undefined;
    const items=parseTreasureItems(valStr('tr_items','')); const lootTable=parseLootTable(valStr('tr_loot',''));
    const base=addAdmin({
      type:'treasure', lat,lon, tile:tileFromLatLon(lat,lon), imageURL, size:44, power, cooldownMs,
      ...(items?.length?{items}:{}) , ...(lootTable?.length?{lootTable}:{}) , ...(animId?{animId}:{}), updatedAt: serverTimestamp()
    });
    const docId=valStr('tr_docId','').trim();
    try{
      if (docId) await setDoc(doc(db,'monsters',docId), base, { merge:true });
      else {
        const newId=`TR-${base.tile}-${Date.now().toString(36)}`;
        await setDoc(doc(db,'monsters',newId), { ...base, createdAt: serverTimestamp() }, { merge:true });
        setInputValue('tr_docId', newId);
      }
      setOut('tr_out', base);
      console.info('[treasure/save]', { docId: docId||'(new)', ...base });
      toast('보물박스 저장 완료');
    }catch(err){ console.error('[admin] treasure submit error', err); toast('보물 저장 오류'); }
  });
})();
(function setupShop(){
  const form=document.getElementById('shopForm'); if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if (!canSubmitNow()) { return toast('조금만 천천히…'); }
    if (!checkPass('shop_pass')) { return toast('관리 비밀번호가 올바르지 않습니다.'); }
    const lat=valNum('shop_lat'); const lon=valNum('shop_lon'); if(lat==null||lon==null){ return toast('좌표를 지정하세요.'); }
    const name=valStr('shop_name','상점'); const imageURL=valStr('shop_img','https://puppi.netlify.app/images/event/shop.png');
    const size=clamp(numOr(valNum('shop_size',48,24),48),24,256);
    const active=boolFromStr(valStr('shop_active','true'),true);
    const payload=addAdmin({ type:'shop', name, imageURL, size, active, lat, lon, tile:tileFromLatLon(lat,lon), updatedAt: serverTimestamp() });
    const docId=valStr('shop_docId','').trim();
    try{
      if (docId) await setDoc(doc(db,'shops',docId), payload, { merge:true });
      else {
        const newId=`SHOP-${payload.tile}-${Date.now().toString(36)}`;
        await setDoc(doc(db,'shops',newId), { ...payload, createdAt: serverTimestamp() }, { merge:true });
        setInputValue('shop_docId', newId);
      }
      setOut('shop_out', payload);
      console.info('[shop/save]', { docId: docId||'(new)', ...payload });
      toast('상점 저장 완료');
    }catch(err){ console.error('[admin] shop save error', err); toast('상점 저장 오류'); }
  });
})();

(function setupShopItems(){
  const form=document.getElementById('shopItemForm'); if(!form) return;

  const itemSel = document.getElementById('si_itemId');
  const iconInput = document.getElementById('si_icon');

  if (itemSel && itemSel.options.length === 0) {
    ITEM_CATALOG.forEach(it=>{
      const o = document.createElement('option');
      o.value = it.id;
      o.textContent = `${it.name} (${it.id})${it.hint? ' - '+it.hint:''}`;
      itemSel.appendChild(o);
    });

    // 아이템 선택 시 아이콘 URL 자동 완성
    itemSel.addEventListener('change', () => {
      if (iconInput) {
        const selectedItemId = itemSel.value;
        if (selectedItemId === 'majestic_ball') {
          iconInput.value = '../images/items/majestic.png';
        } else {
          iconInput.value = `../images/items/${selectedItemId}.png`;
        }
      }
    });
    // 초기값 설정
    if (iconInput) {
      const initialSelectedItemId = itemSel.value;
      if (initialSelectedItemId === 'majestic_ball') {
        iconInput.value = '../images/items/majestic.png';
      } else {
        iconInput.value = `../images/items/${initialSelectedItemId}.png`;
      }
    }
  }

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if (!canSubmitNow()) { return toast('조금만 천천히…'); }
    if (!checkPass('si_pass')) { return toast('관리 비밀번호가 올바르지 않습니다.'); }

    const shopId = valStr('si_shop_docId');
    if (!shopId) { return toast('상점 문서ID를 입력하세요.'); }

    const itemId = valStr('si_itemId');
    if (!itemId) { return toast('아이템 ID를 입력하세요.'); }

    const itemData = ITEM_CATALOG.find(it => it.id === itemId) || { name: itemId };

    const payload = addAdmin({
      name: itemData.name,
      buyPriceCP: valNum('si_price', 10, 0),
      stock: valNum('si_stock', null),
      iconURL: valStr('si_icon', '../images/items/default.png'),
      updatedAt: serverTimestamp()
    });

    try {
      await setDoc(doc(db, `shops/${shopId}/items`, itemId), payload, { merge: true });
      setOut('shop_item_out', payload);
      console.info('[shop/item/save]', { shopId, itemId, ...payload });
      toast('상점 아이템 저장 완료');
    } catch(err) {
      console.error('[admin] shop item save error', err);
      toast('상점 아이템 저장 오류');
    }
  });
})();

/* =========================
 * 초기 위치 시도(실패해도 무시)
 * ========================= */
(async function initPosition(){
  try {
    await new Promise(res=>{
      if (!navigator.geolocation) return res();
      navigator.geolocation.getCurrentPosition(
        p=>{ setLatLon(p.coords.latitude, p.coords.longitude); map?.setView([p.coords.latitude, p.coords.longitude], 18); res(); },
        ()=>res(), { enableHighAccuracy:true, timeout:6000 }
      );
    });
  } catch {}
})();

/* =========================================================
 * 한방 배포 — writeBatch 1회, 이미지/애니 생략, 데미지 자동계산, admin:true
 * ========================================================= */
function _metersToDeg(lat, dx, dy) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(lat * Math.PI/180);
  return { dLat: dy / mPerDegLat, dLon: dx / mPerDegLon };
}
function _randPointInRadius(lat, lon, radiusM) {
  const r = radiusM * Math.sqrt(Math.random()), t = Math.random()*Math.PI*2;
  const dx = r*Math.cos(t), dy = r*Math.sin(t);
  const { dLat, dLon }=_metersToDeg(lat,dx,dy); return [lat+dLat, lon+dLon];
}
function _offsetBy(lat, lon, distM, bearingRad) {
  const dx=Math.cos(bearingRad)*distM, dy=Math.sin(bearingRad)*distM;
  const { dLat, dLon }=_metersToDeg(lat,dx,dy); return [lat+dLat, lon+dLon];
}
function _makeTag4(){ return Math.random().toString(36).slice(2,6).toUpperCase(); }

function _getCenterLatLon(){
  try{ if(pickMarker){ const p=pickMarker.getLatLng(); if(Number.isFinite(p.lat)&&Number.isFinite(p.lng)) return [p.lat,p.lng]; } }catch{}
  let lat=valNum('m_lat'); let lon=valNum('m_lon');
  lat = lat ?? valNum('t_lat') ?? valNum('tr_lat') ?? valNum('shop_lat');
  lon = lon ?? valNum('t_lon') ?? valNum('tr_lon') ?? valNum('shop_lon');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    try{ const c = map?.getCenter?.(); if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) return [c.lat, c.lng]; }catch{}
    return [21.0285, 105.8542];
  }
  return [lat, lon];
}

async function bulkDeployAtCenter({
  radiusM=50, monsters=10, towerRange=60, monsterSize=48, monsterCooldownMs=2000, tag4=_makeTag4()
}={}){
  const t0 = performance.now();
  log('bulkDeploy start', { radiusM, monsters, towerRange, monsterSize, monsterCooldownMs, tag4 });
  try{
    if (!canSubmitNow()) { toast('조금만 천천히…'); return; }

    // 비번 검사: 하나라도 맞으면 통과
    const passIds = ['bulk_pass','m_pass','t_pass','tr_pass','shop_pass'];
    const anyField = passIds.some(id=>document.getElementById(id));
    const passOK = passIds.some(id=>checkPass(id));
    if (anyField && !passOK) { toast('관리 비밀번호가 올바르지 않습니다.'); return; }

    const [cLat,cLon] = _getCenterLatLon() || [];
    if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) { toast('좌표 지정 후 시도'); return; }
    if (!db) { toast('Firestore DB 초기화 실패: firebase.js 확인'); return; }

    const batch=writeBatch(db);
    const ts=Date.now().toString(36);
    const nowFields={ createdAt: serverTimestamp(), updatedAt: serverTimestamp() };

    const ops = []; const monsterRows = []; const towerRows = []; let shopRow=null;

    // 몬스터 10
    for (let i=1;i<=monsters;i++){
      const [lat,lon]=_randPointInRadius(cLat,cLon,radiusM);
      const tile=tileFromLatLon(lat,lon);
      const id=`${tag4}-MON-${String(i).padStart(2,'0')}-${ts}`;
      const mid=((i-1)%10)+1;
      const damage=(mid*50)+100;
      const payload = addAdmin({ tag4, lat,lon,tile, mid, size:monsterSize, range:50, cooldownMs:monsterCooldownMs, damage, ...nowFields });
      batch.set(doc(db,'monsters',id), payload, { merge:true });
      ops.push({ col:'monsters', id, payload });
      monsterRows.push({ id, mid, damage, lat: +lat.toFixed(6), lon: +lon.toFixed(6), tile });
    }

    // 타워 4
    [0, Math.PI/2, Math.PI, 3*Math.PI/2].forEach((b,idx)=>{
      const [lat,lon]=_offsetBy(cLat,cLon,radiusM,b);
      const id = `${tag4}-TWR-${idx+1}-${ts}`;
      const payload = addAdmin({ tag4, lat,lon,tile:tileFromLatLon(lat,lon), range:towerRange,
        iconUrl:'https://puppi.netlify.app/images/mon/tower.png', ...nowFields });
      batch.set(doc(db,'towers',id), payload, { merge:true });
      ops.push({ col:'towers', id, payload });
      towerRows.push({ id, range: towerRange, lat: +lat.toFixed(6), lon: +lon.toFixed(6), tile: payload.tile });
    });

    // 상점 1
    const shopId = `${tag4}-SHOP-${ts}`;
    const shopPayload = addAdmin({
      tag4, type:'shop', name:`상점 (${tag4})`, imageURL:'https://puppi.netlify.app/images/event/shop.png',
      size:48, active:true, lat:cLat, lon:cLon, tile:tileFromLatLon(cLat,cLon), ...nowFields
    });
    batch.set(doc(db,'shops',shopId), shopPayload, { merge:true });
    ops.push({ col:'shops', id: shopId, payload: shopPayload });
    shopRow = { id: shopId, name: shopPayload.name, lat: +cLat.toFixed(6), lon: +cLon.toFixed(6), tile: shopPayload.tile };

    await batch.commit();
    const dt = performance.now() - t0;

    console.groupCollapsed(`[bulk] ✅ COMMIT OK tag=${tag4} (Δ${dt.toFixed(0)}ms)`);
    console.info('[center]', { lat: cLat, lon: cLon, tile: tileFromLatLon(cLat,cLon), radiusM });
    console.info('[counts]', { monsters: monsterRows.length, towers: towerRows.length, shops: 1, totalOps: ops.length });
    console.groupCollapsed('[monsters]'); console.table(monsterRows); console.groupEnd();
    console.groupCollapsed('[towers]');   console.table(towerRows);   console.groupEnd();
    console.groupCollapsed('[shop]');     console.table([shopRow]);   console.groupEnd();
    console.groupCollapsed('[ops payloads]'); console.log(ops); console.groupEnd();
    console.groupEnd();

    setOut('bulk_out', {
      tag4,
      center: { lat: +cLat.toFixed(6), lon: +cLon.toFixed(6), tile: tileFromLatLon(cLat,cLon) },
      radiusM,
      monsters: monsterRows.map(r=>({ id:r.id, mid:r.mid, damage:r.damage })),
      towers: towerRows.map(r=>({ id:r.id })),
      shop: shopRow
    });
    toast(`한방 배포 완료! [${tag4}]`);
  }catch(err){
    console.group(`[bulk] ❌ COMMIT FAIL tag=${tag4}`); console.error(err);
    console.info('code:', err?.code, 'message:', err?.message);
    if (err?.code === 'permission-denied') {
      console.warn('→ payload admin:true 포함/규칙 배포 상태 확인');
    }
    console.groupEnd();
    toast(`배포 중 오류: ${err?.code||'unknown'}`);
  }
}

// 우상단 고정 버튼(무조건 보이게)
function ensureBulkButton(){
  let btn=document.getElementById('btnBulkDeploy');
  if(!btn){
    btn=document.createElement('button');
    btn.id='btnBulkDeploy'; btn.type='button'; btn.textContent='한방 배포(몬10+타4+상1)';
    Object.assign(btn.style,{
      position:'fixed',right:'16px',top:'16px',zIndex:2147483647,
      background:'#111827',color:'#fff',border:'none',borderRadius:'12px',
      padding:'10px 14px',fontWeight:'800',boxShadow:'0 12px 36px rgba(0,0,0,.25)',cursor:'pointer'
    });
    document.body.appendChild(btn);
  }
  if (!btn.dataset.binded){
    btn.addEventListener('click', async (ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      log('bulk button clicked');
      try{
        await bulkDeployAtCenter({ radiusM:50, monsters:10, towerRange:60, monsterSize:48, monsterCooldownMs:2000 });
      }catch(err){
        console.error('[admin] click->bulkDeploy error', err);
        toast(`클릭 처리 중 오류: ${err?.message||err}`);
      }
    });
    btn.dataset.binded = '1';
  }
  // 전역에서 호출 가능하게 (예: 콘솔에서 adminBulkDeploy({monsters:20}))
  window.adminBulkDeploy=(opts)=>bulkDeployAtCenter(opts||{});
}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', ensureBulkButton); }
else { ensureBulkButton(); }

/* 끝 */
