// /geolocation/js/inventory.js
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export class Inventory {
  constructor({ db, guestId, onChange }){
    this.db = db;
    this.guestId = String(guestId);
    this.ref = doc(db, 'inventories', this.guestId);
    this.items = {}; // { [id]: { name, qty, rarity? } }
    this._unsub = null;
    this._onChange = typeof onChange === 'function' ? onChange : () => {};
  }

  async load(){
    const snap = await getDoc(this.ref);
    if (snap.exists()){
      const data = snap.data() || {};
      this.items = data.items || {};
    } else {
      await setDoc(this.ref, { items: {}, updatedAt: Date.now() });
      this.items = {};
    }
    this._onChange(this.items);
  }

  listen(){
    if (this._unsub) this._unsub();
    this._unsub = onSnapshot(this.ref, (snap)=>{
      if (!snap.exists()) return;
      const data = snap.data() || {};
      this.items = data.items || {};
      this._onChange(this.items);
    });
  }

  stop(){ if (this._unsub) this._unsub(); this._unsub = null; }

  // 로컬 머지 + 서버 반영
  async addItems(arr = []){
    const merged = { ...(this.items || {}) };
    for (const it of arr){
      if (!it?.id) continue;
      const id = String(it.id);
      const prev = merged[id] || { name: it.name || id, qty: 0, rarity: it.rarity };
      merged[id] = {
        name: prev.name || it.name || id,
        qty: Number(prev.qty || 0) + Number(it.qty || 1),
        rarity: prev.rarity || it.rarity // 희귀도 보전
      };
    }
    this.items = merged;
    await updateDoc(this.ref, { items: this.items, updatedAt: Date.now() });
    this._onChange(this.items);
  }

  // 사용/버리기 공통 감소
  async _decrease(id, qty){
    const key = String(id);
    if (!this.items[key]) return false;
    const left = Math.max(0, Number(this.items[key].qty || 0) - Number(qty || 1));
    if (left === 0) delete this.items[key];
    else this.items[key].qty = left;
    await updateDoc(this.ref, { items: this.items, updatedAt: Date.now() });
    this._onChange(this.items);
    return true;
  }

  async useItem(id, qty = 1){ return this._decrease(id, qty); }
  async dropItem(id, qty = 1){ return this._decrease(id, qty); }

  getAll(){ return this.items; }
}
