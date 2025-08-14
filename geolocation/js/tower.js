// tower.js  —  망루(타워) 자동 공격 모듈
// 사용법: main.js에서
// import { TowerGuard } from "./tower.js";
// new TowerGuard({ map, db, iconUrl, rangeDefault, fireCooldownMs, getUserLatLng, onUserHit, isAdmin });

import {
  collection, addDoc, onSnapshot, serverTimestamp, doc, setDoc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export class TowerGuard {
  constructor({
    map,
    db,
    iconUrl = "https://puppi.netlify.app/images/mon/tower.png",
    rangeDefault = 60,           // 기본 사거리(m)
    fireCooldownMs = 1500,       // 1.5초 당 1발
    getUserLatLng,               // ()=>[lat, lon]
    onUserHit = ()=>{},          // (damage, towerInfo)=>void
    isAdmin = false
  }){
    this.map = map;
    this.db = db;
    this.iconUrl = iconUrl;
    this.rangeDefault = rangeDefault;
    this.fireCooldownMs = fireCooldownMs;
    this.getUserLatLng = getUserLatLng;
    this.onUserHit = onUserHit;
    this.isAdmin = isAdmin;

    this.towers = new Map(); // id -> {id, lat, lon, range, marker, circle, lastFire}
    this._placing = false;

    this._injectCSS();
    this._initRealtime();
    this._startLoop();

    if (this.isAdmin) this._addAdminButton();
  }

  _injectCSS(){
    const css = `
      .tower-wrap{ position:relative; width:48px; height:48px; }
      .tower-wrap img{ width:100%; height:100%; object-fit:contain; display:block; }
      .tower-range{ pointer-events:none; } /* 반경 원 */
      .arrow-wrap{ font-size:22px; transform-origin:center; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
      .arrow-wrap .arrow{ will-change: transform; user-select:none; }
      .tg-admin-btn{
        position:fixed; left:12px; top:70px; z-index:1100;
        background:#111827; color:#fff; padding:8px 12px; border-radius:10px; cursor:pointer;
        font-weight:700; box-shadow:0 6px 20px rgba(0,0,0,.25);
      }
      .tg-admin-btn.on{ background:#0ea5e9; }
    `;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }

  _towerIcon(){
    const html = `
      <div class="tower-wrap">
        <img src="${this.iconUrl}" alt="tower"/>
      </div>`;
    return L.divIcon({ className:'', html, iconSize:[48,48], iconAnchor:[24,48] });
  }

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
            range: Math.max(10, Number(d.range||this.rangeDefault))
          };
          this._upsertTower(info);
        } else if (ch.type === 'removed'){
          this._removeTower(id);
        }
      });
    });
  }

  _upsertTower(info){
    // 만들거나 갱신
    let t = this.towers.get(info.id);
    if (!t){
      const marker = L.marker([info.lat, info.lon], { icon:this._towerIcon(), interactive:false }).addTo(this.map);
      const circle = L.circle([info.lat, info.lon], {
        radius: info.range, color:'#ef4444', weight:1, fillColor:'#ef4444', fillOpacity:0.1, className:'tower-range'
      }).addTo(this.map);
      t = { ...info, marker, circle, lastFire: 0 };
      this.towers.set(info.id, t);
    }else{
      // 위치/사거리 갱신
      t.lat = info.lat; t.lon = info.lon; t.range = info.range;
      t.marker.setLatLng([t.lat, t.lon]);
      t.circle.setLatLng([t.lat, t.lon]);
      t.circle.setRadius(t.range);
    }
  }

  _removeTower(id){
    const t = this.towers.get(id);
    if (!t) return;
    try{ this.map.removeLayer(t.marker); }catch{}
    try{ this.map.removeLayer(t.circle); }catch{}
    this.towers.delete(id);
  }

  _startLoop(){
    // 주기적으로 유저 위치를 확인하고 사거리 내면 발사
    const tick = ()=>{
      const pos = this.getUserLatLng?.();
      if (pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1])){
        const userLL = L.latLng(pos[0], pos[1]);
        const now = performance.now();
        for (const t of this.towers.values()){
          const dist = userLL.distanceTo(L.latLng(t.lat, t.lon)); // m
          if (dist <= t.range && (now - t.lastFire) > this.fireCooldownMs){
            t.lastFire = now;
            this._fireArrow(t, userLL);
            try{ this.onUserHit(1, t); }catch{}
          }
        }
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  destroy(){
    if (this._raf) cancelAnimationFrame(this._raf);
    this.towers.forEach(t=>{ try{ this.map.removeLayer(t.marker); }catch{}; try{ this.map.removeLayer(t.circle); }catch{}; });
    this.towers.clear();
  }

  _arrowIcon(angleDeg){
    const html = `<div class="arrow-wrap" style="transform: rotate(${angleDeg}deg);"><span class="arrow">➤</span></div>`;
    return L.divIcon({ className:'', html, iconSize:[24,24], iconAnchor:[12,12] });
  }

  _fireArrow(tower, userLL){
    const from = L.latLng(tower.lat, tower.lon);
    const to = userLL; // 그 순간의 유저 좌표를 고정
    const p1 = this.map.latLngToLayerPoint(from);
    const p2 = this.map.latLngToLayerPoint(to);
    const angleDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;

    const arrow = L.marker(from, { icon: this._arrowIcon(angleDeg), interactive:false, zIndexOffset: 9999 }).addTo(this.map);

    const dur = 600; // ms
    const start = performance.now();
    const anim = (now)=>{
      const t = Math.min(1, (now - start) / dur);
      const lat = from.lat + (to.lat - from.lat) * t;
      const lon = from.lng + (to.lng - from.lng) * t;
      arrow.setLatLng([lat, lon]);
      if (t < 1) requestAnimationFrame(anim);
      else { try{ this.map.removeLayer(arrow); }catch{}; }
    };
    requestAnimationFrame(anim);
  }

  _addAdminButton(){
    const btn = document.createElement('div');
    btn.className = 'tg-admin-btn';
    btn.textContent = '망루 설치';
    document.body.appendChild(btn);
    this._adminBtn = btn;

    const placeHandler = async (e)=>{
      if (!this._placing) return;
      const lat = e.latlng.lat, lon = e.latlng.lng;
      const rangeStr = prompt('사거리(m)를 입력하세요 (예: 60)', String(this.rangeDefault));
      if (rangeStr === null) return; // 취소
      const range = Math.max(10, Number(rangeStr)||this.rangeDefault);
      try{
        await addDoc(collection(this.db, 'towers'), {
          lat, lon, range, createdAt: serverTimestamp()
        });
      }catch(err){ console.warn('tower add fail:', err); }
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
