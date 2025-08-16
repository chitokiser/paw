// /geolocation/js/monstersRT.js
import { collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// ✅ 로컬 쿨다운/캐시 유틸
function getLocalCooldownUntil(id){
  try { const v = Number(localStorage.getItem('mon_cd:'+id) || 0); return Number.isFinite(v) ? v : 0; } catch { return 0; }
}
function clearLocalCooldown(id){
  try { localStorage.removeItem('mon_cd:'+id); } catch {}
}

export class RealTimeMonsters {
  constructor({
    db, map, makeImageDivIcon, DEFAULT_IMG, attachMonsterBattle, monstersGuard,
    pollMs = 3000, tileSizeDeg = 0.01, maxDocs = 60, useTiles = true,
    padDeg = 0.0006, moveDebounceMs = 400, epsilonM = 0.3
  }){
    this.db = db; this.map = map;
    this.makeImageDivIcon = makeImageDivIcon;
    this.DEFAULT_IMG = DEFAULT_IMG;
    // 👇 (marker,id,d) 형태로 불러도 되게 battle.js가 normalize 하므로 그대로 넘겨도 OK
    this.attachMonsterBattle = (marker, id, d) => attachMonsterBattle(marker, id, d || {});
    this.monstersGuard = monstersGuard;

    this.pollMs = Math.max(800, pollMs|0 || 3000);
    this.tileSizeDeg = Math.max(0.0025, tileSizeDeg || 0.01);
    this.maxDocs = Math.max(10, maxDocs|0 || 60);
    this.useTiles = !!useTiles;
    this.padDeg = padDeg; this.moveDebounceMs = Math.max(100, moveDebounceMs|0 || 400);
    this.epsilonM = Math.max(0.05, epsilonM || 0.3);

    this.reg = new Map();
    this._pollTid = null; this._moveTid = null; this._started = false;
    this._lastTilesKey = ''; this._lastIdsInView = new Set();

    this._onMoveEnd = this._onMoveEnd.bind(this);
    this._onZoomEnd = this._onZoomEnd.bind(this);
  }

  getVisibleMonsters(){
  const out = [];
  for (const [id, rec] of this.reg){
    if (!rec?.data) continue;
    out.push({ id, data: rec.data });
  }
  return out;
}

  start(){
    if (this._started) return; this._started = true;
    try { this.map.on('moveend', this._onMoveEnd); this.map.on('zoomend', this._onZoomEnd); } catch {}
    this._fetchOnce(true).catch(()=>{});
    this._pollTid = setInterval(()=> this._fetchOnce().catch(()=>{}), this.pollMs);
  }
  stop(){
    if (!this._started) return; this._started = false;
    if (this._pollTid) clearInterval(this._pollTid);
    if (this._moveTid) clearTimeout(this._moveTid);
    try { this.map.off('moveend', this._onMoveEnd); this.map.off('zoomend', this._onZoomEnd); } catch {}
    this.reg.forEach(rec=>{ try{ rec.marker.remove(); }catch{} try{ this.map.removeLayer(rec.marker); }catch{} try{ rec.marker.getElement()?.remove(); }catch{} });
    this.reg.clear(); this._lastIdsInView.clear(); this._lastTilesKey = '';
  }

  _onMoveEnd(){ this._debouncedFetch(); }
  _onZoomEnd(){ this._debouncedFetch(); }
  _debouncedFetch(){ if (this._moveTid) clearTimeout(this._moveTid); this._moveTid = setTimeout(()=> this._fetchOnce(true).catch(()=>{}), this.moveDebounceMs); }

  _tileOf(lat, lon, g=this.tileSizeDeg){ const fy=Math.floor(lat/g), fx=Math.floor(lon/g); return `${fy}_${fx}`; }
  _tilesFromBounds(bounds, g=this.tileSizeDeg){
    const sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    const y0=Math.floor(sw.lat/g), y1=Math.floor(ne.lat/g);
    const x0=Math.floor(sw.lng/g), x1=Math.floor(ne.lng/g);
    const tiles=[]; for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
    if (tiles.length>10){
      try{ const c=this.map.getCenter(); const t=this._tileOf(c.lat,c.lng,g); tiles.sort((a,b)=>(a===t?-1:0)-(b===t?-1:0)); }catch{}
      return tiles.slice(0,10);
    }
    return tiles;
  }
  _currentTilesKey(){
    if (!this.map) return '';
    const b=this.map.getBounds();
    const padded = L.latLngBounds(
      [b.getSouth()-this.padDeg, b.getWest()-this.padDeg],
      [b.getNorth()+this.padDeg, b.getEast()+this.padDeg]
    );
    return this._tilesFromBounds(padded).join(',');
  }

  async _fetchOnce(force=false){
    if (!this.db || !this.map) return;

    let tilesKey='', tiles=[];
    let q;
    if (this.useTiles){
      tilesKey = this._currentTilesKey();
      if (!force && tilesKey === this._lastTilesKey) return;
      this._lastTilesKey = tilesKey;
      tiles = tilesKey ? tilesKey.split(',') : [];
      if (tiles.length === 0) return;
      q = query(collection(this.db,'monsters'), where('tile','in',tiles), limit(this.maxDocs));
    }else{
      if (!force) return;
      q = query(collection(this.db,'monsters'), limit(this.maxDocs));
    }

    const now = Date.now();
    const snap = await getDocs(q);
    const nextIds = new Set();

    snap.forEach(ds=>{
      const id = ds.id;
      const d  = ds.data() || {};
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon)) return;

      // ✅ 로컬 쿨다운 우선 (DB 쓰기 없음)
      const localCD = getLocalCooldownUntil(id);
      if (localCD > now) return;

      // (레거시 필드가 있다면 참고만)
      const cd = Number(d.cooldownUntil || 0);
      const legacyDead = (d.dead === true) || (d.alive === false);
      const legacyResp = Number(d.respawnAt || 0);
      const hiddenByLegacy = legacyDead && legacyResp > now;
      if (cd > now || hiddenByLegacy) return;

      // 로컬 처치 표기
      if (this.monstersGuard?.killedLocal?.has?.(id)) { this._ensureHidden(id); return; }

      nextIds.add(id);
      this._ensureShownOrUpdate(id, d);
    });

    if (this.useTiles){
      for (const id of this._lastIdsInView){ if (!nextIds.has(id)) this._ensureHidden(id); }
      this._lastIdsInView = nextIds;
    }
  }

  _ensureShownOrUpdate(id, d){
    const sizePx = this._sizeOf(d.size);
    let rec = this.reg.get(id);
    if (!rec){
      const url = d.imagesURL || d.imageURL || d.iconURL || this.DEFAULT_IMG;
      const icon = this.makeImageDivIcon(url, sizePx);
      const marker = L.marker([d.lat, d.lon], { icon, interactive:true }).addTo(this.map);
      rec = { marker, data:d, sizePx, bound:false };
      this.reg.set(id, rec);
      // 👉 battle.js 쪽이 시그니처를 정규화하므로 그대로 전달
      this.attachMonsterBattle(marker, id, d);
      rec.bound = true;
      return;
    }

    try{
      const cur = rec.marker.getLatLng();
      const dist = this.map.distance(cur, L.latLng(d.lat, d.lon));
      if (dist > this.epsilonM) rec.marker.setLatLng([d.lat, d.lon]);
    }catch{ try{ rec.marker.setLatLng([d.lat, d.lon]); }catch{} }

    const prevUrl = (rec.data?.imagesURL || rec.data?.imageURL || rec.data?.iconURL);
     const nextUrl = (d.imagesURL || d.imageURL || d.iconURL);
    if (prevUrl !== nextUrl || rec.sizePx !== sizePx){
      rec.marker.setIcon(this.makeImageDivIcon(nextUrl ?? this.DEFAULT_IMG, sizePx));
      rec.sizePx = sizePx; rec.bound = false;
    }
    rec.data = d;
    if (!rec.bound){ this.attachMonsterBattle(rec.marker, id, d); rec.bound = true; }
  }

  _ensureHidden(id){
    const rec = this.reg.get(id); if (!rec) return;
    try{ rec.marker.remove(); }catch{}; try{ this.map.removeLayer(rec.marker); }catch{}; try{ rec.marker.getElement()?.remove(); }catch{};
    this.reg.delete(id);
  }

  _sizeOf(n){ const v=Number(n); return Number.isNaN(v)?96:Math.max(24,Math.min(v,256)); }
}
