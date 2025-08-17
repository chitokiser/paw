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
    renderMarkers = false,        // 여기서는 미사용. 항상 false 동작
    useTiles = true,
    maxDocs = 80,
    pollMs = 1200
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
    this.pollMs   = Math.max(600, pollMs|0);

    this._started = false;
    this._ready   = false;
    this._resume  = false;

    // 로컬 쿨다운(발사 쿨) 맵: id -> nextFireAt(ms)
    this._cool = new Map();

    // 로컬 처치 가드: id -> untilTs(ms)  (승리 시 markKilled로 즉시 무시)
    this._killed = new Map();

    // RT(RealTimeMonsters) 공유 레지스트리 (선택)
    // 기대 인터페이스: rt.getVisibleMonsters() → Array<{id, data}>
    this._rt = null;

    this._pollTid = null;
  }

  /* ========== 외부 API ========== */
  setUserReady(v){ this._ready = !!v; }
  resumeAudio(){ this._resume = true; } // 호환용 (사용 안함)

  /** RT 레지스트리 주입 (선택) */
  setSharedRegistry(rtInstance){ this._rt = rtInstance; }

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
    this._rt = null;
  }

  /** 로컬 처치 가드: ms 동안 자동공격 완전 무시 */
  markKilled(id, ms = 60_000){
    const k = String(id);
    const until = Date.now() + Math.max(1000, ms|0);
    this._killed.set(k, until);
    // 같은 기간 동안 발사 쿨도 밀어두면 중복 타격 더 안전
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

  /* ========== 내부 ========== */

  // ── 현재 뷰의 타일 키 계산 (monstersRT의 타일 전략과 일치)
  _tileSizeDeg(){ return 0.01; }
  _tileOf(lat, lon, g=this._tileSizeDeg()){
    const fy = Math.floor(lat/g), fx = Math.floor(lon/g);
    return `${fy}_${fx}`;
  }
  _tilesFromBounds(bounds, g=this._tileSizeDeg()){
    const sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    const y0=Math.floor(sw.lat/g), y1=Math.floor(ne.lat/g);
    const x0=Math.floor(sw.lng/g), x1=Math.floor(ne.lng/g);
    const tiles=[];
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) tiles.push(`${y}_${x}`);
    // Firestore where-in 은 최대 10개 제한 → 10개만 사용
    return tiles.slice(0, 10);
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

  /** 공통 스킵 판정: DB/RT 공통 */
  _shouldSkip(id, d, now){
    // 필수 좌표
    if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon)) return true;

    // 비전투 대상 즉시 스킵
    if (!this._isHostile(d)) return true;

    // 로컬 처치 가드: 승리 직후/쿨다운 동안 완전 무시
    if (this.isKilled(id)) return true;

    // 서버 쿨다운: cooldownUntil 존중
    const cdUntil = Number(d.cooldownUntil || 0);
    if (cdUntil > now) return true;

    // 레거시 alive/dead/respawnAt 호환(보여주는 로직과 동일하게)
    const legacyDead = (d.dead === true) || (d.alive === false);
    const legacyResp = Number(d.respawnAt || 0);
    const hiddenByLegacy = legacyDead && legacyResp > now;
    if (hiddenByLegacy) return true;

    return false;
  }

  // ── 핵심 루프: 뷰포트 내 몬스터 가져와 사거리/쿨다운 판정
  async _tick(){
    if (!this._ready || !this.map) return;

    // 1) 후보 몬스터 목록 가져오기
    let mons = [];
    const now = Date.now();

    // 로컬 처치 가드 청소
    for (const [id, until] of this._killed) {
      if (until <= now) this._killed.delete(id);
    }

    if (this._rt?.getVisibleMonsters) {
      // RT 경로: 화면에 보이는 마커 집합을 그대로 사용 (DB 추가 읽기 없음)
      const arr = this._rt.getVisibleMonsters();
      if (Array.isArray(arr)) {
        mons = arr.map(x => ({ id: x.id, data: x.data || x }));
      } else if (arr && typeof arr === 'object') {
        mons = Object.entries(arr).map(([id, data]) => ({ id, data }));
      }
    } else {
      // (백업) 타일 기반 Firestore 읽기 — RT가 없을 때만
      if (!this.db || !this.useTiles) return;
      const tiles = this._tilesFromBounds(this.map.getBounds());
      if (!tiles.length) return;
      try {
        const qRef = query(
          collection(this.db,'monsters'),
          where('tile','in', tiles),
          limit(this.maxDocs)
        );
        const snap = await getDocs(qRef);
        snap.forEach(ds=>{
          const d = ds.data() || {};
          const id = ds.id;
          if (this._shouldSkip(id, d, now)) return;
          mons.push({ id, data: d });
        });
      } catch (e) {
        console.warn('[MonsterGuard] Firestore fallback query failed', e);
        return;
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

      if (this._shouldSkip(id, d, now)) continue;

      const range  = Number(d.range || this.rangeDefault);

      // ⚠️ damage를 강제로 1 이상으로 만들지 말고 실제 값/기본값을 그대로 사용
      const baseDamage = Number.isFinite(Number(d.damage)) ? Number(d.damage) : this.damageDefault;
      if (baseDamage <= 0) continue; // 안전장치: 0 이하면 공격하지 않음

      const cdMs   = Math.max(200, Number(d.cooldownMs || this.fireCooldownMs));

      const nextAt = this._cool.get(id) || 0;
      if (now < nextAt) continue; // 로컬 발사 쿨다운 중

      try{
        const mLL = L.latLng(d.lat, d.lon);
        const dist = this.map.distance(uLL, mLL);
        if (dist <= range){
          // 타격!
          this._cool.set(id, now + cdMs);
          try {
            this.onUserHit(baseDamage, { id, lat: d.lat, lon: d.lon, range, damage: baseDamage, cooldownMs: cdMs });
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
