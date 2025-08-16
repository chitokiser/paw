// /geolocation/js/monster.js — 자동 공격형 몬스터 가드(읽기 최적화 버전)
// 사용 예:
// monstersGuard = new MonsterGuard({
//   map, db,
//   iconUrl: "https://puppi.netlify.app/images/mon/monster.png",
//   rangeDefault: 50,
//   fireCooldownMs: 1800,
//   getUserLatLng: () => [userLat, userLon],
//   onUserHit: (damage, monInfo) => { /* HP 차감 등 */ },
//   renderMarkers: false,
//   // 🔧 읽기 최적화 옵션 (필요 시 조정)
//   pollMs: 2500,      // 폴링 주기(ms)
//   tileSizeDeg: 0.01, // 타일 그리드 간격(위경도도 단위)
//   maxDocs: 60,       // 한 번에 가져올 최대 문서 수
//   useTiles: true     // monsters 문서에 'tile' 필드가 있을 때 true 권장
// });

import {
  collection, query, where, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export class MonsterGuard {
  constructor({
    map,
    db,
    iconUrl = "https://puppi.netlify.app/images/mon/monster.png",
    rangeDefault = 50,
    fireCooldownMs = 1800,
    getUserLatLng,          // ()=>[lat, lon]
    onUserHit = ()=>{},     // (damage, monInfo)=>void
    onImpact = null,        // (damage, monInfo)=>void (선택)
    renderMarkers = false,  // 기본 false
    // 🔧 읽기 최적화 옵션
    pollMs = 2500,
    tileSizeDeg = 0.01,
    maxDocs = 60,
    useTiles = true
  }){
    this.map = map;
    this.db = db;
    this.iconUrl = iconUrl;
    this.rangeDefault = rangeDefault;
    this.fireCooldownMs = fireCooldownMs;
    this.getUserLatLng = getUserLatLng;
    this.onUserHit = onUserHit;
    this.onImpact = onImpact;
    this.renderMarkers = !!renderMarkers;

    // 읽기 최적화 설정
    this.pollMs = Math.max(800, Number(pollMs)||2500);
    this.tileSizeDeg = Math.max(0.0025, Number(tileSizeDeg)||0.01);
    this.maxDocs = Math.max(10, Number(maxDocs)||60);
    this.useTiles = !!useTiles;

    // id -> {id, lat, lon, range, damage, cooldownMs, marker?, circle?, lastFire, alive}
    this.mons = new Map();
    // 처치 즉시 공격 중단을 위한 로컬 플래그
    this.killedLocal = new Set();

    this._userReady = false;
    this._ac = null;

    // 읽기 관련 내부 상태
    this._pollTid = null;
    this._lastTilesKey = '';     // 마지막으로 질의했던 타일 집합 키
    this._lastIdsInView = new Set(); // 마지막 페치 결과의 id 집합

    this._cssInjected = false;

    this._injectCSS();
    this._initAudio();

    // ✅ 실시간 구독 제거. 유저 준비되면 폴링 시작.
    this._startLoop(); // 발사 루프(로컬)
  }

  /* -------- 외부 API -------- */
  resumeAudio(){ try { this._ensureAC(); } catch {} }
  setUserReady(v = true){
    this._userReady = !!v;
    this.resumeAudio();
    if (this._userReady && !this._pollTid){
      this._beginPolling();
    }
  }
  markKilled(id){
    if (!id) return;
    this.killedLocal.add(String(id));
    // 즉시 맵에서 제거
    this._removeMon(String(id));
  }
  destroy(){
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._pollTid) { clearInterval(this._pollTid); this._pollTid = null; }
    this.mons.forEach(m=>{
      if (m.marker) { try { this.map.removeLayer(m.marker); } catch {} }
      if (m.circle) { try { this.map.removeLayer(m.circle); } catch {} }
    });
    this.mons.clear();
  }

  /* -------- 스타일 -------- */
  _injectCSS(){
    if (this._cssInjected) return;
    const css = `
      .mon-guard-wrap{ position:relative; width:48px; height:48px; }
      .mon-guard-wrap img{ width:100%; height:100%; object-fit:contain; display:block; }
      .mon-guard-range{ pointer-events:none; }
      .mon-arrow-wrap{ font-size:22px; transform-origin:center; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
      .mon-arrow-wrap .arrow{ will-change: transform; user-select:none; }
    `;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    this._cssInjected = true;
  }

  /* -------- 오디오 -------- */
  _initAudio(){
    this._ac = null;
    const resume = ()=>{ try { this._ensureAC(); } catch {} };
    window.addEventListener('pointerdown', resume, { once:true, passive:true });
  }
  _ensureAC(){
    this._ac = this._ac || new (window.AudioContext||window.webkitAudioContext)();
    if (this._ac.state === 'suspended') this._ac.resume();
  }
  _adsr(g, t, {a=0.01, d=0.08, s=0.3, r=0.2, peak=0.9, sus=0.2}={}){
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t+a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, sus), t+a+d);
    g.gain.setTargetAtTime(0.0001, t+a+d, r);
  }
  _noise(lenSec=0.35){
    this._ensureAC();
    const ac = this._ac, sr = ac.sampleRate, len = Math.floor(sr*lenSec);
    const buf = ac.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = Math.random()*2-1;
    const src = ac.createBufferSource(); src.buffer = buf; return src;
  }
  _playWhoosh(){
    try{
      this._ensureAC(); const ac=this._ac, t=ac.currentTime;
      const nz=this._noise(0.35);
      const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.setValueAtTime(1000,t); bp.Q.value=1.1;
      const g=ac.createGain(); nz.connect(bp); bp.connect(g); g.connect(ac.destination);
      this._adsr(g,t,{a:0.01,d:0.08,s:0.15,r:0.15,peak:0.55,sus:0.12});
      bp.frequency.linearRampToValueAtTime(2200,t+0.25);
      nz.start(t); nz.stop(t+0.35);
    }catch{}
  }
  _playImpact(){
    try{
      this._ensureAC(); const ac=this._ac, t=ac.currentTime;
      const o=ac.createOscillator(); o.type='triangle'; o.frequency.setValueAtTime(140, t);
      const g=ac.createGain(); o.connect(g); g.connect(ac.destination);
      this._adsr(g,t,{a:0.005,d:0.06,s:0.15,r:0.1,peak:0.7,sus:0.08});
      o.start(t); o.stop(t+0.18);
    }catch{}
  }

  /* -------- 아이콘 -------- */
  _monIcon(){
    const html = `
      <div class="mon-guard-wrap">
        <img src="${this.iconUrl}" alt="monster"/>
      </div>`;
    return L.divIcon({ className:'', html, iconSize:[48,48], iconAnchor:[24,48] });
  }
  _arrowIcon(angleDeg){
    const html = `
      <div class="mon-arrow-wrap" style="transform: rotate(${angleDeg}deg);">
        <span class="arrow" style="
          font-size:16px; color:#ff6666; font-weight:bold;
          filter:drop-shadow(0 0 1px rgba(0,0,0,.5)); display:inline-block;">⇢</span>
      </div>`;
    return L.divIcon({ className:'', html, iconSize:[16,16], iconAnchor:[8,8] });
  }

  /* -------- 타일 계산 -------- */
  _tileOf(lat, lon, g=this.tileSizeDeg){
    const fy = Math.floor(lat / g), fx = Math.floor(lon / g);
    return `${fy}_${fx}`;
  }
  _tilesFromBounds(bounds, g=this.tileSizeDeg){
    const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
    const y0 = Math.floor(sw.lat / g), y1 = Math.floor(ne.lat / g);
    const x0 = Math.floor(sw.lng / g), x1 = Math.floor(ne.lng / g);
    const tiles = [];
    for (let y=y0; y<=y1; y++){
      for (let x=x0; x<=x1; x++){
        tiles.push(`${y}_${x}`);
      }
    }
    // Firestore where-in 은 10개 제한 → 중심 9개 우선
    if (tiles.length > 10){
      const center = this.getUserLatLng?.();
      if (center){
        const cTile = this._tileOf(center[0], center[1], g);
        tiles.sort((a,b)=> (a===cTile? -1:0) - (b===cTile? -1:0));
      }
      return tiles.slice(0, 10);
    }
    return tiles;
  }
  _currentTilesKey(){
    if (!this.map) return '';
    const pad = 0.0005; // 아주 소폭 패딩
    const b = this.map.getBounds();
    const bounds = L.latLngBounds(
      [b.getSouth() - pad, b.getWest() - pad],
      [b.getNorth() + pad, b.getEast() + pad]
    );
    const tiles = this._tilesFromBounds(bounds);
    return tiles.join(',');
  }

  /* -------- 폴링 시작 -------- */
  _beginPolling(){
    // 즉시 한 번
    this._fetchOnce().catch(()=>{});
    // 주기적으로
    this._pollTid = setInterval(()=> this._fetchOnce().catch(()=>{}), this.pollMs);
  }

  /* -------- 한 번 가져오기(읽기 최적화) -------- */
  async _fetchOnce(){
    if (!this.db) return;
    // 뷰 타일 집합이 변했을 때만 쿼리 (무의미한 읽기 피함)
    let q;
    let useTiles = this.useTiles;
    let tilesKey = '';
    if (useTiles && this.map){
      tilesKey = this._currentTilesKey();
      if (tilesKey === this._lastTilesKey) return; // 바뀐 게 없으면 스킵
      this._lastTilesKey = tilesKey;

      const tiles = tilesKey ? tilesKey.split(',') : [];
      if (tiles.length === 0) return;

      // 타일 + alive 필터 + 제한
      q = query(
        collection(this.db, 'monsters'),
        where('alive', '==', true),
        where('tile', 'in', tiles),
        limit(this.maxDocs)
      );
    } else {
      // 타일 인덱스가 없다면: alive==true 만 받아서 클라이언트 필터
      // (그래도 onSnapshot 전체 구독보다 훨씬 적음)
      q = query(
        collection(this.db, 'monsters'),
        where('alive', '==', true),
        limit(this.maxDocs)
      );
    }

    const snap = await getDocs(q);
    const nowMs = Date.now();
    const nextIds = new Set();

    snap.forEach(docSnap=>{
      const id = docSnap.id;
      const d = docSnap.data() || {};
      // respawnAt 체크(미래면 제외)
      const alive = (d.alive !== false) && (d.dead !== true);
      const respawnAt = Number(d.respawnAt || 0);
      if (!alive || respawnAt > nowMs) return;
      // 좌표 유효성
      const lat = Number(d.lat), lon = Number(d.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const info = {
        id,
        lat, lon,
        range: Math.max(10, Number(d.range || this.rangeDefault)),
        damage: Math.max(1, Number(d.damage || 1)),
        cooldownMs: Math.max(300, Number(d.cooldownMs || this.fireCooldownMs)),
        alive: true
      };
      // 로컬 처치면 제외
      if (this.killedLocal.has(id)) { this._removeMon(id); return; }

      nextIds.add(id);
      this._upsertMon(info);
    });

    // 현재 뷰에서 사라진 몬스터는 제거 (읽기 최소화를 위해 "뷰 내에서만" 동기화)
    // useTiles=false면 이 단계는 스킵(뷰 경계 불명확)
    if (useTiles){
      // 이전에 보이던 것 중 이번에 안 온 것 제거
      for (const id of this._lastIdsInView){
        if (!nextIds.has(id)) this._removeMon(id);
      }
      this._lastIdsInView = nextIds;
    }
  }

  _upsertMon(info){
    const m = this.mons.get(info.id);
    if (!m){
      // 새로 추가
      let marker=null, circle=null;
      if (this.renderMarkers){
        marker = L.marker([info.lat, info.lon], { icon: this._monIcon(), interactive:false }).addTo(this.map);
        circle = L.circle([info.lat, info.lon], {
          radius: info.range, color:'#f97316', weight:1, fillColor:'#f97316', fillOpacity:0.1, className:'mon-guard-range'
        }).addTo(this.map);
      }
      this.mons.set(info.id, { ...info, marker, circle, lastFire: 0 });
      return;
    }
    // 셔로우 비교 후 변경 있을 때만 DOM 업데이트
    let changed = false;
    if (m.lat !== info.lat) { m.lat = info.lat; changed = true; }
    if (m.lon !== info.lon) { m.lon = info.lon; changed = true; }
    if (m.range !== info.range){ m.range = info.range; changed = true; }
    m.damage = info.damage; m.cooldownMs = info.cooldownMs;

    if (changed){
      if (m.marker) { m.marker.setLatLng([m.lat, m.lon]); }
      if (m.circle) { m.circle.setLatLng([m.lat, m.lon]); m.circle.setRadius(m.range); }
    }
  }

  _removeMon(id){
    const m = this.mons.get(id);
    if (!m) return;
    if (m.marker){ try { this.map.removeLayer(m.marker); } catch {} }
    if (m.circle){ try { this.map.removeLayer(m.circle); } catch {} }
    this.mons.delete(id);
  }

  /* -------- 루프 & 발사 (로컬만) -------- */
  _startLoop(){
    const tick = ()=>{
      if (!this._userReady) { this._raf = requestAnimationFrame(tick); return; }

      const pos = this.getUserLatLng?.();
      if (pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1])){
        const userLL = L.latLng(pos[0], pos[1]);
        const now = performance.now();
        for (const m of this.mons.values()){
          // markKilled에 걸렸으면 스킵
          if (this.killedLocal.has(m.id)) continue;

          const dist = userLL.distanceTo(L.latLng(m.lat, m.lon));
          const cd = m.cooldownMs ?? this.fireCooldownMs;
          if (dist <= m.range && (now - m.lastFire) > cd){
            m.lastFire = now;
            try { this._playWhoosh(); } catch {}
            this._fireArrow(m, userLL);
          }
        }
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _fireArrow(mon, userLL){
    const from = L.latLng(mon.lat, mon.lon);
    const to = userLL;
    const p1 = this.map.latLngToLayerPoint(from);
    const p2 = this.map.latLngToLayerPoint(to);
    const angleDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;

    const arrow = L.marker(from, { icon: this._arrowIcon(angleDeg), interactive:false, zIndexOffset:9999 }).addTo(this.map);

    const dur = 600; // ms
    const start = performance.now();
    const anim = (now)=>{
      const k = Math.min(1, (now - start) / dur);
      const lat = from.lat + (to.lat - from.lat) * k;
      const lon = from.lng + (to.lng - from.lng) * k;
      arrow.setLatLng([lat, lon]);
      if (k < 1){
        requestAnimationFrame(anim);
      } else {
        try { this.map.removeLayer(arrow); } catch {}
        try { this._playImpact(); } catch {}
        try {
          if (typeof this.onUserHit === 'function') this.onUserHit(mon.damage ?? 1, mon);
          if (typeof this.onImpact === 'function') this.onImpact(mon.damage ?? 1, mon);
        } catch {}
      }
    };
    requestAnimationFrame(anim);
  }
}
