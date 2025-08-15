//monster.js — 자동 공격형 몬스터 가드(읽기 전용, 무로그/무히트기록)
// 사용처 예: 
// monstersGuard = new MonsterGuard({
//   map, db,
//   iconUrl: "https://puppi.netlify.app/images/mon/monster.png",
//   rangeDefault: 50,
//   fireCooldownMs: 1800,
//   getUserLatLng: () => [userLat, userLon],
//   onUserHit: (damage, monInfo) => { /* HP 차감 등 */ },
//   renderMarkers: false,   // 지도에 아이콘/사거리 원을 그리지 않으려면 false
// });

import {
  collection, onSnapshot
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
    renderMarkers = false   // 기본 false: 자동공격 전용(표시는 app.js에서)
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

    // id -> {id, lat, lon, range, damage, cooldownMs, marker?, circle?, lastFire, alive, respawnAt}
    this.mons = new Map();
    // 처치 즉시 공격 중단을 위한 로컬 플래그
    this.killedLocal = new Set();

    this._userReady = false;
    this._ac = null;

    this._injectCSS();
    this._initAudio();
    this._initRealtime();
    this._startLoop();
  }

  /* -------- 외부 API -------- */
  resumeAudio(){ try { this._ensureAC(); } catch {} }
  setUserReady(v = true){
    this._userReady = !!v;
    this.resumeAudio();
  }
  // 처치 직후 즉시 공격 중단(서버 반영과 무관)
  markKilled(id){
    if (!id) return;
    this.killedLocal.add(String(id));
  }
  destroy(){
    if (this._raf) cancelAnimationFrame(this._raf);
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

  /* -------- 실시간 몬스터 -------- */
  _initRealtime(){
    const ref = collection(this.db, 'monsters');
    onSnapshot(ref, (snap)=>{
      const now = Date.now();
      snap.docChanges().forEach(ch=>{
        const id = ch.doc.id;
        if (ch.type === 'removed'){
          this._removeMon(id);
          return;
        }
        if (ch.type === 'added' || ch.type === 'modified'){
          const d = ch.doc.data() || {};
          // 서버 상태 해석
          const alive = (d.alive !== false) && (d.dead !== true);
          const respawnAt = Number(d.respawnAt || 0);
          if (!alive || respawnAt > now){
            // 표시/공격 대상에서 제외
            this._removeMon(id);
            // 부활 예정이면 로컬 처치 플래그도 유지(부활시 스냅이 다시 온다)
            return;
          }
          // 좌표/스탯
          const info = {
            id,
            lat: Number(d.lat),
            lon: Number(d.lon),
            range: Math.max(10, Number(d.range || this.rangeDefault)),
            damage: Math.max(1, Number(d.damage || 1)),
            cooldownMs: Math.max(300, Number(d.cooldownMs || this.fireCooldownMs)),
            alive: true,
            respawnAt: 0
          };
          // 만약 클라이언트에서 markKilled로 처리했다면 공격 금지
          if (this.killedLocal.has(id)){
            this._removeMon(id);
            return;
          }
          this._upsertMon(info);
        }
      });
    }, ()=>{}); // 오류 무음 처리
  }

  _upsertMon(info){
    let m = this.mons.get(info.id);
    if (!m){
      // 좌표 유효성
      if (!Number.isFinite(info.lat) || !Number.isFinite(info.lon)) return;
      let marker=null, circle=null;
      if (this.renderMarkers){
        marker = L.marker([info.lat, info.lon], { icon: this._monIcon(), interactive:false }).addTo(this.map);
        circle = L.circle([info.lat, info.lon], {
          radius: info.range, color:'#f97316', weight:1, fillColor:'#f97316', fillOpacity:0.1, className:'mon-guard-range'
        }).addTo(this.map);
      }
      m = { ...info, marker, circle, lastFire: 0 };
      this.mons.set(info.id, m);
    } else {
      m.lat = info.lat; m.lon = info.lon; m.range = info.range;
      m.damage = info.damage; m.cooldownMs = info.cooldownMs;
      if (m.marker){ m.marker.setLatLng([m.lat, m.lon]); }
      if (m.circle){ m.circle.setLatLng([m.lat, m.lon]); m.circle.setRadius(m.range); }
    }
  }

  _removeMon(id){
    const m = this.mons.get(id);
    if (!m) return;
    if (m.marker){ try { this.map.removeLayer(m.marker); } catch {} }
    if (m.circle){ try { this.map.removeLayer(m.circle); } catch {} }
    this.mons.delete(id);
  }

  /* -------- 루프 & 발사 -------- */
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

