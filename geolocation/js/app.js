import { db } from './firebase.js';
import {
  collection, query, where, onSnapshot, doc, runTransaction,
  serverTimestamp, getDocs, addDoc, limit, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { ensureAudio, playFail, playDeath, playAttackImpact } from './audio.js';
import { injectCSS, toast, ensureHUD, setHUD, addStartGate, mountCornerUI } from './ui.js';
import { DEFAULT_IMG, makeImageDivIcon, makePlayerDivIcon,
         getChallengeDurationMs, getGuestId, haversineM, isInRange, distanceToM, setFacingByLatLng } from './utils.js';

import { TowerGuard } from "./tower.js";
import { Score } from "./score.js";
import { WalkPoints } from "./walk.js";
import { MonsterGuard } from "./monster.js";
import { ensureImpactCSS, spawnImpactAt, spawnExplosionAt, shakeMap, attachHPBar } from './fx.js';
import { swingSwordAt, attackOnceToward } from './playerFx.js';
import DogCompanion from './dogCompanion.js';

import { createAttachMonsterBattle } from './battle.js';
import { RealTimeMonsters } from './monstersRT.js';
import { transferMonsterInventory } from './inventoryTransfer.js';
import { Inventory } from "./inventory.js";
import { InventoryUI } from "./inventoryUI.js";

injectCSS(); ensureImpactCSS();

let map, playerMarker;
let userLat = null, userLon = null;

/* ===== 공통: 타일 계산 ===== */
function _tileSizeDeg(){ return 0.01; }
function _tilesFromBounds(bounds, g = _tileSizeDeg()){
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
  const y0 = Math.floor(sw.lat/g), y1 = Math.floor(ne.lat/g);
  const x0 = Math.floor(sw.lng/g), x1 = Math.floor(ne.lng/g);
  const tiles = [];
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
  return tiles.slice(0, 10);
}

/* ======================================================================
 *                              TREASURES
 * ====================================================================== */
const _treasures = new Map(); // id -> { marker, hp:{set}, maxHits }
const TREASURE_MIN_ZOOM = 16; // 이 줌보다 낮으면 구독 해제(읽기 0)

function _makeTreasureIcon(size = 44, imageURL = 'https://puppi.netlify.app/images/event/tresure.png') {
  const s = Math.max(24, Number(size) || 44);
  const html = `
    <div class="mon-wrap" style="position:relative;width:${s}px;height:${s}px;">
      <img src="${imageURL}" alt="treasure" draggable="false"
           style="width:100%;height:100%;object-fit:contain;pointer-events:none;"/>
    </div>
  `;
  return L.divIcon({ className: '', html, iconSize: [s, s], iconAnchor: [s/2, s/2] });
}

/** 보물 1타 처리 (트랜잭션) + 0되면 보상 지급 */
async function _hitTreasure(docId, data){
  try{
    const ref = doc(db, 'treasures', docId);
    const res = await runTransaction(db, async (tx)=>{
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('notfound');
      const d = snap.data() || {};
      if (d.dead === true || d.alive === false) throw new Error('already');
      const power = Math.max(1, Number(d.power ?? 1));
      const left0 = Number.isFinite(d.hitsLeft) ? Number(d.hitsLeft) : power;
      const left = Math.max(0, left0 - 1);
      if (left <= 0){
        tx.update(ref, {
          hitsLeft: 0, alive: false, dead: true,
          claimedAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
      }else{
        tx.update(ref, { hitsLeft: left, updatedAt: serverTimestamp() });
      }
      return { left, power, d };
    });

    // 타격 이펙트
    try{ spawnImpactAt(map, data.lat, data.lon); playAttackImpact({ intensity: 0.7 }); shakeMap(); }catch{}
    const cache = _treasures.get(docId);
    if (cache?.hp) cache.hp.set(res.left);

    if (res.left <= 0){
      // ===== 보상 지급 =====
      const rewards = data.rewards || {};
      const items = rewards.items || data.items || []; // 호환: data.items 배열로 저장됐을 수도 있음
      const score = Number(rewards.score ?? data.score ?? 0);

      // 인벤토리 아이템 지급
      try {
        if (Array.isArray(items) && items.length){
          // transferMonsterInventory 형식: [{id,name,qty,rarity?}, ...]
          await transferMonsterInventory(db, getGuestId(), items.map(it=>({
            id: it.id, name: it.name || it.id, qty: Math.max(1, Number(it.qty||1)), rarity: it.rarity || 'common'
          })));
        }
      } catch(e){ console.warn('[treasure] grant items failed', e); }

      // GP 지급(Score.addGP 지원 시)
      try {
        if (score > 0 && typeof Score.addGP === 'function'){
          const pos = playerMarker?.getLatLng?.() || { lat:data.lat, lng:data.lon };
          await Score.addGP(score, pos.lat, pos.lng);
          toast(`보물 오픈! +${score} GP`);
        } else {
          toast('보물 오픈!');
        }
      } catch(e){ toast('보물 오픈! (GP 지급 실패)'); }

      // 마커 제거
      const mk = cache?.marker;
      if (mk){ try { map.removeLayer(mk); } catch{} }
      _treasures.delete(docId);
    }else{
      toast(`보물 타격! (남은 타격: ${res.left}/${res.power})`);
    }
  }catch(e){
    if (String(e?.message||'').includes('already')) toast('이미 미션을 완료하였습니다.');
    else { console.warn('[treasure] hit error', e); toast('타격 처리 중 문제가 발생했습니다.'); }
  }
}

/** 보물 마커 생성/갱신 */
function _upsertTreasureMarker(docId, data) {
  const { lat, lon, imageURL, size = 44, alive = true } = data || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || alive === false) {
    const cached = _treasures.get(docId);
    if (cached) { try { map.removeLayer(cached.marker); } catch {} _treasures.delete(docId); }
    return;
  }
  const icon = _makeTreasureIcon(size, imageURL);
  const cached = _treasures.get(docId);

  const power = Math.max(1, Number(data.power ?? 1));
  const left  = Number.isFinite(data.hitsLeft) ? Math.max(0, Number(data.hitsLeft)) : power;

  if (!cached) {
    const marker = L.marker([lat, lon], { icon, zIndexOffset: 10000 }).addTo(map);
    let hp = null; try { hp = attachHPBar(marker, power); hp.set(left); } catch {}
    marker.on('click', ()=>{
      try{
        const { lat: uLat, lng: uLng } = playerMarker?.getLatLng?.() ?? {};
        if (!Number.isFinite(uLat) || !Number.isFinite(uLng)) return;
        const distM = map.distance([lat, lon], [uLat, uLng]);
        if (distM > 12){ toast(`너무 멉니다. (${distM.toFixed(1)}m)`); return; }
      }catch{}
      _hitTreasure(docId, data);
    });
    _treasures.set(docId, { marker, hp, maxHits: power });
  } else {
    cached.marker.setLatLng([lat, lon]);
    cached.marker.setIcon(icon);
    if (cached.hp) cached.hp.set(left);
  }
}

let _unsubTreasures = null;
let _lastTileKey = '';

function _clearTreasureMarkers(){
  for (const { marker } of _treasures.values()) {
    try { map.removeLayer(marker); } catch {}
  }
  _treasures.clear();
}

function _watchTreasuresForViewport() {
  if (!map) return;

  // 줌 낮으면 구독 해제(읽기 0) + 마커 제거
  if (map.getZoom() < TREASURE_MIN_ZOOM) {
    if (_unsubTreasures) { try { _unsubTreasures(); } catch {} _unsubTreasures = null; }
    _lastTileKey = '';
    _clearTreasureMarkers();
    return;
  }

  const tiles = _tilesFromBounds(map.getBounds());
  if (!tiles.length) return;

  const key = tiles.join(',');
  if (key === _lastTileKey) return; // 동일 타일이면 재구독 생략
  _lastTileKey = key;

  if (_unsubTreasures) { try { _unsubTreasures(); } catch {} _unsubTreasures = null; }

  const baseCol = collection(db, 'treasures');
  const qy = query(
    baseCol,
    where('type', '==', 'treasure'),
    where('tile', 'in', tiles),
    limit(80)
  );
  console.log('[treasure] subscribe tiles:', tiles);

  _unsubTreasures = onSnapshot(qy, (snap) => {
    snap.docChanges().forEach((ch) => {
      const id = ch.doc.id;
      const data = ch.doc.data() || {};
      if (ch.type === 'removed') {
        const mk = _treasures.get(id)?.marker;
        if (mk) { try { map.removeLayer(mk); } catch {} _treasures.delete(id); }
        return;
      }
      _upsertTreasureMarker(id, data);
    });
  }, (err) => {
    console.warn('[treasure] onSnapshot error', err);
  });
}

/* ======================================================================
 *                                  SHOPS
 * ====================================================================== */
const _shopMarkers = new Map(); // id -> marker
let _unsubShops = null, _shopTilesKey = '';
const SHOP_MIN_ZOOM = 16;
const SHOP_TRADE_RANGE_M = 20; // ← 여기 숫자만 바꾸면 전체 상점 반경 변경

function _shopIcon(size=68, imageURL='https://puppi.netlify.app/images/event/shop.png'){
  const s = Math.max(24, Number(size)||68);
  const html = `<div class="mon-wrap" style="position:relative;width:${s}px;height:${s}px;">
    <img src="${imageURL}" alt="shop" style="width:100%;height:100%;object-fit:contain;pointer-events:none"/>
  </div>`;
  return L.divIcon({ className:'', html, iconSize:[s,s], iconAnchor:[s/2,s/2] });
}

function _openShopModalUI(shop, items, {onBuy, onSell, invSnapshot}){
  let wrap = document.getElementById('shopModal'); if (wrap) wrap.remove();
  wrap = document.createElement('div'); wrap.id='shopModal';
  Object.assign(wrap.style,{position:'fixed',inset:'0',background:'rgba(0,0,0,.35)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000,padding:'16px'});
  wrap.addEventListener('click', (e)=>{ if (e.target===wrap) wrap.remove(); });
  const card = document.createElement('div');
  Object.assign(card.style,{background:'#fff',border:'1px solid #e5e7eb',borderRadius:'16px',boxShadow:'0 20px 60px rgba(0,0,0,.25)',width:'min(560px,95vw)',maxHeight:'85vh',overflow:'auto',padding:'12px'});
  const title = document.createElement('div'); title.style.fontWeight='800'; title.style.fontSize='18px';
  title.textContent = shop?.name || '상점';
  card.appendChild(title);

  const tabs = document.createElement('div'); tabs.style.display='flex'; tabs.style.gap='6px'; tabs.style.margin='8px 0';
  const btnBuy = document.createElement('button'); btnBuy.textContent='구매'; Object.assign(btnBuy.style,{padding:'6px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'700'});
  const btnSell= document.createElement('button'); btnSell.textContent='판매'; Object.assign(btnSell.style,{padding:'6px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'700'});
  tabs.appendChild(btnBuy); tabs.appendChild(btnSell);
  card.appendChild(tabs);

  const body = document.createElement('div'); card.appendChild(body);

  function renderBuy(){
    body.innerHTML='';
    if (!items.length){ body.textContent='판매 중인 품목이 없습니다.'; return; }
    for (const it of items){
      if (it.active===false) continue;
      const row = document.createElement('div');
      Object.assign(row.style,{display:'grid',gridTemplateColumns:'64px 1fr auto',gap:'10px',alignItems:'center',borderBottom:'1px dashed #e5e7eb',padding:'8px 0'});
      const img = document.createElement('img'); img.src = it.iconURL || 'https://puppi.netlify.app/images/items/default.png';
      Object.assign(img.style,{width:'64px',height:'64px',objectFit:'contain'}); row.appendChild(img);
      const meta = document.createElement('div');
      meta.innerHTML = `<div style="font-weight:700">${it.name} <small style="color:#6b7280">(${it.itemId||it.id})</small></div>
        <div style="font-size:12px;color:#6b7280">
        ${it.weapon? `ATK ${it.weapon.baseAtk} · crit ${(it.weapon.baseAtk)}% · +ATK ${it.weapon.extraInit||0}` : (it.stackable? '소모품':'장비')}
        ${typeof it.stock==='number' ? ` · 재고 ${it.stock}` : ' · 재고 무한'}
        </div>`;
      row.appendChild(meta);
      const buy = document.createElement('button'); buy.textContent = `${it.buyPriceGP||0} GP`;
      Object.assign(buy.style,{background:'#111827',color:'#fff',border:'1px solid #e5e7eb',padding:'8px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'800'});
      buy.addEventListener('click', async ()=>{ buy.disabled=true; try{ await onBuy(it); wrap.remove(); } finally{ buy.disabled=false; } });
      row.appendChild(buy);
      body.appendChild(row);
    }
  }
  function renderSell(){
    body.innerHTML='';
    const sellables = items.filter(x=> (x.sellPriceGP||0)>0);
    const invRows = [];
    for (const it of sellables){
      const qty = invSnapshot?.[it.itemId||it.id] || 0;
      if (qty<=0) continue;
      invRows.push({it, qty});
    }
    if (!invRows.length){ body.textContent='판매 가능한 아이템이 없습니다.'; return; }

    for (const {it, qty} of invRows){
      const row = document.createElement('div');
      Object.assign(row.style,{display:'grid',gridTemplateColumns:'64px 1fr auto',gap:'10px',alignItems:'center',borderBottom:'1px dashed #e5e7eb',padding:'8px 0'});
      const img = document.createElement('img'); img.src = it.iconURL || 'https://puppi.netlify.app/images/items/default.png';
      Object.assign(img.style,{width:'64px',height:'64px',objectFit:'contain'}); row.appendChild(img);
      const meta = document.createElement('div');
      meta.innerHTML = `<div style="font-weight:700">${it.name} <small style="color:#6b7280">(${it.itemId||it.id})</small></div>
        <div style="font-size:12px;color:#6b7280">보유수량 ${qty} · 판매가 ${it.sellPriceGP} GP</div>`;
      row.appendChild(meta);
      const sell = document.createElement('button'); sell.textContent = `1개 판매`;
      Object.assign(sell.style,{background:'#fff',color:'#111827',border:'1px solid #e5e7eb',padding:'8px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'800'});
      sell.addEventListener('click', async ()=>{ sell.disabled=true; try{ await onSell(it,1); wrap.remove(); } finally{ sell.disabled=false; } });
      row.appendChild(sell);
      body.appendChild(row);
    }
  }

  const selectBuy = ()=>{ btnBuy.style.background='#111827'; btnBuy.style.color='#fff'; btnSell.style.background=''; btnSell.style.color=''; renderBuy(); };
  const selectSell= ()=>{ btnSell.style.background='#111827'; btnSell.style.color='#fff'; btnBuy.style.background=''; btnBuy.style.color=''; renderSell(); };

  btnBuy.addEventListener('click', selectBuy);
  btnSell.addEventListener('click', selectSell);
  selectBuy();

  const close = document.createElement('button'); close.textContent='닫기';
  Object.assign(close.style,{marginTop:'8px',padding:'8px 12px',borderRadius:'8px',cursor:'pointer'});
  close.addEventListener('click', ()=>wrap.remove());
  card.appendChild(close);

  wrap.appendChild(card); document.body.appendChild(wrap);
}

function _watchShopsForViewport({onOpen}){
  if (!map) return;
  if (map.getZoom() < SHOP_MIN_ZOOM){
    if (_unsubShops){ try{ _unsubShops(); }catch{} _unsubShops=null; }
    _shopTilesKey='';
    for (const m of _shopMarkers.values()){ try{ map.removeLayer(m); }catch{} }
    _shopMarkers.clear();
    return;
  }
  const tiles = _tilesFromBounds(map.getBounds());
  if (!tiles.length) return;
  const key = tiles.join(',');
  if (key === _shopTilesKey) return;
  _shopTilesKey = key;

  if (_unsubShops){ try{ _unsubShops(); }catch{} _unsubShops=null; }

  const qy = query(
    collection(db,'shops'),
    where('active','==', true),
    where('tile','in', tiles)
  );
  _unsubShops = onSnapshot(qy, (snap)=>{
    snap.docChanges().forEach(ch=>{
      const id = ch.doc.id;
      if (ch.type==='removed'){
        const m=_shopMarkers.get(id); if (m){ try{ map.removeLayer(m); }catch{} _shopMarkers.delete(id); }
        return;
      }
      const data = ch.doc.data()||{};
      const {lat, lon, imageURL, size=48, active=true, name='상점'} = data;
      if (!Number.isFinite(lat)||!Number.isFinite(lon)||!active) {
        const m=_shopMarkers.get(id); if (m){ try{ map.removeLayer(m); }catch{} _shopMarkers.delete(id); }
        return;
      }
      const icon = _shopIcon(size, imageURL);
      let mk = _shopMarkers.get(id);
      if (!mk){
        mk = L.marker([lat, lon], { icon, zIndexOffset:9000 }).addTo(map);
        mk.on('click', ()=> onOpen({id, ...data}));
        _shopMarkers.set(id, mk);
      }else{
        mk.setLatLng([lat,lon]); mk.setIcon(icon);
      }
      mk.options.title = name;
    });
  }, (err)=>console.warn('[shops] onSnapshot error', err));
}

function _attachShopUI({inv}){
  // 인벤토리 스냅샷(판매 탭 표시용)
  let invSnapshot = {};
  try{
    const origOnChange = inv.onChange;
    inv.onChange = (items)=>{
      // items => 맵형 또는 배열 모두 수용
      const snap = {};
      if (Array.isArray(items)) {
        items.forEach(it=>{ if (it?.id) snap[it.id] = (snap[it.id]||0) + (Number(it.qty)||0); });
      } else {
        Object.entries(items||{}).forEach(([k,v])=>{ snap[k] = Number(v?.qty||0); });
      }
      invSnapshot = snap;
      try{ origOnChange?.(items); }catch{}
    };
  }catch{}

  async function loadShopItems(shopId){
    const snap = await getDocs(collection(db, `shops/${shopId}/items`));
    const out=[]; snap.forEach(d=> out.push({ id:d.id, ...d.data() }));
    return out;
  }

  async function buyItem(shop, item){
    // 재고 관리
    if (typeof item.stock==='number'){
      const ref = doc(db, `shops/${shop.id}/items`, item.id);
      await runTransaction(db, async (tx)=>{
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error('gone');
        const d = s.data();
        if (d.active===false) throw new Error('inactive');
        const cur = Number(d.stock||0);
        if (cur<=0) throw new Error('soldout');
        tx.update(ref, { stock: cur-1, updatedAt: serverTimestamp() });
      });
    }
    // 결제(GP 차감) → 인벤토리 지급
    const price = Number(item.buyPriceGP||0);
    const pos = playerMarker?.getLatLng?.() || { lat:0, lng:0 };
    try { await Score.deductGP(price, pos.lat, pos.lng); } catch(e){ toast('GP가 부족하거나 결제 실패'); throw e; }
    try {
      await transferMonsterInventory(db, getGuestId(), [{
        id:item.itemId||item.id, name:item.name, qty:1, rarity: item.weapon? 'rare':'common'
      }]);
    } catch(e){ console.warn('[shop] grant fail', e); }
    toast('구매 완료! 인벤토리를 확인하세요.');
  }

  async function sellItem(shop, item, qty){
    // 인벤토리 차감
    try { await inv.dropItem(item.itemId||item.id, qty); }
    catch(e){ toast('인벤토리 차감 실패'); throw e; }

    // 상점 재고 증가(선택)
    if (typeof item.stock==='number'){
      const ref = doc(db, `shops/${shop.id}/items`, item.id);
      try { await updateDoc(ref, { stock: increment(qty), updatedAt: serverTimestamp() }); } catch(e){ /* optional */ }
    }

    // GP 지급
    const reward = Number(item.sellPriceGP||0) * qty;
    const pos = playerMarker?.getLatLng?.() || { lat:0, lng:0 };
    try {
      if (typeof Score.addGP === 'function') await Score.addGP(reward, pos.lat, pos.lng);
      else toast(`+${reward} GP (임시)`);
    } catch(e){ console.warn('[shop] addGP fail', e); }
    toast('판매 완료!');
  }

  _watchShopsForViewport({
    onOpen: async (shop)=>{
      try{
        const items = await loadShopItems(shop.id);
        _openShopModalUI(shop, items, {
          onBuy: (it)=>buyItem(shop, it),
          onSell: (it, q)=>sellItem(shop, it, q),
          invSnapshot
        });
      }catch(e){
        console.warn('[shop] open fail', e);
        toast('상점 로드 실패');
      }
    }
  });
  map.on('moveend', ()=>_watchShopsForViewport({ onOpen: ()=>{} }));
}

/* ======================================================================
 *                                MAIN
 * ====================================================================== */
async function main(){
  // Score/HUD
  await Score.init({ db, getGuestId, toast, playFail });
  Score.attachToHUD(ensureHUD());
  setHUD({ chain: Score.getChainTotal() });
  Score.updateEnergyUI();
  Score.wireRespawn();

  // Inventory UI
  const guestId = getGuestId();
  const inv = new Inventory({ db, guestId, onChange: (items)=>console.log('inv change', items) });
  const invUI = new InventoryUI({
    inventory: inv,
    toast: (m)=>console.log('[toast]', m),
    onUseItem: async (id)=>{ await inv.useItem(id, 1); },
    onDropItem: async (id)=>{ await inv.dropItem(id, 1); },
  });
  try { await inv.load({ autoListen: true }); await invUI.mount(); console.log('[InventoryUI] mounted'); } catch (e) { console.error('[InventoryUI] failed to mount/load:', e); }

  // Map
  map = L.map('map',{maxZoom:22}).setView([37.5665,126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  // Geolocation
  await new Promise((res)=>{
    if (!navigator.geolocation){ res(); return; }
    navigator.geolocation.getCurrentPosition(
      p=>{ userLat=p.coords.latitude; userLon=p.coords.longitude; res(); },
      ()=>res(), {enableHighAccuracy:true, timeout:7000}
    );
  });
  if (userLat==null){ userLat=37.5665; userLon=126.9780; }

  // Player
  playerMarker = L.marker([userLat,userLon],{ icon: makePlayerDivIcon('../images/user/1.png',38) }).addTo(map);
  map.setView([userLat,userLon], 19);

  // 코너 UI(줌/홈/인벤토리/HUD 위치 등)
  try { if (typeof mountCornerUI === 'function') mountCornerUI({ map, playerMarker, invUI }); } catch {}

  // Dog
  const dog = new DogCompanion({
    map, lat:userLat, lon:userLon,
    dogUrl:'../images/user/dog.png', dogSize:26, offsetM:0.5,
    barkUrl:'../sounds/puppybark.mp3', barkVolume:0.9
  });
  map.on('click', (e)=>{
    try{ setFacingByLatLng(map, playerMarker, e.latlng, 'right'); }catch{};
    try{
      const { lat: uLat, lng: uLng } = playerMarker?.getLatLng?.() ?? { lat:userLat, lng:userLon };
      dog.setFacingByTarget(uLat, uLng, e.latlng.lat, e.latlng.lng);
    }catch{};
  });

  // Walk path + HUD distance
  const walkPath = L.polyline([[userLat,userLon]], { weight:3, opacity:0.9 }).addTo(map);
  let lastLat=userLat, lastLon=userLon;
  let totalWalkedM = Number(localStorage.getItem('ui_total_walk_m')||0);
  setHUD({ distanceM: totalWalkedM });

  if (navigator.geolocation){
    navigator.geolocation.watchPosition(p=>{
      userLat=p.coords.latitude; userLon=p.coords.longitude;
      playerMarker.setLatLng([userLat, userLon]);
      dog.update(userLat, userLon);
      walkPath.addLatLng([userLat,userLon]);
      if (Number.isFinite(lastLat)&&Number.isFinite(lastLon)){
        const seg = haversineM(lastLat,lastLon,userLat,userLon);
        if (seg>=0.5){ totalWalkedM+=seg; localStorage.setItem('ui_total_walk_m', String(totalWalkedM)); setHUD({ distanceM: totalWalkedM }); }
      }
      lastLat=userLat; lastLon=userLon;
    },()=>{}, {enableHighAccuracy:true});
  }

  // Flash on hit
  const flashPlayer = ()=>{
    const el = playerMarker.getElement(); if (!el) return;
    el.classList.remove('player-hit'); void el.offsetWidth; el.classList.add('player-hit');
  };

  // Towers auto attack
  const towers = new TowerGuard({
    map, db,
    iconUrl:"https://puppi.netlify.app/images/mon/tower.png",
    rangeDefault:60, fireCooldownMs:1500,
    getUserLatLng: ()=> {
      const {lat, lng} = playerMarker.getLatLng();
      return [lat, lng];
    },
    onUserHit: (damage)=>{
      const { lat, lng } = playerMarker.getLatLng();
      try { flashPlayer(); } catch {}
      try { Score.deductGP(damage, lat, lng); } catch {}
      try { spawnExplosionAt(map, lat, lng, { size: 180, hue: 0 }); } catch {}
      try { playAttackImpact({ intensity: 1.0 }); shakeMap(); } catch {}
    }
  });
  towers.setUserReady(true);

  // Real-time monsters
  const monstersGuard = new MonsterGuard({
    map, db,
    rangeDefault:50, fireCooldownMs:1800,
    getUserLatLng: ()=>{
      try { const {lat,lng}=playerMarker.getLatLng(); return [lat,lng]; }
      catch { return [userLat,userLon]; }
    },
    onUserHit:(damage, mon)=>{
      flashPlayer();
      Score.deductGP(damage, mon.lat, mon.lon);
      try {
        const { lat: uLat, lng: uLng } = playerMarker.getLatLng();
        spawnExplosionAt(map, uLat, uLng, { size: 95, hue: 0, crit: false });
        shakeMap();
        playAttackImpact({ intensity: 1.0 });
      } catch {}
    },
    useTiles: false
  });

  const attachMonsterBattle = createAttachMonsterBattle({
    db, map, playerMarker, dog, Score, toast,
    ensureAudio, isInRange, distanceToM, setFacingByLatLng,
    swingSwordAt, attackOnceToward, spawnImpactAt, spawnExplosionAt, shakeMap, playAttackImpact, playFail, playDeath,
    attachHPBar, getChallengeDurationMs, transferMonsterInventory, getGuestId,
    monstersGuard, setHUD
  });

  const rtMon = new RealTimeMonsters({
    db, map,
    makeImageDivIcon, DEFAULT_IMG,
    attachMonsterBattle,
    monstersGuard
  });
  rtMon.start();
  monstersGuard.setUserReady?.(true);
  monstersGuard.start?.();

  // 첫 입력에서 오디오/타이머 재개
  window.addEventListener('pointerdown', () => {
    try { ensureAudio(); } catch {}
    try { towers.resumeAudio?.(); } catch {}
    try { monstersGuard.resumeAudio?.(); } catch {}
    try { towers.start?.(); } catch {}
    try { monstersGuard.start?.(); } catch {}
  }, { once:true, passive:true });

  // 시작 게이트
  addStartGate(()=>{
    try { ensureAudio(); } catch {}
    try { towers.setUserReady?.(true); } catch {}
    try { monstersGuard.setUserReady?.(true); } catch {}
  });

  // 보물 구독 시작
  _watchTreasuresForViewport();
  map.on('moveend', _watchTreasuresForViewport);

  // 상점 UI 부착 및 구독
  _attachShopUI({ inv });

  // 디버깅용
  window.__hit = ()=> attackOnceToward(map, playerMarker, playerMarker.getLatLng().lat + 0.00001, playerMarker.getLatLng().lng);
  window.__guardsDebug = () => {
    try { towers.tickOnce?.(); } catch {}
    try { monstersGuard.tickOnce?.(); } catch {}
  };
}

main();
