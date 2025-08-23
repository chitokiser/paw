// /geolocation/js/monstersRT.js
import { collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { makeAniFirstFrameIcon, attachSpriteToMarker } from './fx.js'; // ✅ 첫 프레임 + 스프라이트 오버레이

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
  return L.divIcon({ className:'', html, iconSize:[s,s], iconAnchor:[s/2,s] });
}

/* ===============================
 * mid 기반 시트 URL
 * =============================== */
let ANI_BASE = 'https://puppi.netlify.app/images/ani/';
function buildAniSheetURL(mid){
  return `${ANI_BASE}${encodeURIComponent(mid)}.png`;
}

/* ===============================
 * 첫 프레임 아이콘 선택
 * =============================== */
function makeMonsterIconFromData(d, sizePx, fallbackUrl){
  const s = Math.max(24, Number(sizePx) || 96);

  // 1) mid/animId 우선
  let mid = null;
  if (d && (d.mid != null || d.animId != null)) mid = String(d.mid ?? d.animId);

  // 2) 구버전 경로에서 숫자 추출
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
      return makeAniFirstFrameIcon(mid, { size: s, frames: 4, basePath: ANI_BASE });
    } catch { /* 폴백 아래로 */ }
  }

  // 5) 정적 폴백
  const url = d?.imagesURL || d?.imageURL || d?.iconURL || fallbackUrl || 'https://puppi.netlify.app/images/mon/30.png';
  return makeStaticIcon(url, s);
}

/* ===============================
 * RealTimeMonsters
 *  - ✅ “제자리 고정 프레임 전환” 애니메이션
 *  - ✅ 거리 기반 재생/정지 + FPS 옵션
 * =============================== */
export class RealTimeMonsters {
  constructor({
    db, map,
    DEFAULT_IMG = 'https://puppi.netlify.app/images/mon/30.png',
    attachMonsterBattle,
    monstersGuard,

    // ── 로딩/타일
    pollMs = 3000,
    tileSizeDeg = 0.01,
    maxDocs = 60,
    useTiles = true,
    padDeg = 0.0006,
    moveDebounceMs = 400,
    epsilonM = 0.3,

    // ── 🎞 애니메이션 정책(거리 기반 트리거)
    // 가까워지면 start, 멀어지면 stop. stopHalfway=true면 멀어질 때 절반 FPS로 슬로우 재생.
    anim = {
      frames: 4,             // 시트 프레임 수(가로 4컷)
      frameW: 200,
      frameH: 200,
      nearStartM: 10,        // 이 거리 이내면 재생 시작
      nearStopM: 20,         // 이 거리 바깥이면 정지(히스테리시스)
      fpsNear: 10,           // 가까울 때 FPS
      fpsFar: 0,             // 멀 때 FPS(0=정지)
      stopHalfway: false     // 멀어질 때 fpsFar>0으로 슬로우 유지
    }
  }){
    this.db = db;
    this.map = map;
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

    // 🎞 애니 정책
    this.anim = {
      frames: Math.max(1, anim.frames|0 || 4),
      frameW: Math.max(1, anim.frameW|0 || 200),
      frameH: Math.max(1, anim.frameH|0 || 200),
      nearStartM: Math.max(1, Number(anim.nearStartM ?? 18)),
      nearStopM:  Math.max(1, Number(anim.nearStopM  ?? 22)),
      fpsNear:    Math.max(0, Number(anim.fpsNear    ?? 10)),
      fpsFar:     Math.max(0, Number(anim.fpsFar     ?? 0)),
      stopHalfway: !!anim.stopHalfway
    };

    this.reg = new Map();               // id -> { marker, data, sizePx, bound, animHandle, animState }
    this._pollTid = null;
    this._moveTid = null;
    this._started = false;
    this._lastTilesKey = '';
    this._lastIdsInView = new Set();

    this._onMoveEnd = this._onMoveEnd.bind(this);
    this._onZoomEnd = this._onZoomEnd.bind(this);
  }

  /** 현재 보이는 몬스터 id/data 목록 */
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

  start(){
    if (this._started) return;
    this._started = true;
    try {
      this.map.on('moveend', this._onMoveEnd);
      this.map.on('zoomend', this._onZoomEnd);
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
    this.reg.forEach(rec=>{
      // 🎞 애니 제거
      try { rec.animHandle?.stop?.(); } catch {}
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

      // 로컬 쿨다운 (DB 쓰기 없이 숨김)
      if (getLocalCooldownUntil(id) > now) return;

      // 레거시 숨김 조건
      const cd = Number(d.cooldownUntil || 0);
      const legacyDead = (d.dead === true) || (d.alive === false);
      const legacyResp = Number(d.respawnAt || 0);
      if (cd > now || (legacyDead && legacyResp > now)) return;

      // (선택) 가드의 로컬 처치셋
      if (this.monstersGuard?.killedLocal?.has?.(id)) { this._ensureHidden(id); return; }

      nextIds.add(id);
      this._ensureShownOrUpdate(id, d);
    });

    if (this.useTiles){
      for (const id of this._lastIdsInView){
        if (!nextIds.has(id)) this._ensureHidden(id);
      }
      this._lastIdsInView = nextIds;
    }
  }

  _ensureShownOrUpdate(id, d){
    const sizePx = this._sizeOf(d.size);
    let rec = this.reg.get(id);

    const icon = makeMonsterIconFromData(d, sizePx, this.DEFAULT_IMG);

    if (!rec){
      const marker = L.marker([d.lat, d.lon], { icon, interactive:true, zIndexOffset:5000 }).addTo(this.map);
      rec = {
        marker,
        data:d,
        sizePx,
        bound:false,
        animHandle:null,          // ⚡ 현재 재생 중인 애니 핸들(attachSpriteToMarker 반환)
        animState:'stopped'       // 'playing' | 'slowed' | 'stopped'
      };
      this.reg.set(id, rec);
      this.attachMonsterBattle(marker, id, d);
      rec.bound = true;

      // 최초 상태에 맞춰 애니 갱신
      this._updateAnimState(rec);
      return;
    }

    // 위치 보정(아이콘은 “제자리 프레임 전환”이라 위치 변화 없음)
    try{
      const cur = rec.marker.getLatLng();
      const dist = this.map.distance(cur, L.latLng(d.lat, d.lon));
      if (dist > this.epsilonM) rec.marker.setLatLng([d.lat, d.lon]);
    }catch{
      try { rec.marker.setLatLng([d.lat, d.lon]); } catch {}
    }

    // 아이콘 교체 필요 여부( mid/useAniFirst/사이즈 변경 감지 )
    const needSwap = this._iconKindChanged(rec.data, d) || (rec.sizePx !== sizePx);
    if (needSwap){
      rec.marker.setIcon(icon);
      rec.sizePx = sizePx;
      rec.bound = false;
      // 아이콘이 바뀌면 애니 메모도 초기화
      try { rec.animHandle?.stop?.(); } catch {}
      rec.animHandle = null;
      rec.animState = 'stopped';
    }
    rec.data = d;

    if (!rec.bound){
      this.attachMonsterBattle(rec.marker, id, d);
      rec.bound = true;
    }

    // 매 프레임(폴링/이동 시) 거리 기반 애니 갱신
    this._updateAnimState(rec);
  }

  _iconKindChanged(prev, next){
    const key = (x)=>{
      const mid = x?.mid ?? x?.animId ?? null;
      const off = x?.useAniFirst === false;
      return `${mid ?? ''}|${off ? 'off' : 'on'}|${x?.size ?? ''}`;
    };
    return key(prev) !== key(next);
  }

  _ensureHidden(id){
    const rec = this.reg.get(id);
    if (!rec) return;
    try { rec.animHandle?.stop?.(); } catch {}
    try { rec.marker.remove(); } catch {}
    try { this.map.removeLayer(rec.marker); } catch {}
    try { rec.marker.getElement()?.remove(); } catch {}
    this.reg.delete(id);
  }

  _sizeOf(n){
    const v = Number(n);
    return Number.isNaN(v) ? 96 : Math.max(24, Math.min(v, 256));
  }

  /* =========================================
   * 🎞 거리 기반 애니메이션 상태 갱신
   *  - 마커는 고정, 내부 스프라이트 프레임만 전환
   *  - attachSpriteToMarker(once:false) 루프 사용
   * ========================================= */
  _updateAnimState(rec){
    if (!rec?.marker || !rec?.data) return;

    const userLL = this._getUserLatLng();
    if (!userLL) { this._stopAnim(rec); return; }

    const mLL = rec.marker.getLatLng();
    const dist = this.map.distance(userLL, mLL);

    const { nearStartM, nearStopM, fpsNear, fpsFar, frames, frameW, frameH, stopHalfway } = this.anim;
    const mid = rec.data.mid ?? rec.data.animId ?? null;

    // mid가 없으면 애니 수행 안 함
    if (mid == null) { this._stopAnim(rec); return; }

    // 1) 근접 시작
    if (dist <= nearStartM){
      const targetFPS = Math.max(1, fpsNear|0);
      if (rec.animState !== 'playing' || !rec.animHandle){
        this._playAnim(rec, { fps: targetFPS, frames, frameW, frameH });
        rec.animState = 'playing';
      } else {
        // 이미 재생 중이면 FPS만 맞춰줌
        this._retimeAnim(rec, targetFPS);
      }
      return;
    }

    // 2) 멀어짐 → 정지 또는 슬로우 유지
    if (dist >= nearStopM){
      if (stopHalfway && fpsFar > 0){
        // 슬로우 루프 유지
        if (rec.animState !== 'slowed' || !rec.animHandle){
          this._playAnim(rec, { fps: Math.max(1, fpsFar|0), frames, frameW, frameH });
          rec.animState = 'slowed';
        } else {
          this._retimeAnim(rec, Math.max(1, fpsFar|0));
        }
      } else {
        // 완전 정지(첫 프레임 상태 유지)
        this._stopAnim(rec);
      }
      return;
    }

    // 3) 히스테리시스 사이(nearStartM < d < nearStopM): 현재 상태 유지
  }

  _getUserLatLng(){
    try {
      if (typeof this.monstersGuard?.getUserLatLng === 'function'){
        const arr = this.monstersGuard.getUserLatLng();
        if (Array.isArray(arr) && arr.length >= 2){
          return L.latLng(arr[0], arr[1]);
        }
      }
    } catch {}
    return null;
  }

  _playAnim(rec, { fps, frames, frameW, frameH }){
    // 기존 애니 제거
    try { rec.animHandle?.stop?.(); } catch {}
    rec.animHandle = null;

    const mid = rec.data.mid ?? rec.data.animId ?? null;
    if (mid == null) return;

    // 마커 표시 폭 기준으로 자동 스케일(고정 위치)
    const iconSize = rec.marker?.options?.icon?.options?.iconSize || [frameW, frameH];
    const targetW  = Number(iconSize[0]) || frameW;
    const scale    = targetW / frameW;

    // attachSpriteToMarker는 마커 내부에 절대배치되고, background-position만 바뀜 → “자리 고정”
    const url = buildAniSheetURL(mid);
    rec.animHandle = attachSpriteToMarker(
      rec.marker,
      { url, frames, frameW, frameH, once:false, fps },
      { scale, classNameExtra:'mon-loop' }
    );
  }

  _retimeAnim(rec, nextFPS){
    // 간단 버전: FPS 변경 시 재부착
    if (!rec?.animHandle) return;
    try { rec.animHandle.stop(); } catch {}
    rec.animHandle = null;

    const mid = rec.data.mid ?? rec.data.animId ?? null;
    if (mid == null) return;

    const { frames, frameW, frameH } = this.anim;
    const iconSize = rec.marker?.options?.icon?.options?.iconSize || [frameW, frameH];
    const targetW  = Number(iconSize[0]) || frameW;
    const scale    = targetW / frameW;
    const url = buildAniSheetURL(mid);

    rec.animHandle = attachSpriteToMarker(
      rec.marker,
      { url, frames, frameW, frameH, once:false, fps: Math.max(1, nextFPS|0) },
      { scale, classNameExtra:'mon-loop' }
    );
  }

  _stopAnim(rec){
    if (!rec) return;
    if (rec.animHandle){
      try { rec.animHandle.stop(); } catch {}
      rec.animHandle = null;
    }
    rec.animState = 'stopped';
    // 아이콘은 그대로(첫 프레임). 위치도 그대로.
  }
}
