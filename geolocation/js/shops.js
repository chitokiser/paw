// /geolocation/js/shops.js
// 상점 구독/마커/모달 UI/거래 (CP 통화 전용, Firestore 트랜잭션 폴백 포함)
import {
  collection, query, where, onSnapshot, doc, runTransaction,
  serverTimestamp, getDocs, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { auth, db as _db } from './firebase.js'; // uid 폴백용 (Score 미구현 대비)

/* ---------------- 유틸 ---------------- */
function _tileSizeDeg(){ return 0.01; }
function _tilesFromBounds(bounds, g = _tileSizeDeg()){
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
  const y0 = Math.floor(sw.lat/g), y1 = Math.floor(ne.lat/g);
  const x0 = Math.floor(sw.lng/g), x1 = Math.floor(ne.lng/g);
  const tiles = [];
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
  return tiles.slice(0, 10);
}

function _shopIcon(size=68, imageURL='https://puppi.netlify.app/images/event/shop.png'){
  const s = Math.max(24, Number(size)||68);
  const html = `<div class="mon-wrap" style="position:relative;width:${s}px;height:${s}px;">
    <img src="${imageURL}" alt="shop" style="width:100%;height:100%;object-fit:contain;pointer-events:none"/>
  </div>`;
  return L.divIcon({ className:'', html, iconSize:[s,s], iconAnchor:[s/2,s/2] });
}

/** 🔁 가격은 CP 우선, 기존 GP 필드는 폴백으로만 사용 */
function _getBuyPrice(it){
  const b = Number(
    it.buyPriceCP ?? it.priceCP ??
    it.buyPriceGP ?? it.priceGP ??
    it.sellPriceCP ?? it.sellPriceGP ?? 0
  );
  return Math.max(0, b|0);
}

/* ---------------- 상점 모달 ---------------- */
function _openShopModalUI(shop, items, {onBuy, onSell, invSnapshot}){
  let wrap = document.getElementById('shopModal'); if (wrap) wrap.remove();
  wrap = document.createElement('div'); wrap.id='shopModal';
  Object.assign(wrap.style,{position:'fixed',inset:'0',background:'rgba(0,0,0,.35)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000,padding:'16px'});
  wrap.addEventListener('click', (e)=>{ if (e.target===wrap) wrap.remove(); });

  const card = document.createElement('div');
  Object.assign(card.style,{background:'#fff',border:'1px solid #e5e7eb',borderRadius:'16px',boxShadow:'0 20px 60px rgba(0,0,0,.25)',width:'min(560px,95vw)',maxHeight:'85vh',overflow:'auto',padding:'12px'});

  const title = document.createElement('div');
  title.style.fontWeight='800'; title.style.fontSize='18px';
  title.textContent = shop?.name || '상점';
  card.appendChild(title);

  const tabs = document.createElement('div'); tabs.style.display='flex'; tabs.style.gap='6px'; tabs.style.margin='8px 0';
  const btnBuy = document.createElement('button'); btnBuy.textContent='구매';
  const btnSell= document.createElement('button'); btnSell.textContent='판매';
  Object.assign(btnBuy.style,{padding:'6px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'700'});
  Object.assign(btnSell.style,{padding:'6px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'700'});
  tabs.appendChild(btnBuy); tabs.appendChild(btnSell); card.appendChild(tabs);

  const body = document.createElement('div'); card.appendChild(body);

  /* --- 구매탭 --- */
  function renderBuy(){
    body.innerHTML='';
    if (!items.length){ body.textContent='판매 중인 품목이 없습니다.'; return; }

    for (const it of items){
      if (it.active===false) continue;
      const row = document.createElement('div');
      Object.assign(row.style,{display:'grid',gridTemplateColumns:'64px 1fr auto auto',gap:'10px',alignItems:'center',borderBottom:'1px dashed #e5e7eb',padding:'8px 0'});

      const img = document.createElement('img');
      img.src = it.iconURL || 'https://puppi.netlify.app/images/items/default.png';
      Object.assign(img.style,{width:'64px',height:'64px',objectFit:'contain'});
      row.appendChild(img);

      const meta = document.createElement('div');
      const price = _getBuyPrice(it);
      meta.innerHTML = `<div style="font-weight:700">${it.name} <small style="color:#6b7280">(${it.itemId||it.id})</small></div>
        <div style="font-size:12px;color:#6b7280">
          ${it.weapon? `ATK ${it.weapon.baseAtk} · +CRIT ${(it.weapon.crit??0)}% · +ATK ${(it.weapon.extraInit??0)}` : (it.stackable? '소모품':'장비')}
          ${typeof it.stock==='number' ? ` · 재고 ${it.stock}` : ' · 재고 무한'}
        </div>`;
      row.appendChild(meta);

      const qtySelect = document.createElement('select');
      const maxQty = 10;
      for (let q=1; q<=maxQty; q++){
        const opt = document.createElement('option');
        opt.value = q; opt.textContent = `${q}개`;
        qtySelect.appendChild(opt);
      }
      row.appendChild(qtySelect);

      const buyBtn = document.createElement('button');
      buyBtn.textContent = `${price} CP`;
      Object.assign(buyBtn.style,{background:'#111827',color:'#fff',border:'1px solid #e5e7eb',padding:'8px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'800'});
      buyBtn.addEventListener('click', async ()=>{
        buyBtn.disabled=true;
        try{
          const qty = parseInt(qtySelect.value)||1;
          await onBuy(it, qty, price);
          wrap.remove();
        } finally{ buyBtn.disabled=false; }
      });
      row.appendChild(buyBtn);

      body.appendChild(row);
    }
  }

  /* --- 판매탭 --- */
  function renderSell(){
    body.innerHTML='';
    const sellables = items.filter(x=> Number((x.sellPriceCP ?? x.sellPriceGP) || 0)>0);
    const invRows = [];
    for (const it of sellables){
      const key = it.itemId || it.id;
      const qty = invSnapshot?.[key] || 0;
      if (qty<=0) continue;
      invRows.push({it, qty});
    }
    if (!invRows.length){ body.textContent='판매 가능한 아이템이 없습니다.'; return; }

    for (const {it, qty} of invRows){
      const row = document.createElement('div');
      Object.assign(row.style,{display:'grid',gridTemplateColumns:'64px 1fr auto auto',gap:'10px',alignItems:'center',borderBottom:'1px dashed #e5e7eb',padding:'8px 0'});

      const img = document.createElement('img'); img.src = it.iconURL || 'https://puppi.netlify.app/images/items/default.png';
      Object.assign(img.style,{width:'64px',height:'64px',objectFit:'contain'}); row.appendChild(img);

      const meta = document.createElement('div');
      meta.innerHTML = `<div style="font-weight:700">${it.name} <small style="color:#6b7280">(${it.itemId||it.id})</small></div>
        <div style="font-size:12px;color:#6b7280">보유수량 ${qty} · 판매가 ${(it.sellPriceCP ?? it.sellPriceGP)|0} CP</div>`;
      row.appendChild(meta);

      const qtySelect = document.createElement('select');
      for (let q=1; q<=qty; q++){
        const opt = document.createElement('option');
        opt.value = q; opt.textContent = `${q}개`;
        qtySelect.appendChild(opt);
      }
      row.appendChild(qtySelect);

      const sellBtn = document.createElement('button'); sellBtn.textContent = `판매`;
      Object.assign(sellBtn.style,{background:'#fff',color:'#111827',border:'1px solid #e5e7eb',padding:'8px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'800'});
      sellBtn.addEventListener('click', async ()=>{
        sellBtn.disabled=true;
        try{
          const q = parseInt(qtySelect.value)||1;
          await onSell(it, q);
          wrap.remove();
        } finally{ sellBtn.disabled=false; }
      });
      row.appendChild(sellBtn);

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

/* ---------------- Shops 클래스 ---------------- */
export class Shops {
  constructor({ db, map, playerMarker, Score, toast, inv, transferMonsterInventory, getGuestId }) {
    this.db = db || _db; this.map = map; this.playerMarker = playerMarker;
    this.Score = Score; this.toast = toast; this.inv = inv; this.transferMonsterInventory = transferMonsterInventory;
    this._getGuestId = ()=> getGuestId?.() || this.Score?.getGuestId?.() || localStorage.getItem('guestId') || 'guest';
    this._markers = new Map(); this._unsub = null; this._tilesKey = '';
    this.MIN_ZOOM = 16; this.TRADE_RANGE_M = 20;
    this.invSnapshot = {};

    // 인벤 스냅샷 자동 유지
    try{
      const origOnChange = this.inv.onChange;
      this.inv.onChange = (items)=>{
        this._buildInvSnapshot(items);
        try{ origOnChange?.(items);}catch{}
      };
    }catch{}
  }

  _getUid(){
    try{
      const s = this.Score?.getStats?.();
      if (s?.uid) return s.uid;
    }catch{}
    try{ return auth?.currentUser?.uid || null; }catch{}
    try{ return window?.__uid || null; }catch{}
    return null;
  }

  _buildInvSnapshot(itemsMaybe){
    const snap = {};
    try{
      const src =
        itemsMaybe ??
        this.inv?.items ??
        (typeof this.inv?.getAll === 'function' ? this.inv.getAll() : undefined) ??
        [];
      if (Array.isArray(src)) {
        src.forEach(it=>{ if (it?.id) snap[it.id] = (snap[it.id]||0) + (Number(it.qty)||0); });
      } else if (src && typeof src === 'object') {
        Object.entries(src).forEach(([k,v])=>{
          if (v && typeof v === 'object') snap[k] = Number(v.qty||0);
          else snap[k] = Number(v||0);
        });
      }
    }catch(e){ console.warn('[shops] inv snapshot build fail', e); }
    this.invSnapshot = snap;
    return snap;
  }

  async _loadItems(shopId){
    const snap = await getDocs(collection(this.db, `shops/${shopId}/items`));
    const out=[]; snap.forEach(d=> out.push({ id:d.id, ...d.data() })); return out;
  }

  _inTradeRange(shop){
    try{
      const pos = this.playerMarker?.getLatLng?.(); if (!pos) return false;
      const dist = this.map.distance(pos, L.latLng(shop.lat, shop.lon));
      return dist <= this.TRADE_RANGE_M;
    }catch{ return true; }
  }

  /** Firestore 트랜잭션으로 직접 CP 차감 (Score 실패/부재 시 폴백) */
  async _directSpendCP(pay){
    const uid = this._getUid();
    if (!uid) throw new Error('no_uid');
    const uref = doc(this.db, 'users', uid);
    await runTransaction(this.db, async (tx)=>{
      const ss = await tx.get(uref);
      if (!ss.exists()) throw new Error('user_missing');
      const data = ss.data()||{};
      const cur = Number(data.chainPoint ?? data.cp ?? 0);
      if (!Number.isFinite(cur)) throw new Error('cp_invalid');
      if (cur < pay) throw Object.assign(new Error('insufficient_cp'), { code:'insufficient_cp' });
      tx.update(uref, {
        chainPoint: cur - pay,
        updatedAt: serverTimestamp()
      });
    });
    return true;
  }

  /** Firestore 트랜잭션으로 직접 CP 지급 */
  async _directAwardCP(amount){
    const uid = this._getUid();
    if (!uid) throw new Error('no_uid');
    const uref = doc(this.db, 'users', uid);
    await runTransaction(this.db, async (tx)=>{
      const ss = await tx.get(uref);
      const data = ss.exists() ? (ss.data()||{}) : {};
      const cur = Number(data.chainPoint ?? data.cp ?? 0);
      const next = Math.max(0, cur + Math.max(0, amount|0));
      tx.set(uref, { chainPoint: next, updatedAt: serverTimestamp() }, { merge:true });
    });
    return true;
  }

  /** 결제: Score 구현 차이를 흡수 + 트랜잭션 폴백 */
  async _spendCP(pay, lat, lon){
    if (pay <= 0) return true;

    // 1) Score.spendCP(boolean?) 우선
    if (typeof this.Score?.spendCP === 'function') {
      try {
        const res = await this.Score.spendCP(pay, { lat, lon, reason: 'shop_buy' });
        if (typeof res === 'boolean') return res;
        if (res && typeof res === 'object' && 'ok' in res) return !!res.ok;
        // 반환값이 모호해도 예외 없으면 성공으로 간주
        return true;
      } catch (e) {
        const msg = (e && (e.code || e.message || e.toString())).toString().toLowerCase();
        if (msg.includes('insufficient') || msg.includes('not enough') || e?.code === 'insufficient_cp') {
          return false;
        }
        // 구현 에러면 폴백 진행
      }
    }

    // 2) Score.deductCP(void) 시도
    if (typeof this.Score?.deductCP === 'function') {
      try { await this.Score.deductCP(pay, lat, lon); return true; }
      catch(e){ /* 폴백 진행 */ }
    }

    // 3) Score.addCP(-pay) 시도
    if (typeof this.Score?.addCP === 'function') {
      try { await this.Score.addCP(-pay, lat, lon); return true; }
      catch(e){ /* 폴백 진행 */ }
    }

    // 4) 최종 폴백: Firestore 트랜잭션으로 직접 차감
    return this._directSpendCP(pay);
  }

  /** 보상: Score 우선 + 트랜잭션 폴백 */
  async _awardCP(amount, lat, lon){
    if (amount <= 0) return;
    if (typeof this.Score?.addCP === 'function') { try { await this.Score.addCP(amount, lat, lon); return; } catch(e){} }
    if (typeof this.Score?.awardCP === 'function') { try { await this.Score.awardCP(amount, lat, lon); return; } catch(e){} }
    // 레거시 호환: awardGP가 CP로 리다이렉트된 프로젝트도 있음
    if (typeof this.Score?.awardGP === 'function') { try { await this.Score.awardGP(amount, lat, lon); return; } catch(e){} }
    // 최종 폴백
    await this._directAwardCP(amount);
  }

  // 구매
  async _buy(shop, item, qty = 1){
    // 0) 거리 체크
    if (!this._inTradeRange(shop)) {
      this.toast?.('거래 가능 거리 밖입니다.');
      throw new Error('out_of_range');
    }

    const ref = doc(this.db, `shops/${shop.id}/items`, item.id);
    let unitPrice = 0;

    // 1) 트랜잭션: 활성/재고/가격을 서버 기준으로 검증
    await runTransaction(this.db, async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists()) throw new Error('gone');

      const d = s.data() || {};
      if (d.active === false) throw new Error('inactive');

      // 💰 가격: CP 우선, 없으면 기존 GP 폴백
      unitPrice = Number(d.buyPriceCP ?? d.priceCP ?? d.buyPriceGP ?? d.priceGP ?? 0) || 0;

      // ✅ 재고정책: stock이 숫자일 때만 재고 관리 / null 또는 미존재는 무제한
      const managesStock = typeof d.stock === 'number';
      if (managesStock) {
        const cur = Number(d.stock);
        if (!Number.isFinite(cur)) throw new Error('stock_invalid');
        if (cur < qty) throw new Error('soldout');
        tx.update(ref, { stock: cur - qty, updatedAt: serverTimestamp() });
      } else {
        tx.update(ref, { updatedAt: serverTimestamp() });
      }
    });

    // 2) CP 차감
    const pay = Math.max(0, (unitPrice|0) * (qty|0));
    if (pay > 0) {
      const pos = this.playerMarker?.getLatLng?.() || { lat: shop.lat, lng: shop.lon };
      const ok = await this._spendCP(pay, pos.lat, pos.lng);
      if (!ok) {
        this.toast?.('CP 부족');
        throw new Error('insufficient_cp');
      }
    }

    // 3) 인벤 지급 (무기 스펙/타입 보존)
    try {
      await this.inv.addItems([{
        id: item.itemId || item.id,
        name: item.name,
        qty,
        rarity: item.weapon ? 'rare' : (item.rarity || 'common'),
        weapon: item.weapon || null,
        type: item.type || 'shopItem'
      }]);
      this._buildInvSnapshot();
    } catch (e) {
      console.warn('[shop] inventory add fail', e);
      this.toast?.('인벤토리 지급 실패');
      throw e;
    }

    this.toast?.('구매 완료! (CP 사용)');
  }

  // 판매
  async _sell(shop, item, qty=1){
    if (!this._inTradeRange(shop)) { this.toast?.('거래 가능 거리 밖입니다.'); throw new Error('out_of_range'); }

    // 인벤 차감
    try { await this.inv.dropItem(item.itemId||item.id, qty); }
    catch(e){ this.toast?.('인벤토리 차감 실패'); throw e; }

    // 상점 재고 되돌림(재고 관리형일 때만)
    if (typeof item.stock==='number'){
      const ref = doc(this.db, `shops/${shop.id}/items`, item.id);
      try { await updateDoc(ref, { stock: increment(qty), updatedAt: serverTimestamp() }); } catch(e){ console.warn('[shop] stock increment fail', e); }
    }

    // CP 지급
    const reward = Math.max(0, Number((item.sellPriceCP ?? item.sellPriceGP) || 0)) * qty;
    const pos = this.playerMarker?.getLatLng?.() || {lat:shop.lat,lng:shop.lon};
    try {
      await this._awardCP(reward, pos.lat, pos.lng);
    } catch(e){ console.warn('[shop] addCP fail', e); this.toast?.(`CP 지급 실패(로그 확인).`); }

    this._buildInvSnapshot();
    this.toast?.('판매 완료! (CP 지급)');
  }

  async _open(shop){
    const freshSnap = this._buildInvSnapshot();
    this._loadItems(shop.id).then(items=>{
      _openShopModalUI(shop, items, {
        onBuy:(it,qty,price)=>this._buy(shop,it,qty,price),
        onSell:(it,q)=>this._sell(shop,it,q),
        invSnapshot:freshSnap
      });
    }).catch(e=>{ console.warn('[shop] open fail', e); this.toast?.('상점 로드 실패'); });
  }

  _watch(){
    if (!this.map) return;
    if (this.map.getZoom()<this.MIN_ZOOM){
      if (this._unsub){ try{this._unsub();}catch{} this._unsub=null; }
      this._tilesKey=''; for (const m of this._markers.values()){ try{this.map.removeLayer(m);}catch{} }
      this._markers.clear(); return;
    }
    const tiles = _tilesFromBounds(this.map.getBounds()); if (!tiles.length) return;
    const key = tiles.join(','); if (key===this._tilesKey) return; this._tilesKey=key;
    if (this._unsub){ try{this._unsub();}catch{} this._unsub=null; }

    const qy = query(collection(this.db,'shops'), where('active','==',true), where('tile','in',tiles));
    this._unsub = onSnapshot(qy,(snap)=>{
      snap.docChanges().forEach(ch=>{
        const id = ch.doc.id;
        if (ch.type==='removed'){ const m=this._markers.get(id); if (m){try{this.map.removeLayer(m);}catch{} this._markers.delete(id);} return; }
        const data = ch.doc.data()||{}; const {lat,lon,imageURL,size=48,active=true,name='상점'}=data;
        if (!Number.isFinite(lat)||!Number.isFinite(lon)||!active){ const m=this._markers.get(id); if (m){try{this.map.removeLayer(m);}catch{} this._markers.delete(id);} return; }
        const icon=_shopIcon(size,imageURL); let mk=this._markers.get(id);
        if (!mk){ mk=L.marker([lat,lon],{icon,zIndexOffset:9000}).addTo(this.map); mk.on('click',()=>this._open({id,...data})); this._markers.set(id,mk);}
        else{ mk.setLatLng([lat,lon]); mk.setIcon(icon);}
        mk.options.title=name;
      });
    },(err)=>console.warn('[shops] onSnapshot error',err));
  }

  start(){ this._watch(); this.map.on('moveend',()=>this._watch()); }
  stop(){ if (this._unsub){try{this._unsub();}catch{} this._unsub=null;} for (const m of this._markers.values()){try{this.map.removeLayer(m);}catch{}} this._markers.clear(); this._tilesKey=''; }
}

export default Shops;
