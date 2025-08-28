// 상점 구독/마커/모달 UI/거래 (CP 전용, 주소기반)

import {
  collection, query, where, onSnapshot, doc, runTransaction,
  serverTimestamp, getDocs, increment, FieldPath
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { db as _db, auth as _auth } from "./firebase.js";

import {
  getMode,
  getUserDocRef,
  ensureInventoryDoc,
  migrateInventoryIfNeeded
} from "./identity.js";

/* ---------- helpers ---------- */
async function _ensureAuth() {
  const auth = _auth || getAuth();
  if (!auth.currentUser) {
    try { await signInAnonymously(auth); } catch(e) { console.warn('[shops] anon auth fail', e); }
  }
  return auth;
}
function _tileSizeDeg(){ return 0.01; }
function _tilesFromBounds(bounds, g = _tileSizeDeg()){
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
  const y0 = Math.floor(sw.lat/g), y1 = Math.floor(ne.lat/g);
  const x0 = Math.floor(sw.lng/g), x1 = Math.floor(ne.lng/g);
  const tiles=[]; for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
  return tiles.slice(0,10);
}
function _shopIcon(size=68, imageURL='https://puppi.netlify.app/images/event/shop.png'){
  const s = Math.max(24, Number(size)||68);
  const html = `<div style="position:relative;width:${s}px;height:${s}px">
    <img src="${imageURL}" alt="shop" style="width:100%;height:100%;object-fit:contain;pointer-events:none"/>
  </div>`;
  return L.divIcon({ className:'', html, iconSize:[s,s], iconAnchor:[s/2,s/2] });
}
function _getBuyPrice(it){
  const b = Number(it.buyPriceCP ?? it.priceCP ?? it.buyPriceGP ?? it.priceGP ?? it.sellPriceCP ?? it.sellPriceGP ?? 0);
  return Math.max(0, b|0);
}

/* ---------- modal ---------- */
function _openShopModalUI(shop, items, {onBuy, onSell, invSnapshot}){
  let wrap = document.getElementById('shopModal'); if (wrap) wrap.remove();
  wrap = document.createElement('div'); wrap.id='shopModal';
  Object.assign(wrap.style,{position:'fixed',inset:'0',background:'rgba(0,0,0,.35)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000,padding:'16px'});
  wrap.addEventListener('click', (e)=>{ if (e.target===wrap) wrap.remove(); });

  const card = document.createElement('div');
  Object.assign(card.style,{background:'#fff',border:'1px solid #e5e7eb',borderRadius:'16px',boxShadow:'0 20px 60px rgba(0,0,0,.25)',width:'min(560px,95vw)',maxHeight:'85vh',overflow:'auto',padding:'12px'});

  const title = document.createElement('div'); title.style.fontWeight='800'; title.style.fontSize='18px'; title.textContent=shop?.name||'상점'; card.appendChild(title);

  const tabs=document.createElement('div'); Object.assign(tabs.style,{display:'flex',gap:'6px',margin:'8px 0'});
  const btnBuy=document.createElement('button'); btnBuy.textContent='구매';
  const btnSell=document.createElement('button'); btnSell.textContent='판매';
  for (const b of [btnBuy,btnSell]) Object.assign(b.style,{padding:'6px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'700'});
  tabs.appendChild(btnBuy); tabs.appendChild(btnSell); card.appendChild(tabs);

  const body=document.createElement('div'); card.appendChild(body);

  function renderBuy(){
    body.innerHTML='';
    if (!items.length){ body.textContent='판매 중인 품목이 없습니다.'; return; }
    for (const it of items){
      if (it.active===false) continue;
      const row=document.createElement('div');
      Object.assign(row.style,{display:'grid',gridTemplateColumns:'64px 1fr auto auto',gap:'10px',alignItems:'center',borderBottom:'1px dashed #e5e7eb',padding:'8px 0'});
      const img=document.createElement('img'); img.src=it.iconURL||'https://puppi.netlify.app/images/items/default.png'; Object.assign(img.style,{width:'64px',height:'64px',objectFit:'contain'}); row.appendChild(img);
      const meta=document.createElement('div');
      const price=_getBuyPrice(it);
      meta.innerHTML=`<div style="font-weight:700">${it.name} <small style="color:#6b7280">(${it.itemId||it.id})</small></div>
      <div style="font-size:12px;color:#6b7280">${it.weapon?`ATK ${it.weapon.baseAtk} · +CRIT ${(it.weapon.crit??0)}% · +ATK ${(it.weapon.extraInit??0)}`:(it.stackable?'소모품':'장비')}
      ${typeof it.stock==='number'?` · 재고 ${it.stock}`:' · 재고 무한'}</div>`;
      row.appendChild(meta);
      const sel=document.createElement('select'); for(let q=1;q<=10;q++){const o=document.createElement('option');o.value=q;o.textContent=`${q}개`;sel.appendChild(o);} row.appendChild(sel);
      const btn=document.createElement('button'); btn.textContent=`${price} CP`; Object.assign(btn.style,{background:'#111827',color:'#fff',border:'1px solid #e5e7eb',padding:'8px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'800'});
      btn.addEventListener('click', async ()=>{ btn.disabled=true; try{ const q=parseInt(sel.value)||1; await onBuy(it,q,price); wrap.remove(); } finally{ btn.disabled=false; } });
      row.appendChild(btn);
      body.appendChild(row);
    }
  }

  function renderSell(){
    body.innerHTML='';
    const sellables=items.filter(x=> Number((x.sellPriceCP ?? x.sellPriceGP) || 0)>0);
    const rows=[];
    for (const it of sellables){
      const key=it.itemId||it.id; const qty=invSnapshot?.[key]||0; if (qty>0) rows.push({it,qty});
    }
    if (!rows.length){ body.textContent='판매 가능한 아이템이 없습니다.'; return; }
    for (const {it,qty} of rows){
      const row=document.createElement('div');
      Object.assign(row.style,{display:'grid',gridTemplateColumns:'64px 1fr auto auto',gap:'10px',alignItems:'center',borderBottom:'1px dashed #e5e7eb',padding:'8px 0'});
      const img=document.createElement('img'); img.src=it.iconURL||'https://puppi.netlify.app/images/items/default.png'; Object.assign(img.style,{width:'64px',height:'64px',objectFit:'contain'}); row.appendChild(img);
      const meta=document.createElement('div'); meta.innerHTML=`<div style="font-weight:700">${it.name} <small style="color:#6b7280">(${it.itemId||it.id})</small></div>
      <div style="font-size:12px;color:#6b7280">보유수량 ${qty} · 판매가 ${(it.sellPriceCP ?? it.sellPriceGP)|0} CP</div>`; row.appendChild(meta);
      const sel=document.createElement('select'); for(let q=1;q<=qty;q++){const o=document.createElement('option');o.value=q;o.textContent=`${q}개`;sel.appendChild(o);} row.appendChild(sel);
      const btn=document.createElement('button'); btn.textContent='판매'; Object.assign(btn.style,{background:'#fff',color:'#111827',border:'1px solid #e5e7eb',padding:'8px 10px',borderRadius:'10px',cursor:'pointer',fontWeight:'800'});
      btn.addEventListener('click', async ()=>{ btn.disabled=true; try{ const q=parseInt(sel.value)||1; await onSell(it,q); wrap.remove(); } finally{ btn.disabled=false; } }); row.appendChild(btn);
      body.appendChild(row);
    }
  }

  const selectBuy=()=>{btnBuy.style.background='#111827';btnBuy.style.color='#fff';btnSell.style.background='';btnSell.style.color='';renderBuy();};
  const selectSell=()=>{btnSell.style.background='#111827';btnSell.style.color = '#fff';btnBuy.style.background='';btnBuy.style.color='';renderSell();};

  btnBuy.addEventListener('click',selectBuy); btnSell.addEventListener('click',selectSell); selectBuy();

  const close=document.createElement('button'); close.textContent='닫기'; Object.assign(close.style,{marginTop:'8px',padding:'8px 12px',borderRadius:'8px',cursor:'pointer'}); close.addEventListener('click',()=>wrap.remove()); card.appendChild(close);
  wrap.appendChild(card); document.body.appendChild(wrap);
}

/* ---------- class ---------- */
export class Shops {
  constructor({ db, map, playerMarker, Score, toast, inv }) {
    this.db = db || _db; this.map = map; this.playerMarker = playerMarker;
    this.Score = Score; this.toast = toast; this.inv = inv;
    this._markers = new Map(); this._unsub = null; this._tilesKey = '';
    this.MIN_ZOOM = 16; this.TRADE_RANGE_M = 20;
    this.invSnapshot = {};

    try{
      const orig = this.inv?.onChange;
      if (typeof orig === 'function'){
        this.inv.onChange = (items)=>{ this._buildInvSnapshot(items); try{orig(items);}catch{} };
      }
    }catch{}
  }

  _buildInvSnapshot(itemsMaybe){
    const snap={};
    try{
      const src = itemsMaybe ?? this.inv?.items ?? (typeof this.inv?.getAll==='function'? this.inv.getAll(): undefined) ?? [];
      if (Array.isArray(src)) src.forEach(it=>{ if (it?.id) snap[it.id]=(snap[it.id]||0)+(Number(it.qty)||0); });
      else if (src && typeof src==='object') Object.entries(src).forEach(([k,v])=>{ snap[k] = (v&&typeof v==='object')? Number(v.qty||0): Number(v||0); });
    }catch(e){ console.warn('[shops] inv snapshot build fail', e); }
    this.invSnapshot=snap; return snap;
  }

  async _loadItems(shopId){
    const snap=await getDocs(collection(this.db, `shops/${shopId}/items`));
    const out=[]; snap.forEach(d=> out.push({ id:d.id, ...d.data() })); return out;
  }

  _inTradeRange(shop){
    try{
      const pos=this.playerMarker?.getLatLng?.(); if (!pos) return false;
      const dist=this.map.distance(pos, L.latLng(shop.lat, shop.lon));
      return dist<=this.TRADE_RANGE_M;
    }catch{ return true; }
  }
  _requireWalletMode(){
    const mode=getMode();
    if (mode!=='wallet'){ this.toast?.('지갑 모드에서만 거래할 수 있어요.'); throw new Error('wallet_required'); }
  }

  // 구매(원자 트랜잭션)
  async _buy(shop, item, qty=1){
    console.log('[Shop Buy] Attempting to buy:', { shop, item, qty });
    console.log('[Shop Buy] Auth state:', getAuth()?.currentUser);
    await _ensureAuth(); // 🔑 rules의 request.auth != null 보장
    if (!this._inTradeRange(shop)) { this.toast?.('거래 가능 거리 밖입니다.'); throw new Error('out_of_range'); }
    this._requireWalletMode();

    const userRef=getUserDocRef(this.db);
    if (!userRef){ this.toast?.('지갑 연결을 먼저 해주세요.'); throw new Error('no_user_ref'); }
    await migrateInventoryIfNeeded(this.db);
    const invRef=await ensureInventoryDoc(this.db);

    const itemRef=doc(this.db, `shops/${shop.id}/items`, item.id);
    const key=String(item.itemId||item.id);

    try{
      const nextCPAfterTx = await runTransaction(this.db, async (tx)=>{
        const isnap=await tx.get(itemRef); if (!isnap.exists()) throw new Error('gone');
        const idata=isnap.data()||{}; if (idata.active===false) throw new Error('inactive');

        const unit=Number(idata.buyPriceCP ?? idata.priceCP ?? idata.buyPriceGP ?? idata.priceGP ?? 0) || 0;
        const q=Math.max(1, qty|0); const pay=Math.max(0, unit*q);

        const us=await tx.get(userRef); if (!us.exists()) throw new Error('user_missing');
        const u=us.data()||{}; const curCP=Number(u.cp ?? u.chainPoint ?? 0);
        if (!Number.isFinite(curCP)) throw new Error('cp_invalid');
        if (curCP < pay) { this.toast?.(`CP 부족: 보유 ${curCP} / 필요 ${pay}`); throw new Error('insufficient_cp'); }
        const nextCP=curCP - pay;

        // 1) stock: 숫자면 감소, 아니면 타임스탬프만 (규칙: stock/updatedAt/lastSoldAt)
        if (typeof idata.stock==='number'){
          const curStock=Number(idata.stock);
          if (!Number.isFinite(curStock)) throw new Error('stock_invalid');
          if (curStock > 0 && curStock < q) throw new Error('soldout');
          tx.update(itemRef, { stock: curStock - q, updatedAt: serverTimestamp(), lastSoldAt: serverTimestamp() });
        }else{
          tx.update(itemRef, { updatedAt: serverTimestamp(), lastSoldAt: serverTimestamp() });
        }

        // 2) 유저 CP 차감 (cp만)
        tx.update(userRef, { cp: nextCP, updatedAt: serverTimestamp() });

        // 3) 인벤 지급 (수량과 메타정보 분리)
        const qtyPath = new FieldPath('items', key, 'qty');
        tx.update(invRef, qtyPath, increment(q));

        const updatePairs = [
          new FieldPath('items', key, 'name'),
          (item.name || key),
          new FieldPath('items', key, 'rarity'),
          (item.weapon ? 'rare' : (item.rarity || 'common')),
          'updatedAt', 
          serverTimestamp()
        ];

        if (item.weapon) {
          updatePairs.push(new FieldPath('items', key, 'weapon'), item.weapon);
        }
        tx.update(invRef, ...updatePairs);

        return nextCP;
      });

      try{ if (this.Score?.setCP && Number.isFinite(nextCPAfterTx)) await this.Score.setCP(nextCPAfterTx); }catch{}
      this._buildInvSnapshot();
      this.toast?.('구매 완료!');
      return true;

    } catch(e){
      console.error('[shop.buy.tx] fail', e.code, e.message, e);
      throw e;
    }
  }

  // 판매(원자 트랜잭션)
  async _sell(shop, item, qty=1){
    await _ensureAuth();
    if (!this._inTradeRange(shop)) { this.toast?.('거래 가능 거리 밖입니다.'); throw new Error('out_of_range'); }
    this._requireWalletMode();

    const userRef=getUserDocRef(this.db);
    if (!userRef){ this.toast?.('지갑 연결을 먼저 해주세요.'); throw new Error('no_user_ref'); }
    await migrateInventoryIfNeeded(this.db);
    const invRef=await ensureInventoryDoc(this.db);

    const itemRef=doc(this.db, `shops/${shop.id}/items`, item.id);
    const key=String(item.itemId||item.id);
    const rewardUnit=Math.max(0, Number((item.sellPriceCP ?? item.sellPriceGP) || 0));
    const qtyPath = new FieldPath('items', key, 'qty');

    try{
      await runTransaction(this.db, async (tx)=>{
        const invSnap=await tx.get(invRef); if (!invSnap.exists()) throw new Error('inv_missing');
        const curQty=Number((((invSnap.data()||{}).items||{})[key]||{}).qty || 0);
        if (!Number.isFinite(curQty) || curQty < qty) throw new Error('not_enough');

        // 인벤 감소
        tx.update(invRef, qtyPath, increment(-qty), 'updatedAt', serverTimestamp());

        // 상점 재고 복원(숫자형일 때만), 아니면 타임스탬프만
        const sSnap=await tx.get(itemRef);
        if (sSnap.exists()){
          const sd = sSnap.data() || {};
          if (typeof sd.stock==='number') {
            const next = (Number(sd.stock)||0) + qty;
            tx.update(itemRef, { stock: next, updatedAt: serverTimestamp() });
          } else {
            tx.update(itemRef, { updatedAt: serverTimestamp() });
          }
        }

        // 유저 CP 지급 (cp만)
        const uSnap=await tx.get(userRef);
        const curCP=Number((uSnap.data()||{}).cp ?? (uSnap.data()||{}).chainPoint ?? 0);
        const next  = curCP + rewardUnit * qty;
        tx.update(userRef, { cp: next, updatedAt: serverTimestamp() });
      });
    } catch(e){
      console.error('[shop.sell.tx] fail', e.code, e.message, e);
      throw e;
    }

    this._buildInvSnapshot();
    this.toast?.('판매 완료! (CP 지급)');
    return true;
  }

  async _open(shop){
    const fresh = this._buildInvSnapshot();
    this._loadItems(shop.id).then(items=>{
      _openShopModalUI(shop, items, {
        onBuy:(it,qty,price)=>this._buy(shop,it,qty,price),
        onSell:(it,q)=>this._sell(shop,it,q),
        invSnapshot:fresh
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
    const tiles=_tilesFromBounds(this.map.getBounds()); if (!tiles.length) return;
    const key=tiles.join(','); if (key===this._tilesKey) return; this._tilesKey=key;
    if (this._unsub){ try{this._unsub();}catch{} this._unsub=null; }

    const qy=query(collection(this.db,'shops'), where('active','==',true), where('tile','in',tiles));
    this._unsub=onSnapshot(qy,(snap)=>{
      snap.docChanges().forEach(ch=>{
        const id = ch.doc.id;
        if (ch.type==='removed'){ const m=this._markers.get(id); if (m){try{this.map.removeLayer(m);}catch{} this._markers.delete(id);} return; }
        const data=ch.doc.data()||{}; const {lat,lon,imageURL,size=48,active=true,name='상점'}=data;
        if (!Number.isFinite(lat)||!Number.isFinite(lon)||!active){
          const m=this._markers.get(id); if (m){try{this.map.removeLayer(m);}catch{} this._markers.delete(id);} return;
        }
        const icon=_shopIcon(size,imageURL); let mk=this._markers.get(id);
        if (!mk){ mk=L.marker([lat,lon],{icon,zIndexOffset:9000}).addTo(this.map); mk.on('click',()=>this._open({id,...data})); this._markers.set(id,mk); }
        else{ mk.setLatLng([lat,lon]); mk.setIcon(icon); }
        mk.options.title=name;
      });
    },(err)=>console.warn('[shops] onSnapshot error',err));
  }

  start(){ this._watch(); this.map.on('moveend',()=>this._watch()); }
  stop(){ if (this._unsub){try{this._unsub();}catch{} this._unsub=null;} for (const m of this._markers.values()){try{this.map.removeLayer(m);}catch{}} this._markers.clear(); this._tilesKey=''; }
}

export default Shops;