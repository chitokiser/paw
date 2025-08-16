// /js/tower.js — 망루(타워) 자동 공격 모듈 (완전 읽기 전용, 로그/쓰기 없음)

import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export class TowerGuard {
  constructor({
    map,
    db,
    iconUrl = "https://puppi.netlify.app/images/mon/tower.png",
    rangeDefault = 30,     // 사거리(m)
    fireCooldownMs = 1500, // 1.5초/발
    getUserLatLng,         // ()=>[lat, lon]
    onUserHit = () => {},  // (damage, towerInfo)=>void
    onImpact = null        // (damage, towerInfo)=>void (선택)
  }){
    this.map = map;
    this.db = db;
    this.iconUrl = iconUrl;
    this.rangeDefault = rangeDefault;
    this.fireCooldownMs = fireCooldownMs;
    this.getUserLatLng = getUserLatLng;
    this.onUserHit = onUserHit;
    this.onImpact = onImpact;

    // id -> {id, lat, lon, range, marker, circle, lastFire}
    this.towers = new Map();
    this._userReady = false;

    this._injectCSS();
    this._initAudio();
    this._initRealtime();   // 읽기(onSnapshot)만
    this._startLoop();
  }

  /* ---------- 공개 유틸 ---------- */
  resumeAudio(){ try { this._ensureAC(); } catch {} }
  setUserReady(v = true){
    this._userReady = !!v;
    this.resumeAudio();
  }

  /* ---------- CSS ---------- */
  _injectCSS(){
    const css = `
      .tower-wrap{ position:relative; width:48px; height:48px; }
      .tower-wrap img{ width:100%; height:100%; object-fit:contain; display:block; }
      .tower-range{ pointer-events:none; }
      .arrow-wrap{ font-size:22px; transform-origin:center; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
      .arrow-wrap .arrow{ will-change: transform; user-select:none; }
    `;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }

  /* ---------- Audio (순수 WebAudio, Firestore 쓰기 없음) ---------- */
  _initAudio(){
    this._ac = null;
    const resume = () => { try { this._ensureAC(); } catch {} };
    window.addEventListener('pointerdown', resume, { once: true, passive: true });
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
  _noise(lenSec=0.4){
    this._ensureAC();
    const ac = this._ac, sr = ac.sampleRate, len = Math.floor(sr*lenSec);
    const buf = ac.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = Math.random()*2-1;
    const src = ac.createBufferSource(); src.buffer = buf; return src;
  }
  _playWhoosh(){
    this._ensureAC(); const ac = this._ac, t = ac.currentTime;
    const nz = this._noise(0.35);
    const bp = ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.setValueAtTime(1200,t); bp.Q.value=1.2;
    const g  = ac.createGain();
    nz.connect(bp); bp.connect(g); g.connect(ac.destination);
    this._adsr(g, t, {a:0.01, d:0.08, s:0.15, r:0.15, peak:0.6, sus:0.12});
    bp.frequency.linearRampToValueAtTime(2500, t+0.25);
    nz.start(t); nz.stop(t+0.35);
  }
  _playImpact(){
    this._ensureAC(); const ac = this._ac, t = ac.currentTime;
    const o = ac.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(110, t);
    const g = ac.createGain(); o.connect(g); g.connect(ac.destination);
    this._adsr(g, t, {a:0.005, d:0.06, s:0.15, r:0.1, peak:0.9, sus:0.08});
    o.start(t); o.stop(t+0.18);
    const nz = this._noise(0.12);
    const hp = ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.setValueAtTime(3000, t);
    const ng = ac.createGain(); ng.gain.setValueAtTime(0.0001, t);
    nz.connect(hp); hp.connect(ng); ng.connect(ac.destination);
    ng.gain.exponentialRampToValueAtTime(0.35, t+0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t+0.1);
    nz.start(t); nz.stop(t+0.12);
  }

  /* ---------- Icons ---------- */
  _towerIcon(){
    const html = `
      <div class="tower-wrap">
        <img src="${this.iconUrl}" alt="tower"/>
      </div>`;
    return L.divIcon({ className:'', html, iconSize:[48,48], iconAnchor:[24,48] });
  }
  _arrowIcon(angleDeg){
    const html = `
      <div class="arrow-wrap" style="transform: rotate(${angleDeg}deg);">
        <span class="arrow" style="font-size:16px; color:#ffcc00; font-weight:bold; filter:drop-shadow(0 0 1px rgba(0,0,0,.5)); display:inline-block;">⇢</span>
      </div>`;
    return L.divIcon({ className:'', html, iconSize:[16,16], iconAnchor:[8,8] });
  }

  /* ---------- Realtime towers (읽기만) ---------- */
  _initRealtime(){
    const ref = collection(this.db, 'towers');
    onSnapshot(ref, (snap)=>{
      snap.docChanges().forEach(ch=>{
        const id = ch.doc.id;
        if (ch.type === 'added' || ch.type === 'modified'){
          const d = ch.doc.data();
          const info = {
            id,
            lat: Number(d.lat),
            lon: Number(d.lon),
            range: Math.max(10, Number(d.range || this.rangeDefault))
          };
          this._upsertTower(info);
        } else if (ch.type === 'removed'){
          this._removeTower(id);
        }
      });
    }, ()=>{}); // 오류 무음 처리
  }

  _upsertTower(info){
    let t = this.towers.get(info.id);
    if (!t){
      const marker = L.marker([info.lat, info.lon], { icon: this._towerIcon(), interactive: false }).addTo(this.map);
      const circle = L.circle([info.lat, info.lon], {
        radius: info.range,
        color:'#ef4444', weight:1,
        fillColor:'#ef4444', fillOpacity:0.1,
        className:'tower-range'
      }).addTo(this.map);
      t = { ...info, marker, circle, lastFire: 0 };
      this.towers.set(info.id, t);
    } else {
      t.lat = info.lat; t.lon = info.lon; t.range = info.range;
      t.marker.setLatLng([t.lat, t.lon]);
      t.circle.setLatLng([t.lat, t.lon]);
      t.circle.setRadius(t.range);
    }
  }

  _removeTower(id){
    const t = this.towers.get(id);
    if (!t) return;
    try { this.map.removeLayer(t.marker); } catch {}
    try { this.map.removeLayer(t.circle); } catch {}
    this.towers.delete(id);
  }

  /* ---------- Loop & Fire ---------- */
  _startLoop(){
    const tick = ()=>{
      if (!this._userReady) { this._raf = requestAnimationFrame(tick); return; }

      const pos = this.getUserLatLng?.();
      if (pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1])){
        const userLL = L.latLng(pos[0], pos[1]);
        const now = performance.now();
        for (const t of this.towers.values()){
          const dist = userLL.distanceTo(L.latLng(t.lat, t.lon));
          if (dist <= t.range && (now - t.lastFire) > this.fireCooldownMs){
            t.lastFire = now;
            try { this._playWhoosh(); } catch {}
            this._fireArrow(t, userLL);
          }
        }
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  destroy(){
    if (this._raf) cancelAnimationFrame(this._raf);
    this.towers.forEach(t=>{
      try { this.map.removeLayer(t.marker); } catch {}
      try { this.map.removeLayer(t.circle); } catch {}
    });
    this.towers.clear();
  }

  _fireArrow(tower, userLL){
    const from = L.latLng(tower.lat, tower.lon);
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
      if (k < 1) {
        requestAnimationFrame(anim);
      } else {
        try { this.map.removeLayer(arrow); } catch {}
        try { this._playImpact(); } catch {}
        try {
          // ✔ Firestore 쓰기 없이, 콜백만 호출
          if (typeof this.onUserHit === 'function') this.onUserHit(1, tower);
          if (typeof this.onImpact === 'function') this.onImpact(1, tower);
        } catch {}
      }
    };
    requestAnimationFrame(anim);
  }
}
