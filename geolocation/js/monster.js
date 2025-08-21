// /geolocation/js/monster.js
// DB 쓰기 없이(읽기 최소화) 자동 공격만 담당하는 가드

import { collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export class MonsterGuard {
  constructor({
    map, db,
    rangeDefault = 50,
    damageDefault = 1,
    fireCooldownMs = 1800,
    getUserLatLng = () => [0,0],
    onUserHit = () => {},
    renderMarkers = false,        // 여기서는 미사용. 항상 false
    useTiles = true,
    maxDocs = 80,
    pollMs = 1200,
    planBMaxDocs = 120,           // 타일없는 Plan-B에서 최대 로드 수
    staleMs = 4000                // 후보 최신성 완충(특히 RT 미사용 시)
  }){
    this.map = map;
    this.db = db;
    this.rangeDefault = rangeDefault;
    this.damageDefault = damageDefault;
    this.fireCooldownMs = Math.max(400, fireCooldownMs|0);
    this.getUserLatLng = getUserLatLng;
    this.onUserHit = onUserHit;

    this.useTiles = !!useTiles;
    this.maxDocs  = Math.max(20, maxDocs|0);
    this.planBMaxDocs = Math.max(this.maxDocs, planBMaxDocs|0);
    this.pollMs   = Math.max(600, pollMs|0);
    this.staleMs  = Math.max(this.pollMs * 2, staleMs|0);

    this._started = false;
    this._ready   = false;

    // 로컬 발사 쿨다운: id -> nextFireAt(ms)
    this._cool = new Map();

    // 로컬 처치 가드: id -> untilTs(ms)  (승리 시 markKilled로 즉시 무시)
    this._killed = new Map();

    // RT(RealTimeMonsters) 공유 레지스트리 (선택)
    // 기대 인터페이스: rt.getVisibleMonsters() → Array<{id, data}> 또는 { [id]: data }
    this._rt = null;

    // (DB 경로일 때) 최근 관측 시각
    this._lastSeenAt = new Map(); // id -> ts(ms)

    this._pollTid = null;

    // 전역 디버그(선택)
    if (!window.__monGuard) {
      window.__monGuard = {
        start: ()=>this.start(),
        stop:  ()=>this.stop(),
        tick:  ()=>this.tickOnce(),
        kill:  (id,ms)=>this.markKilled(id,ms),
        cool:  (id,ms)=>this.stopAttacksFrom(id,ms),
      };
    }
  }

  /* ========== 외부 API ========== */
  setUserReady(v){ this._ready = !!v; }
  resumeAudio(){ /* 호환용 noop */ }

  /** RT 레지스트리 주입 (선택) */
  setSharedRegistry(rtInstance){ this._rt = rtInstance; }

  /** 외부에서 로컬 처치셋을 참고할 수 있도록 getter 공개 */
  get killedLocal(){ return this._killed; }

  /** 시작/정지/파기 */
  start(){
    if (this._started) return;
    this._started = true;
    this._pollTid = setInterval(()=> this._tick().catch(()=>{}), this.pollMs);
    this._tick().catch(()=>{});
  }
  stop(){
    if (!this._started) return;
    this._started = false;
    if (this._pollTid) clearInterval(this._pollTid);
    this._pollTid = null;
  }
  destroy(){
    this.stop();
    this._cool.clear();
    this._killed.clear();
    this._lastSeenAt.clear();
    this._rt = null;
  }

  /** 한 번만 강제 실행(디버그) */
  async tickOnce(){ return this._tick(); }

  /** 로컬 처치 가드: ms 동안 자동공격 완전 무시 (+발사 쿨도 동일 기간) */
  markKilled(id, ms = 60_000){
    const k = String(id);
    const until = Date.now() + Math.max(1000, ms|0);
    this._killed.set(k, until);
    this._cool.set(k, until);
  }
  /** 로컬 처치 가드 확인 */
  isKilled(id){
    const until = this._killed.get(String(id));
    return until != null && until > Date.now();
  }
  /** (옵션) 특정 몬스터의 공격을 당분간 끊고 싶을 때 */
  stopAttacksFrom(id, ms = 30_000){
    const until = Date.now() + Math.max(1000, ms|0);
    this._cool.set(String(id), until);
  }

  /* ========== 내부 유틸 ========== */
  _tileSizeDeg(){ return 0.01; }
  _tilesFromBounds(bounds, g=this._tileSizeDeg()){
    const sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    const y0=Math.floor(sw.lat/g), y1=Math.floor(ne.lat/g);
    const x0=Math.floor(sw.lng/g), x1=Math.floor(ne.lng/g);
    const tiles=[];
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
    // Firestore where-in 은 최대 10개 제한 → 10개만 사용
    return tiles.slice(0, 10);
  }

  _num(v){ const n = Number(v); return Number.isFinite(n) ? n : NaN; }
  _coerceLatLon(d){
    const lat = this._num(d.lat);
    let  lon = this._num(d.lon);
    if (!Number.isFinite(lon)) lon = this._num(d.lng);
    return { lat, lon };
  }

  /** 적대 대상 여부 판단 (보물/비전투는 false) */
  _isHostile(d){
    // 명시 플래그 우선
    if (d.isHostile === false) return false;
    // 보물박스는 절대 공격하지 않음
    if (d.type === 'treasure') return false;
    // 공격력/피해가 0 이하라면 비전투
    const atk = Number(d.attack);
    if (Number.isFinite(atk) && atk <= 0) return false;
    const dmg = Number(d.damage);
    if (Number.isFinite(dmg) && dmg <= 0) return false;
    // canAttack 명시적 차단
    if (d.canAttack === false) return false;
    return true;
  }

  /** 공통 스킵 판정: RT/DB 공통 */
  _shouldSkip(id, d, now){
    const {lat, lon} = this._coerceLatLon(d);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;

    // 비전투 대상
    if (!this._isHostile(d)) return true;

    // 로컬 처치 가드
    if (this.isKilled(id)) return true;

    // 서버 쿨다운: cooldownUntil 존중
    const cdUntil = Number(d.cooldownUntil || 0);
    if (cdUntil > now) return true;

    // hitsLeft(남은 HP/히트수) 0 이하면 제외
    if (Number.isFinite(Number(d.hitsLeft)) && Number(d.hitsLeft) <= 0) return true;

    // legacy alive/dead/respawnAt
    const legacyDead = (d.dead === true) || (d.alive === false);
    const legacyResp = Number(d.respawnAt || 0);
    if (legacyDead && legacyResp > now) return true;

    return false;
  }

  _bboxFromMap(marginM=0){
    const b = this.map.getBounds();
    if (!b) return null;
    const sw=b.getSouthWest(), ne=b.getNorthEast();
    if (!marginM) return { minLat:sw.lat, maxLat:ne.lat, minLon:sw.lng, maxLon:ne.lng };
    // 간단한 확장(1도≈111km)
    const d = marginM / 111000;
    return { minLat:sw.lat-d, maxLat:ne.lat+d, minLon:sw.lng-d, maxLon:ne.lng+d };
  }

  _inBox(lat, lon, box){
    return lat>=box.minLat && lat<=box.maxLat && lon>=box.minLon && lon<=box.maxLon;
  }

  async _fetchCandidatesByTiles(now){
    const tiles = this._tilesFromBounds(this.map.getBounds());
    if (!tiles.length) return [];
    const qRef = query(
      collection(this.db,'monsters'),
      where('tile','in', tiles),
      limit(this.maxDocs)
    );
    const out = [];
    const snap = await getDocs(qRef);
    snap.forEach(ds=>{
      const d = ds.data() || {};
      const id = ds.id;
      if (this._shouldSkip(id, d, now)) return;
      out.push({ id, data: d });
      this._lastSeenAt.set(String(id), now);
    });
    return out;
  }

  async _fetchCandidatesPlanB(now){
    // 타일 필드 없거나 쿼리 실패/빈 결과일 때: 일부만 로드하여 클라이언트 BBOX 필터
    const box = this._bboxFromMap(150); // 150m 여유
    if (!box) return [];
    const out = [];
    const snap = await getDocs(query(collection(this.db,'monsters'), limit(this.planBMaxDocs)));
    snap.forEach(ds=>{
      const d0 = ds.data() || {};
      const id = ds.id;
      if (this._shouldSkip(id, d0, now)) return;
      const {lat, lon} = this._coerceLatLon(d0);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (!this._inBox(lat, lon, box)) return;
      out.push({ id, data: { ...d0, lat, lon } });
      this._lastSeenAt.set(String(id), now);
    });
    return out;
  }

  /** id가 최근 일정 시간 관측되지 않았다면 스킵(특히 DB 경로에서 중요) */
  _isStale(id, now){
    const seen = this._lastSeenAt.get(String(id)) || 0;
    return seen === 0 ? false : (now - seen > this.staleMs);
  }

  // ── 핵심 루프: 후보 가져와 사거리/쿨다운 판정
  async _tick(){
    if (!this._ready || !this.map) return;

    const now = Date.now();
    // 로컬 처치 가드 청소
    for (const [id, until] of this._killed) {
      if (until <= now) this._killed.delete(id);
    }

    // 1) 후보 몬스터 목록
    let mons = [];
    if (this._rt?.getVisibleMonsters) {
      // ✅ RT 경로: 화면에 보이는 마커 집합만 사용 (DB 추가 읽기 없음)
      const arr = this._rt.getVisibleMonsters();
      if (Array.isArray(arr)) mons = arr.map(x => ({ id: x.id, data: x.data || x }));
      else if (arr && typeof arr === 'object') mons = Object.entries(arr).map(([id, data]) => ({ id, data }));
      // RT가 소스일 때는 DB 최신성 체크 대신 RT 가시성에 전적으로 따름
    } else if (this.db) {
      try {
        if (this.useTiles) {
          mons = await this._fetchCandidatesByTiles(now);
          if (!mons.length) {
            // 타일 쿼리 결과가 없으면 Plan-B 시도
            mons = await this._fetchCandidatesPlanB(now);
          }
        } else {
          mons = await this._fetchCandidatesPlanB(now);
        }
      } catch (e) {
        console.warn('[MonsterGuard] query error, trying plan-B', e);
        try { mons = await this._fetchCandidatesPlanB(now); } catch{}
      }
    }

    if (!mons.length) return;

    // 2) 유저 위치
    const [ulLat, ulLon] = this.getUserLatLng() || [];
    if (!Number.isFinite(ulLat) || !Number.isFinite(ulLon)) return;
    const uLL = L.latLng(ulLat, ulLon);

    // 3) 각 몬스터에 대해 사거리 & 로컬 쿨다운 판정
    for (const m of mons){
      const id = String(m.id);
      const d  = m.data || {};
      const {lat, lon} = this._coerceLatLon(d);

      if (this._shouldSkip(id, d, now)) continue;

      // DB 경로일 때: 오래 관측 안 된 후보는 방어적으로 스킵
      if (!this._rt && this._isStale(id, now)) continue;

      const range  = Number(d.range || this.rangeDefault);

      // 실제 값/기본값 사용. 0 이하면 공격하지 않음
      const baseDamage = Number.isFinite(Number(d.damage)) ? Number(d.damage) : this.damageDefault;
      if (baseDamage <= 0) continue;

      const cdMs   = Math.max(200, Number(d.cooldownMs || this.fireCooldownMs));

      const nextAt = this._cool.get(id) || 0;
      if (now < nextAt) continue; // 로컬 발사 쿨다운 중

      try{
        const mLL = L.latLng(lat, lon);
        const dist = this.map.distance(uLL, mLL);
        if (dist <= range){
          // 타격!
          this._cool.set(id, now + cdMs);
          try {
            // onUserHit(damage, meta)
            this.onUserHit(baseDamage, { id, lat, lon, range, damage: baseDamage, cooldownMs: cdMs, dist });
          } catch (e) {
            // onUserHit 에러가 나더라도 쿨다운은 유지
            console.warn('[MonsterGuard] onUserHit error', e);
          }
        }
      } catch (e) {
        console.warn('[MonsterGuard] distance/latlng error', e);
      }
    }
  }
}

export default MonsterGuard;
