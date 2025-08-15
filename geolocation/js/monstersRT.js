// /geolocation/js/monstersRT.js
import { collection, onSnapshot, doc, runTransaction } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export class RealTimeMonsters {
  constructor({ db, map, makeImageDivIcon, DEFAULT_IMG, attachMonsterBattle, monstersGuard }) {
    this.db = db;
    this.map = map;
    this.makeImageDivIcon = makeImageDivIcon;
    this.DEFAULT_IMG = DEFAULT_IMG;
    this.attachMonsterBattle = attachMonsterBattle;
    this.monstersGuard = monstersGuard;
    this.reg = new Map(); // id -> { marker, data, sizePx, bound }
    this.unsub = null;
  }

  start() {
    if (this.unsub) return;
    this.unsub = onSnapshot(collection(this.db,'monsters'), (qs)=>{
      const now = Date.now();
      qs.docChanges().forEach(ch=>{
        const id = ch.doc.id;
        const d  = ch.doc.data() || {};

        const alive = (d.alive !== false) && (d.dead !== true);
        const respawnAt = Number(d.respawnAt || 0);
        const hasPos = Number.isFinite(d.lat) && Number.isFinite(d.lon);
        const shouldShow = alive && respawnAt <= now && hasPos;

        // (A) 안전장치: respawnAt 지났는데 아직 죽음 → 즉시 복구
        if ((!alive || d.dead===true) && respawnAt>0 && respawnAt<=now) {
          this._reviveOnRead(id).then(()=>{
            try{ this.monstersGuard?.killedLocal?.delete(String(id)); }catch{}
          });
        }

        // (B) 표시/갱신
        if (shouldShow) this._ensureShown(id, d);
        else           this._ensureHidden(id);
      });
    });
  }

  stop() { try{ this.unsub?.(); }finally{ this.unsub=null; } }

  _ensureShown(id, d) {
    const sizePx = this._sizeOf(d.size);
    let rec = this.reg.get(id);

    if (!rec) {
      const icon = this.makeImageDivIcon(d.imagesURL ?? d.imageURL ?? d.iconURL ?? this.DEFAULT_IMG, sizePx);
      const marker = L.marker([d.lat, d.lon], { icon, interactive:true }).addTo(this.map);
      rec = { marker, data:d, sizePx, bound:false };
      this.reg.set(id, rec);
      this.attachMonsterBattle(marker, id, d); // 클릭 전투 + HP바
      rec.bound = true;
    } else {
      rec.marker.setLatLng([d.lat, d.lon]);

      const imgChanged =
        (rec.data?.imagesURL ?? rec.data?.imageURL ?? rec.data?.iconURL) !==
        (d.imagesURL ?? d.imageURL ?? d.iconURL);

      if (imgChanged || rec.sizePx !== sizePx) {
        rec.marker.setIcon(this.makeImageDivIcon(d.imagesURL ?? d.imageURL ?? d.iconURL ?? this.DEFAULT_IMG, sizePx));
        rec.sizePx = sizePx;
        rec.bound = false; // DOM 재구성 → 재바인딩 필요
      }
      rec.data = d;

      if (!rec.bound) {
        this.attachMonsterBattle(rec.marker, id, d);
        rec.bound = true;
      }
    }
  }

  _ensureHidden(id) {
    const rec = this.reg.get(id);
    if (!rec) return;
    try{ rec.marker.remove(); }catch{}
    try{ this.map.removeLayer(rec.marker); }catch{}
    try{ rec.marker.getElement()?.remove(); }catch{}
    this.reg.delete(id);
  }

  _sizeOf(n){ const v=Number(n); return Number.isNaN(v)?96:Math.max(24,Math.min(v,256)); }

  async _reviveOnRead(id){
    try{
      await runTransaction(this.db, async tx=>{
        const ref = doc(this.db,'monsters',id);
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const cur = snap.data()||{};
        const alive = (cur.alive !== false) && (cur.dead !== true);
        if ((!alive || cur.dead===true) && Number(cur.respawnAt||0) <= Date.now()){
          tx.update(ref,{ alive:true, dead:false, respawnAt:0, updatedAt:Date.now() });
        }
      });
    }catch(e){ console.warn('revive-on-read failed', e); }
  }
}
