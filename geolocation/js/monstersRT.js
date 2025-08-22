// /geolocation/js/monstersRT.js
import { collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { makeAniFirstFrameIcon } from './fx.js'; // ✅ 첫 프레임 아이콘 사용

/* ===============================
 * 로컬 쿨다운 유틸
 * =============================== */
function getLocalCooldownUntil(id){
  try {
    const v = Number(localStorage.getItem('mon_cd:' + id) || 0);
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

/* ===============================
 * 기본 정적 아이콘 (폴백)
 * =============================== */
function makeStaticIcon(url, sizePx){
  const s = Math.max(24, Number(sizePx) || 96);
  const safe = url || 'https://puppi.netlify.app/images/mon/30.png';
  const html = `
    <div class="mon-wrap" style="position:relative;width:${s}px;height:${s}px;">
      <img src="${safe}" alt="monster" draggable="false"
           style="width:100%;height:100%;object-fit:contain;pointer-events:none;"/>
    </div>`;
  // HP바 앵커 호환: 하단 중앙
  return L.divIcon({ className:'', html, iconSize:[s,s], iconAnchor:[s/2,s] });
}

/* ===============================
 * mid 기반 첫 프레임 아이콘 선택기
 * =============================== */
function buildAniSheetURL(mid){
  return `https://puppi.netlify.app/images/ani/${encodeURIComponent(mid)}.png`;
}

function makeMonsterIconFromData(d, sizePx, fallbackUrl){
  const s = Math.max(24, Number(sizePx) || 96);

  // 1) mid/animId 우선
  let mid = null;
  if (d && (d.mid != null || d.animId != null)) mid = String(d.mid ?? d.animId);

  // 2) 구버전: /images/mon/NN.png → NN 추출 (하위호환)
  if (!mid) {
    const src = d?.imagesURL || d?.imageURL || d?.iconURL || '';
    const m = String(src).match(/\/images\/mon\/(\d+)\.png$/i);
    if (m) mid = m[1];
  }

  // 3) 강제 비활성 플래그
  if (d && d.useAniFirst === false) mid = null;

  // 4) mid가 있으면 시트 첫 프레임 아이콘
  if (mid) {
    try {
      const sheetURL = buildAniSheetURL(mid);
      return makeAniFirstFrameIcon(sheetURL, { size: s, frames: 4 });
    } catch {
      // 실패 시 정적 폴백
    }
  }

  // 5) 폴백: 정적
  const url = d?.imagesURL || d?.imageURL || d?.iconURL || fallbackUrl || 'https://puppi.netlify.app/images/mon/30.png';
  return makeStaticIcon(url, s);
}

/* ===============================
 * RealTimeMonsters
 * =============================== */
export class RealTimeMonsters {
  constructor({
    db, map,
    makeImageDivIcon: mkImg = null, // (url, size, d)
    DEFAULT_IMG = 'https://puppi.netlify.app/images/mon/30.png',
    attachMonsterBattle,
    monstersGuard,
    pollMs = 3000,
    tileSizeDeg = 0.01,
    maxDocs = 60,
    useTiles = true,
    padDeg = 0.0006,
    moveDebounceMs = 400,
    epsilonM = 0.3
  }){
    this.db = db;
    this.map = map;
    this.makeImageDivIcon = mkImg || ((url, size, d)=> makeStaticIcon(url, size));
    this.DEFAULT_IMG = DEFAULT_IMG;
    this.attachMonsterBattle = (marker, id, d)=> attachMonsterBattle?.(marker, id, d || {});
    this.monstersGuard = monstersGuard;

    this.pollMs = Math.max(800, pollMs|0 || 3000);
    this.tileSizeDeg = Math.max(0.0025, tileSizeDeg || 0.01);
    this.maxDocs = Math.max(10, maxDocs|0 || 60);
    this.useTiles = !!useTiles;
    this.padDeg = padDeg;
    this.moveDebounceMs = Math.max(100, moveDebounceMs|0 || 400);
    this.epsilonM = Math.max(0.05, epsilonM || 0.3);

    this.reg = new Map();               // id -> { marker, data, sizePx, bound }
    this._pollTid = null;
    this._moveTid = null;
    this._started = false;
    this._lastTilesKey = '';
    this._lastIdsInView = new Set();

    this._onMoveEnd = this._onMoveEnd.bind(this);
    this._onZoomEnd = this._onZoomEnd.bind(this);
  }

  /* 외부에서 가시 리스트가 필요할 때 사용 */
  getVisibleMonsters(){
    const out = [];
    for (const [id, rec] of this.reg){
      if (!rec?.data) continue;
      out.push({ id, data: rec.data });
    }
    return out;
  }
  getMarkerById(id){
    const rec = this.reg.get(String(id));
    return rec ? rec.marker : null;
  }
  getMarker(id){
    const rec = this.reg?.get?.(String(id));
    return rec ? rec.marker : null;
  }

  /* 🔴 공격 정지 헬퍼: 어디서든 숨길 때 같이 호출 */
  _haltAttacks(id){
    try { this.monstersGuard?.stopAttacksFrom?.(String(id)); } catch {}
  }

  start(){
    if (this._started) return;
    this._started = true;
    try {
      this.map.on('moveend', this._onMoveEnd);
      this.map.on('zoomend', this._onZoomEnd);
      // 🔗 MonsterGuard가 현재 RT 인스턴스의 레지스트리를 쓸 수 있게 연결
      this.monstersGuard?.setSharedRegistry?.(this);
    } catch {}
    this._fetchOnce(true).catch(()=>{});
    this._pollTid = setInterval(()=> this._fetchOnce().catch(()=>{}), this.pollMs);
  }

  stop(){
    if (!this._started) return;
    this._started = false;
    if (this._pollTid) clearInterval(this._pollTid);
    if (this._moveTid) clearTimeout(this._moveTid);
    try { this.map.off('moveend', this._onMoveEnd); this.map.off('zoomend', this._onZoomEnd); } catch {}
    this.reg.forEach((rec, id)=>{
      this._haltAttacks(id);
      try { rec.marker.remove(); } catch {}
      try { this.map.removeLayer(rec.marker); } catch {}
      try { rec.marker.getElement()?.remove(); } catch {}
    });
    this.reg.clear();
    this._lastIdsInView.clear();
    this._lastTilesKey = '';
  }

  _onMoveEnd(){ this._debouncedFetch(); }
  _onZoomEnd(){ this._debouncedFetch(); }
  _debouncedFetch(){
    if (this._moveTid) clearTimeout(this._moveTid);
    this._moveTid = setTimeout(()=> this._fetchOnce(true).catch(()=>{}), this.moveDebounceMs);
  }

  _tileOf(lat, lon, g=this.tileSizeDeg){
    const fy = Math.floor(lat/g), fx = Math.floor(lon/g);
    return `${fy}_${fx}`;
  }
  _tilesFromBounds(bounds, g=this.tileSizeDeg){
    const sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    const y0=Math.floor(sw.lat/g), y1=Math.floor(ne.lat/g);
    const x0=Math.floor(sw.lng/g), x1=Math.floor(ne.lng/g);
    const tiles=[];
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
    if (tiles.length>10){
      try{
        const c=this.map.getCenter();
        const t=this._tileOf(c.lat,c.lng,g);
        tiles.sort((a,b)=>(a===t?-1:0)-(b===t?-1:0));
      }catch{}
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
    } else {
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

      // 1) 로컬 쿨다운(로컬 히든): 공격도 즉시 중지
      if (getLocalCooldownUntil(id) > now) {
        this._ensureHidden(id);
        this._haltAttacks(id);
        return;
      }

      // 2) 레거시 필드 기반 사망/리스폰 대기: 공격 중지 + 숨김
      const cd = Number(d.cooldownUntil || 0);
      const legacyDead = (d.dead === true) || (d.alive === false);
      const legacyResp = Number(d.respawnAt || 0);
      if (cd > now || (legacyDead && legacyResp > now)) {
        this._ensureHidden(id);
        this._haltAttacks(id);
        return;
      }

      // 3) MonsterGuard가 로컬로 처치 표시한 대상: 숨김 + 공격 중지
      if (this.monstersGuard?.killedLocal?.has?.(id)) {
        this._ensureHidden(id);
        this._haltAttacks(id);
        return;
      }

      nextIds.add(id);
      this._ensureShownOrUpdate(id, d);
    });

    // 4) 뷰에서 사라진(타일 범위 이탈) 아이들 정리 + 공격 중지
    if (this.useTiles){
      for (const id of this._lastIdsInView){
        if (!nextIds.has(id)) {
          this._ensureHidden(id);
          this._haltAttacks(id);
        }
      }
      this._lastIdsInView = nextIds;
    }
  }

  _ensureShownOrUpdate(id, d){
    // 방어: 서버 데이터에 사망 표시가 있으면 즉시 숨김 + 공격 정지
    if ((d.dead === true || d.alive === false) && Number(d.respawnAt || 0) > Date.now()){
      this._ensureHidden(id);
      this._haltAttacks(id);
      return;
    }

    const sizePx = this._sizeOf(d.size);
    let rec = this.reg.get(id);

    // ✅ mid 정책에 따라 아이콘 결정(평소 1프레임)
    const icon = makeMonsterIconFromData(d, sizePx, this.DEFAULT_IMG);

    if (!rec){
      const marker = L.marker([d.lat, d.lon], { icon, interactive:true }).addTo(this.map);
      rec = { marker, data:d, sizePx, bound:false };
      this.reg.set(id, rec);
      this.attachMonsterBattle(marker, id, d);
      rec.bound = true;
      return;
    }

    // 위치 보정
    try{
      const cur = rec.marker.getLatLng();
      const dist = this.map.distance(cur, L.latLng(d.lat, d.lon));
      if (dist > this.epsilonM) rec.marker.setLatLng([d.lat, d.lon]);
    }catch{
      try { rec.marker.setLatLng([d.lat, d.lon]); } catch {}
    }

    // 아이콘 교체 필요 여부
    const needSwap = this._iconKindChanged(rec.data, d) || (rec.sizePx !== sizePx);
    if (needSwap){
      rec.marker.setIcon(icon);
      rec.sizePx = sizePx;
      rec.bound = false;
    }
    rec.data = d;

    if (!rec.bound){
      this.attachMonsterBattle(rec.marker, id, d);
      rec.bound = true;
    }
  }

  _iconKindChanged(prev, next){
    const key = (x)=>{
      const mid = x?.mid ?? x?.animId ?? null;
      const off = x?.useAniFirst === false;
      return `${mid ?? ''}|${off ? 'off' : 'on'}`;
    };
    return key(prev) !== key(next);
  }

  _ensureHidden(id){
    const rec = this.reg.get(id);
    if (!rec) return;
    // 마커 자체에 남아있을 수 있는 전투 컨트롤도 비활성화 표시
    try { rec.marker._pf_dead = true; } catch {}
    try { rec.marker.remove(); } catch {}
    try { this.map.removeLayer(rec.marker); } catch {}
    try { rec.marker.getElement()?.remove(); } catch {}
    this.reg.delete(id);
  }

  _sizeOf(n){
    const v = Number(n);
    return Number.isNaN(v) ? 96 : Math.max(24, Math.min(v, 256));
  }
}
