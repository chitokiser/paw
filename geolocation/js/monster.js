// monster.js — 몬스터 자동 공격 모듈 (Leaflet + Firestore)
// 사용법 (main.js):
// import { MonsterGuard } from "./monster.js";
// const monsters = new MonsterGuard({
//   map, db,
//   iconUrl: "https://puppi.netlify.app/images/mon/monster.png",
//   rangeDefault: 50,
//   fireCooldownMs: 1800,
//   getUserLatLng: ()=>[userLat, userLon],
//   onUserHit: (damage=1, m)=>{ /* 유저 피격 처리 (HP-, GP-, 이펙트 등) */ },
//   onImpact: null,               // (damage, monsterInfo) => void
//   isAdmin: false                // true면 '몬스터 설치' 버튼 활성화
// });
//
// // 첫 사용자 탭으로 오디오/루프 해제(모바일 자동재생 정책 회피)
// window.addEventListener('pointerdown', ()=>monsters.setUserReady(true), { once:true, passive:true });

import {
  collection, addDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export class MonsterGuard {
  constructor({
    map,
    db,
    iconUrl = "https://puppi.netlify.app/images/mon/monster.png",
    rangeDefault = 50,          // 기본 사거리(m)
    fireCooldownMs = 1800,      // 1.8초당 1회 공격
    getUserLatLng,              // ()=>[lat, lon]
    onUserHit = ()=>{},         // (damage, monsterInfo)=>void
    onImpact = null,            // (damage, monsterInfo)=>void
    isAdmin = false
  }){
    this.map = map;
    this.db = db;
    this.iconUrl = iconUrl;
    this.rangeDefault = rangeDefault;
    this.fireCooldownMs = fireCooldownMs;
    this.getUserLatLng = getUserLatLng;
    this.onUserHit = onUserHit;
    this.onImpact = onImpact;
    this.isAdmin = isAdmin;

    // id -> {id, lat, lon, range, damage, cooldown, marker, circle, lastFire}
    this.monsters = new Map();

    // 사용자 입력 허용 게이트(오디오/루프)
    this._userReady = false;

    this._injectCSS();
    this._initAudio();
    this._initRealtime();
    this._startLoop();

    if (this.isAdmin) this._addAdminButton();
  }

  /* -------------------- 공개 유틸 -------------------- */
  resumeAudio(){ try { this._ensureAC(); } catch {} }
  setUserReady(v = true){
    this._userReady = !!v;
    this.resumeAudio();
  }

  /* -------------------- CSS -------------------- */
  _injectCSS(){
    const css = `
      .monster-wrap{ position:relative; width:48px; height:48px; }
      .monster-wrap img{ width:100%; height:100%; object-fit:contain; display:block; }
      .monster-range{ pointer-events:none; }
      .m-arrow-wrap{ font-size:22px; transform-origin:center; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
      .m-arrow-wrap .arrow{ will-change: transform; user-select:none; }
      .mg-admin-btn{
        position:fixed; left:12px; top:120px; z-index:1100;
        background:#111827; color:#fff; padding:8px 12px; border-radius:10px; cursor:pointer;
        font-weight:700; box-shadow:0 6px 20px rgba(0,0,0,.25);
      }
      .mg-admin-btn.on{ background:#22c55e; }
    `;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }

  /* -------------------- Audio -------------------- */
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
  _playSpit(){ // 투사체 발사(몬스터 스킬 느낌)
    this._ensureAC(); const ac = this._ac, t = ac.currentTime;
    const nz = this._noise(0.28);
    const bp = ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.setValueAtTime(900,t); bp.Q.value=1.8;
    const g  = ac.createGain();
    nz.connect(bp); bp.connect(g); g.connect(ac.destination);
    this._adsr(g, t, {a:0.008, d:0.07, s:0.15, r:0.12, peak:0.7, sus:0.12});
    bp.frequency.linearRampToValueAtTime(1800, t+0.22);
    nz.start(t); nz.stop(t+0.28);
  }
  _playBite(){ // 명중음
    this._ensureAC(); const ac = this._ac, t = ac.currentTime;
    const o = ac.createOscillator(); o.type='triangle'; o.frequency.setValueAtTime(160, t);
    const g = ac.createGain(); o.connect(g); g.connect(ac.destination);
    this._adsr(g, t, {a:0.004, d:0.06, s:0.12, r:0.1, peak:0.8, sus:0.06});
    o.start(t); o.stop(t+0.16);
  }

  /* -------------------- Icons -------------------- */
  _monsterIcon(){
    const html = `
      <div class="monster-wrap">
        <img src="${this.iconUrl}" alt="monster"/>
      </div>`;
    return L.divIcon({ className:'', html, iconSize:[48,48], iconAnchor:[24,48] });
  }
  _arrowIcon(angleDeg) {
    // 몬스터 투사체(붉은색 화살표)
    const html = `
      <div class="m-arrow-wrap" style="transform: rotate(${angleDeg}deg);">
        <span class="arrow" style="
          font-size: 16px;
          color: #ff4d4f;
          font-weight: bold;
          filter: drop-shadow(0 0 1px rgba(0,0,0,0.5));
          display: inline-block;
        ">⇢</span>
      </div>`;
    return L.divIcon({ className:'', html, iconSize:[16,16], iconAnchor:[8,8] });
  }

  /* -------------------- Realtime monsters -------------------- */
  _initRealtime(){
    const ref = collection(this.db, 'monsters');
    onSnapshot(ref, (snap)=>{
      snap.docChanges().forEach(ch=>{
        const id = ch.doc.id;
        if (ch.type === 'added' || ch.type === 'modified'){
          const d = ch.doc.data();
          const info = {
            id,
            lat: Number(d.lat),
            lon: Number(d.lon),
            range: Math.max(10, Number(d.range ?? this.rangeDefault)),
            damage: Math.max(1, Number(d.damage ?? 1)),
            cooldownMs: Math.max(200, Number(d.cooldownMs ?? this.fireCooldownMs))
          };
          this._upsertMonster(info);
        } else if (ch.type === 'removed'){
          this._removeMonster(id);
        }
      });
    });
  }

  _upsertMonster(info){
    let m = this.monsters.get(info.id);
    if (!m){
      const marker = L.marker([info.lat, info.lon], { icon: this._monsterIcon(), interactive: false }).addTo(this.map);
      const circle = L.circle([info.lat, info.lon], {
        radius: info.range, color: '#dc2626', weight: 1, fillColor: '#dc2626', fillOpacity: 0.1, className: 'monster-range'
      }).addTo(this.map);
      m = { ...info, marker, circle, lastFire: 0 };
      this.monsters.set(info.id, m);
    } else {
      Object.assign(m, info);
      m.marker.setLatLng([m.lat, m.lon]);
      m.circle.setLatLng([m.lat, m.lon]);
      m.circle.setRadius(m.range);
    }
  }

  _removeMonster(id){
    const m = this.monsters.get(id);
    if (!m) return;
    try { this.map.removeLayer(m.marker); } catch {}
    try { this.map.removeLayer(m.circle); } catch {}
    this.monsters.delete(id);
  }

  /* -------------------- Loop & Fire -------------------- */
  _startLoop(){
    const tick = ()=>{
      if (!this._userReady) { this._raf = requestAnimationFrame(tick); return; }

      const pos = this.getUserLatLng?.();
      if (pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1])){
        const userLL = L.latLng(pos[0], pos[1]);
        const now = performance.now();
        for (const m of this.monsters.values()){
          const dist = userLL.distanceTo(L.latLng(m.lat, m.lon)); // m
          if (dist <= m.range && (now - m.lastFire) > m.cooldownMs){
            m.lastFire = now;
            try { this._playSpit(); } catch {}
            this._fireProjectile(m, userLL);
          }
        }
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  destroy(){
    if (this._raf) cancelAnimationFrame(this._raf);
    this.monsters.forEach(m=>{
      try { this.map.removeLayer(m.marker); } catch {}
      try { this.map.removeLayer(m.circle); } catch {}
    });
    this.monsters.clear();
  }

  _fireProjectile(mon, userLL){
    const from = L.latLng(mon.lat, mon.lon);
    const to = userLL; // 발사 순간의 유저 좌표 고정
    const p1 = this.map.latLngToLayerPoint(from);
    const p2 = this.map.latLngToLayerPoint(to);
    const angleDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;

    const proj = L.marker(from, { icon: this._arrowIcon(angleDeg), interactive: false, zIndexOffset: 9999 }).addTo(this.map);

    const dur = 550; // ms
    const start = performance.now();
    const anim = (now)=>{
      const k = Math.min(1, (now - start) / dur);
      const lat = from.lat + (to.lat - from.lat) * k;
      const lon = from.lng + (to.lng - from.lng) * k;
      proj.setLatLng([lat, lon]);
      if (k < 1) {
        requestAnimationFrame(anim);
      } else {
        try { this.map.removeLayer(proj); } catch {}
        try { this._playBite(); } catch {}
        try {
          if (typeof this.onUserHit === 'function') this.onUserHit(mon.damage ?? 1, mon);
          if (typeof this.onImpact === 'function') this.onImpact(mon.damage ?? 1, mon);
        } catch {}
      }
    };
    requestAnimationFrame(anim);
  }

  /* -------------------- Admin: place monsters -------------------- */
  _addAdminButton(){
    const btn = document.createElement('div');
    btn.className = 'mg-admin-btn';
    btn.textContent = '몬스터 설치';
    document.body.appendChild(btn);
    this._adminBtn = btn;

    const placeHandler = async (e)=>{
      if (!this._placing) return;
      const lat = e.latlng.lat, lon = e.latlng.lng;

      const rangeStr = prompt('사거리(m)를 입력하세요 (예: 50)', String(this.rangeDefault));
      if (rangeStr === null) return;
      const damageStr = prompt('1회 공격 데미지(정수)를 입력하세요 (예: 1)', '1');
      if (damageStr === null) return;
      const cdStr = prompt('쿨다운(ms)을 입력하세요 (예: 1800)', String(this.fireCooldownMs));
      if (cdStr === null) return;

      const range = Math.max(10, Number(rangeStr) || this.rangeDefault);
      const damage = Math.max(1, Math.floor(Number(damageStr) || 1));
      const cooldownMs = Math.max(200, Number(cdStr) || this.fireCooldownMs);

      try{
        await addDoc(collection(this.db, 'monsters'), {
          lat, lon, range, damage, cooldownMs, createdAt: serverTimestamp()
        });
      }catch(err){ console.warn('monster add fail:', err); }

      this._placing = false; btn.classList.remove('on');
      this.map.off('click', placeHandler);
    };

    btn.addEventListener('click', ()=>{
      this._placing = !this._placing;
      btn.classList.toggle('on', this._placing);
      if (this._placing) this.map.on('click', placeHandler);
      else this.map.off('click', placeHandler);
    });
  }
}
