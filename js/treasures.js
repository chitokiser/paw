// treasures.js
// 보물 구독/마커/타격 트랜잭션 모듈
import {
  collection, query, where, onSnapshot, doc, runTransaction,
  serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { rollDrops } from './loot.js';

function _tileSizeDeg(){ return 0.01; }
function _tilesFromBounds(bounds, g = _tileSizeDeg()){
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
  const y0 = Math.floor(sw.lat/g), y1 = Math.floor(ne.lat/g);
  const x0 = Math.floor(sw.lng/g), x1 = Math.floor(ne.lng/g);
  const tiles = [];
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
  return tiles.slice(0, 10);
}

function _makeTreasureIcon(size = 44, imageURL = 'https://puppi.netlify.app/images/event/tresure.png') {
  const s = Math.max(24, Number(size) || 44);
  const html = `<div class="mon-wrap" style="position:relative;width:${s}px;height:${s}px;">
      <img src="${imageURL}" alt="treasure" draggable="false"
           style="width:100%;height:100%;object-fit:contain;pointer-events:none;"/>
    </div>`;
  return L.divIcon({ className: '', html, iconSize: [s, s], iconAnchor: [s/2, s/2] });
}

// id 정규화: itemId도 허용, 기본값 보정
function _normalizeItems(arr){
  return (arr||[])
    .filter(it => it && (it.id || it.itemId))
    .map(it => ({
      id: String(it.id || it.itemId),
      name: String(it.name || it.id || it.itemId),
      qty: Math.max(1, Number(it.qty || 1)),
      rarity: String(it.rarity || 'common')
    }));
}

// 보상 후보 추출: items → lootTable
function _pickDropsFromData(data){
  const rewards = data?.rewards || {};
  // 고정 아이템 우선
  if (Array.isArray(rewards.items) && rewards.items.length) return _normalizeItems(rewards.items);
  if (Array.isArray(data.items)    && data.items.length)    return _normalizeItems(data.items);
  // 룻테이블
  if (Array.isArray(rewards.lootTable) && rewards.lootTable.length) return _normalizeItems(rollDrops(rewards.lootTable));
  if (Array.isArray(data.lootTable)    && data.lootTable.length)    return _normalizeItems(rollDrops(data.lootTable));
  // 없으면 빈 배열
  return [];
}

export class Treasures {
  constructor({ db, map, playerMarker, toast,
                attachHPBar, spawnImpactAt, shakeMap, playAttackImpact,
                transferMonsterInventory, getGuestId, Score, inv }) {
    this.db = db; this.map = map; this.playerMarker = playerMarker;
    this.toast = toast; this.attachHPBar = attachHPBar;
    this.spawnImpactAt = spawnImpactAt; this.shakeMap = shakeMap; this.playAttackImpact = playAttackImpact;
    this.transferMonsterInventory = transferMonsterInventory; this.getGuestId = getGuestId; this.Score = Score;
    this.inv = inv;
    this._treasures = new Map();
    this._unsub = null; this._lastTileKey = '';
    this.MIN_ZOOM = 16;
  }

  _clearMarkers(){
    for (const { marker } of this._treasures.values()) {
      try { this.map.removeLayer(marker); } catch {}
    }
    this._treasures.clear();
  }

  _upsertMarker(docId, data){
    const { lat, lon, imageURL, size = 44, alive = true } = data || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || alive === false) {
      const cached = this._treasures.get(docId);
      if (cached) { try { this.map.removeLayer(cached.marker); } catch {} this._treasures.delete(docId); }
      return;
    }
    const icon = _makeTreasureIcon(size, imageURL);
    const cached = this._treasures.get(docId);

    const power = Math.max(1, Number(data.power ?? 1));
    const left  = Number.isFinite(data.hitsLeft) ? Math.max(0, Number(data.hitsLeft)) : power;

    if (!cached) {
      const marker = L.marker([lat, lon], { icon, zIndexOffset: 10000 }).addTo(this.map);
      let hp = null; try { hp = this.attachHPBar(marker, power); hp.set(left); } catch {}
      marker.on('click', ()=>{
        try{
          const { lat: uLat, lng: uLng } = this.playerMarker?.getLatLng?.() ?? {};
          if (!Number.isFinite(uLat) || !Number.isFinite(uLng)) return;
          const distM = this.map.distance([lat, lon], [uLat, uLng]);
          if (distM > 12){ this.toast?.(`너무 멉니다. (${distM.toFixed(1)}m)`); return; }
        }catch{}
        this._hit(docId, data);
      });
      this._treasures.set(docId, { marker, hp, maxHits: power });
    } else {
      try { cached.marker.setLatLng([lat, lon]); cached.marker.setIcon(icon); } catch {}
      if (cached.hp) cached.hp.set(left);
    }
  }

  async _hit(docId, data){
    try{
      const ref = doc(this.db, 'treasures', docId);
      const res = await runTransaction(this.db, async (tx)=>{
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('notfound');
        const d = snap.data() || {};
        if (d.dead === true || d.alive === false) throw new Error('already');
        const power = Math.max(1, Number(d.power ?? 1));
        const left0 = Number.isFinite(d.hitsLeft) ? Number(d.hitsLeft) : power;
        const left  = Math.max(0, left0 - 1);
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

      try{
        this.spawnImpactAt(this.map, data.lat, data.lon);
        this.playAttackImpact?.({ intensity: 0.7 });
        this.shakeMap?.();
      }catch{}

      const cache = this._treasures.get(docId);
      if (cache?.hp) cache.hp.set(res.left);

      if (res.left <= 0){
        // ----- 드랍/점수 계산 -----
        const drops = _pickDropsFromData(data);
        const rewards = data?.rewards || {};
        const score = Number(rewards.score ?? data.score ?? 0);

        // ----- 인벤 지급 (직접지급 모드) -----
        try {
          if (drops.length) {
            const guestId = (typeof this.getGuestId === 'function' && this.getGuestId()) || 'guest';
            await this.transferMonsterInventory(this.db, guestId, drops);
            // (옵션) UI 즉시 반영
            try { await this.inv?.addItems(drops); } catch {}
          }
        } catch(e){
          console.warn('[treasure] grant items failed', e);
          this.toast?.('보상 지급 실패. 잠시 후 다시 시도해 주세요.');
        }

        // ----- GP 지급 -----
        try {
          if (score > 0 && typeof this.Score?.addGP === 'function'){
            const pos = this.playerMarker?.getLatLng?.() || { lat:data.lat, lng:data.lon };
            await this.Score.addGP(score, pos.lat, pos.lng);
            this.toast?.(`보물 오픈! +${score} GP`);
          } else {
            this.toast?.('보물 오픈!');
          }
        } catch(e){
          this.toast?.('보물 오픈! (GP 지급 실패)');
        }

        // 마커 제거
        const mk = cache?.marker;
        if (mk){ try { this.map.removeLayer(mk); } catch{} }
        this._treasures.delete(docId);

      } else {
        this.toast?.(`보물 타격! (남은 타격: ${res.left}/${res.power})`);
      }
    }catch(e){
      if (String(e?.message||'').includes('already')) this.toast?.('이미 미션을 완료하였습니다.');
      else { console.warn('[treasure] hit error', e); this.toast?.('타격 처리 중 문제가 발생했습니다.'); }
    }
  }

  _watch(){
    if (!this.map) return;
    if (this.map.getZoom() < this.MIN_ZOOM) {
      if (this._unsub) { try { this._unsub(); } catch {} this._unsub = null; }
      this._lastTileKey = ''; this._clearMarkers(); return;
    }
    const tiles = _tilesFromBounds(this.map.getBounds());
    if (!tiles.length) return;
    const key = tiles.join(',');
    if (key === this._lastTileKey) return;
    this._lastTileKey = key;

    if (this._unsub) { try { this._unsub(); } catch {} this._unsub = null; }

    const baseCol = collection(this.db, 'treasures');
    const qy = query(
      baseCol,
      where('type', '==', 'treasure'),
      where('tile', 'in', tiles),
      limit(80)
    );

    this._unsub = onSnapshot(qy, (snap)=>{
      snap.docChanges().forEach((ch)=>{
        const id = ch.doc.id;
        const data = ch.doc.data() || {};
        if (ch.type === 'removed') {
          const mk = this._treasures.get(id)?.marker;
          if (mk) { try { this.map.removeLayer(mk); } catch {} this._treasures.delete(id); }
          return;
        }
        this._upsertMarker(id, data);
      });
    }, (err)=> console.warn('[treasure] onSnapshot error', err));
  }

  start(){
    this._watch();
    this.map.on('moveend', ()=> this._watch());
  }

  stop(){
    if (this._unsub) { try{ this._unsub(); }catch{} this._unsub = null; }
    this._clearMarkers();
    this._lastTileKey = '';
  }
}
