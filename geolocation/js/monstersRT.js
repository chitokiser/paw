// /geolocation/js/monstersRT.js
// 화면에 “보이는” 몬스터만 마커로 렌더링 + 전투 바인딩
// (DB 쓰기는 하지 않으며, 로컬 쿨다운/처치 상태를 존중)

import {
  collection, query, where, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { makeAniFirstFrameIcon } from './fx.js';

function buildAniSheetURL(mid){
  return `https://puppi.netlify.app/images/ani/${encodeURIComponent(mid)}.png`;
}

export class RealTimeMonsters {
  constructor({ db, map, attachMonsterBattle, monstersGuard, maxDocs = 120, pollMs = 1200 }){
    this.db = db;
    this.map = map;
    this.attachMonsterBattle = attachMonsterBattle;
    this.monstersGuard = monstersGuard;
    this.maxDocs = Math.max(40, maxDocs|0);
    this.pollMs = Math.max(600, pollMs|0);

    this._started = false;
    this._timer = null;

    // id -> { id, data, marker }
    this._vis = new Map();

    // 외부에서 참조할 수 있는 "가시 몬스터" 뷰
    this.getVisibleMonsters = () => {
      return Array.from(this._vis.values()).map(v => ({ id: v.id, data: v.data }));
    };
  }

  start(){
    if (this._started) return;
    this._started = true;
    // MonsterGuard가 RT를 참고하도록 연결
    try { this.monstersGuard?.setSharedRegistry?.(this); } catch {}
    this._tick().catch(()=>{});
    this._timer = setInterval(()=> this._tick().catch(()=>{}), this.pollMs);
  }

  stop(){
    if (!this._started) return;
    this._started = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  destroy(){
    this.stop();
    for (const { marker } of this._vis.values()){
      try { this.map.removeLayer(marker); } catch {}
    }
    this._vis.clear();
  }

  _tileSizeDeg(){ return 0.01; }
  _tilesFromBounds(bounds, g=this._tileSizeDeg()){
    const sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    const y0=Math.floor(sw.lat/g), y1=Math.floor(ne.lat/g);
    const x0=Math.floor(sw.lng/g), x1=Math.floor(ne.lng/g);
    const tiles=[];
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
    return tiles.slice(0, 10); // where-in 10개 제한
  }

  _num(v){ const n = Number(v); return Number.isFinite(n) ? n : NaN; }
  _coerceLatLon(d){
    const lat = this._num(d.lat);
    let  lon = this._num(d.lon);
    if (!Number.isFinite(lon)) lon = this._num(d.lng);
    return { lat, lon };
  }

  _isLocallyCooling(id){
    const until = Number(localStorage.getItem('mon_cd:' + id) || 0);
    return Date.now() < until;
  }

  _shouldHide(d){
    // 보물/비전투
    if (d.type === 'treasure') return true;
    if (d.isHostile === false) return true;

    // 서버 쿨/리젠 기다림
    const now = Date.now();
    if (Number(d.cooldownUntil||0) > now) return true;
    if (Number.isFinite(Number(d.hitsLeft)) && Number(d.hitsLeft) <= 0) return true;

    // 레거시 alive/dead
    if (d.dead === true || d.alive === false) {
      const resp = Number(d.respawnAt||0);
      if (resp > now) return true;
    }
    return false;
  }

  async _fetchDB(bounds){
    if (!this.db) return [];
    const tiles = this._tilesFromBounds(bounds);
    const out = [];
    if (tiles.length){
      const snap = await getDocs(query(
        collection(this.db,'monsters'),
        where('tile','in', tiles),
        limit(this.maxDocs)
      ));
      snap.forEach(ds => out.push({ id: ds.id, data: ds.data() || {} }));
    } else {
      const snap = await getDocs(query(collection(this.db,'monsters'), limit(this.maxDocs)));
      snap.forEach(ds => out.push({ id: ds.id, data: ds.data() || {} }));
    }
    return out;
  }

  async _tick(){
    if (!this.map) return;
    const b = this.map.getBounds(); if (!b) return;
    const now = Date.now();

    let candidates = [];
    try { candidates = await this._fetchDB(b); } catch (e) { console.warn('[RT] fetch error', e); }

    const keep = new Set();

    for (const m of candidates){
      const id = String(m.id);
      const d0 = m.data || {};
      const { lat, lon } = this._coerceLatLon(d0);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      // 로컬 쿨다운/처치 및 정책상 숨김
      if (this._isLocallyCooling(id)) continue;
      if (this._shouldHide(d0)) continue;

      // 이미 있고 위치 변화 없으면 유지
      const exist = this._vis.get(id);
      if (exist) {
        keep.add(id);
        continue;
      }

      // 신규 생성
      const mid = d0.mid ?? d0.mId ?? d0.animId ?? 1;
      const icon = makeAniFirstFrameIcon(mid, { size: 88, basePath: 'https://puppi.netlify.app/images/ani/' });
      const marker = L.marker([lat, lon], { icon, interactive: true, zIndexOffset: 5000 });
      marker._pf_dead = false;

      marker.addTo(this.map);
      // 전투 바인딩
      try {
        this.attachMonsterBattle(marker, id, {
          lat, lon, mid,
          power: Number.isFinite(+d0.power) ? +d0.power : 20,
          hp: Number.isFinite(+d0.hitsLeft) ? +d0.hitsLeft : undefined,
          cooldownMs: Number.isFinite(+d0.cooldownMs) ? +d0.cooldownMs : 2000,
          approachMaxM: Number.isFinite(+d0.approachMaxM) ? +d0.approachMaxM : 10,
          meleeRange: Number.isFinite(+d0.meleeRange) ? +d0.meleeRange : 1.6,
          approachSpeedMps: Number.isFinite(+d0.approachSpeedMps) ? +d0.approachSpeedMps : 6.2,
          critChance: Number.isFinite(+d0.critChance) ? +d0.critChance : 0.3
        });
      } catch (e) {
        console.warn('[RT] attach battle fail', e);
      }

      this._vis.set(id, { id, data: { ...d0, lat, lon }, marker });
      keep.add(id);
    }

    // 보존되지 않은 마커 정리
    for (const [id, rec] of this._vis){
      if (!keep.has(id) || this._isLocallyCooling(id) || this._shouldHide(rec.data)) {
        try { this.map.removeLayer(rec.marker); } catch {}
        this._vis.delete(id);
      }
    }
  }
}

export default RealTimeMonsters;
