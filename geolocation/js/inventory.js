import { doc, getDoc, setDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { safeWrite, withWriteGate } from './dbGuard.js';

export class Inventory {
  constructor({ db, guestId, onChange }){
    this.db = db;
    this.guestId = String(guestId);
    this.ref = doc(db, 'inventories', this.guestId);
    this.items = {};
    this._unsub = null;
    this._onChange = typeof onChange === 'function' ? onChange : () => {};
  }

  async load(opts = {}){
    const snap = await getDoc(this.ref);
    if (snap.exists()){
      const data = snap.data() || {};
      this.items = data.items || {};
    } else {
      // 최초 생성은 setDoc 1회
      await setDoc(this.ref, { items: {}, updatedAt: Date.now() });
      this.items = {};
    }
    this._onChange(this.items);
    if (opts.autoListen) this.listen();
  }

  listen(){
    if (this._unsub) this._unsub();
    this._unsub = onSnapshot(this.ref, (snap)=>{
      if (!snap.exists()) return;
      const data = snap.data() || {};
      this.items = data.items || {};
      this._onChange(this.items);
    }, ()=>{ /* 에러 무시 */ });
  }
  stop(){ if (this._unsub) this._unsub(); this._unsub = null; }

  async addItems(arr = []){
    const merged = { ...(this.items || {}) };
    for (const it of arr){
      if (!it?.id) continue;
      const id = String(it.id);
      const prev = merged[id] || { name: it.name || id, qty: 0, rarity: it.rarity };
      merged[id] = {
        name: prev.name || it.name || id,
        qty: Number(prev.qty || 0) + Number(it.qty || 1),
        rarity: prev.rarity || it.rarity
      };
    }
    this.items = merged;

    // 🔒 per-user 쓰기 게이트 (최소 간격 1200ms)
    const key = `inv:${this.guestId}`;
    const doWrite = async () => {
      const out = await safeWrite('inventory-addItems', () =>
        updateDoc(this.ref, { items: this.items, updatedAt: Date.now() })
      );
      if (!out.ok) {
        // 차단 중이면 UI는 즉시 반영(낙관적 업데이트), 서버는 큐로 재시도
      }
    };
    const gated = await withWriteGate(key, 1200, doWrite);
    if (gated?.reason === 'gated') {
      // 너무 잦으면 덮어쓰기되도록 조용히 스킵 (다음 호출에서 최신 상태가 저장됨)
    }
    this._onChange(this.items);
  }

  async _decrease(id, qty){
    const key = String(id);
    if (!this.items[key]) return false;
    const left = Math.max(0, Number(this.items[key].qty || 0) - Number(qty || 1));
    if (left === 0) delete this.items[key];
    else this.items[key].qty = left;

    const gateKey = `inv:${this.guestId}`;
    const doWrite = async () => {
      const out = await safeWrite('inventory-decrease', () =>
        updateDoc(this.ref, { items: this.items, updatedAt: Date.now() })
      );
      if (!out.ok) { /* 낙관적 업데이트 */ }
    };
    await withWriteGate(gateKey, 800, doWrite);
    this._onChange(this.items);
    return true;
  }

  async useItem(id, qty = 1){ return this._decrease(id, qty); }
  async dropItem(id, qty = 1){ return this._decrease(id, qty); }

  getAll(){ return this.items; }
}
