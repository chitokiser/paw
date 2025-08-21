// /geolocation/js/inventory.js
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { safeWrite, withWriteGate } from './dbGuard.js';

const LS_KEY_EQUIPPED = 'puppi_equipped_v1'; // 로컬 저장용

function _loadEquippedLS(){
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY_EQUIPPED));
    if (v && typeof v === 'object') return { weapon: v.weapon || 'fist' };
  } catch {}
  return { weapon: 'fist' };
}
function _saveEquippedLS(equipped){
  try { localStorage.setItem(LS_KEY_EQUIPPED, JSON.stringify({ weapon: equipped?.weapon || 'fist' })); } catch {}
}
function _dispatchEquipChanged(slot, id){
  try { window.dispatchEvent(new CustomEvent('equip:changed', { detail: { slot, id } })); } catch {}
}

export class Inventory {
  /**
   * @param {{db:any, guestId:string, onChange?:Function, onEquipChange?:Function}} param0
   */
  constructor({ db, guestId, onChange, onEquipChange }){
    this.db = db;
    this.guestId = String(guestId);
    this.ref = doc(db, 'inventories', this.guestId);

    // 기존 그대로
    this.items = {};

    // 추가: 장비 상태
    this.equipped = _loadEquippedLS(); // { weapon: 'fist' | 'longsword_iron' | ... }

    this._unsub = null;
    this._onChange = typeof onChange === 'function' ? onChange : () => {};
    this._onEquipChange = typeof onEquipChange === 'function' ? onEquipChange : () => {};
  }

  /* =========================
   * 기본 로딩/리스닝 (기존 유지)
   * ========================= */
  async load(opts = {}){
    const snap = await getDoc(this.ref);
    if (snap.exists()){
      const data = snap.data() || {};
      this.items = data.items || {};
      // equipped 동기화(문서에 있으면 우선, 없으면 로컬 유지)
      if (data.equipped && typeof data.equipped === 'object' && data.equipped.weapon){
        this.equipped = { weapon: String(data.equipped.weapon) };
        _saveEquippedLS(this.equipped);
      } else {
        // 문서에 없을 경우 최초 생성 시 equipped 포함해서 병합 저장
        await this._ensureDoc();
      }
    } else {
      // 최초 생성은 setDoc 1회 (equipped 포함)
      await setDoc(this.ref, {
        items: {},
        equipped: this.equipped, // { weapon: 'fist' }
        updatedAt: Date.now()
      });
      this.items = {};
    }
    this._onChange(this.items);
    this._onEquipChange(this.equipped);

    if (opts.autoListen) this.listen();
  }

  listen(){
    if (this._unsub) this._unsub();
    this._unsub = onSnapshot(this.ref, (snap)=>{
      if (!snap.exists()) return;
      const data = snap.data() || {};
      this.items = data.items || {};
      const newEq = (data.equipped && data.equipped.weapon) ? { weapon: String(data.equipped.weapon) } : this.equipped;

      // equipped 변경 감지
      const changed = !this.equipped || (this.equipped.weapon !== newEq.weapon);
      this.equipped = newEq;
      _saveEquippedLS(this.equipped);

      this._onChange(this.items);
      if (changed){
        this._onEquipChange(this.equipped);
        _dispatchEquipChanged('weapon', this.equipped.weapon);
      }
    }, ()=>{ /* 에러 무시 */ });
  }
  stop(){ if (this._unsub) this._unsub(); this._unsub = null; }

  /* =========================
   * 아이템 조작 (기존 유지)
   * ========================= */
  async addItems(arr = []){
    const merged = { ...(this.items || {}) };
    for (const it of arr){
      if (!it?.id) continue;
      const id = String(it.id);
      const prev = merged[id] || { name: it.name || id, qty: 0, rarity: it.rarity };
        merged[id] = {
       ...prev,
       ...it,
       id, // 보정
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
      if (!out.ok) { /* 차단 중이면 낙관적 업데이트 유지 */ }
    };
    const gated = await withWriteGate(key, 1200, doWrite);
    if (gated?.reason === 'gated') {
      // 너무 잦으면 덮어쓰기되도록 조용히 스킵
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
      if (!out.ok) { /* 낙관적 업데이트 유지 */ }
    };
    await withWriteGate(gateKey, 800, doWrite);
    this._onChange(this.items);
    return true;
  }

  async useItem(id, qty = 1){ return this._decrease(id, qty); }
  async dropItem(id, qty = 1){ return this._decrease(id, qty); }

  getAll(){ return this.items; }

  /* =========================
   * 신규: 장비(무기) 관리
   * ========================= */

  /** 현재 장착 무기 id (없으면 'fist') */
  getEquippedWeaponId(){
    return this.equipped?.weapon || 'fist';
  }

  /** 해당 무기 장착 여부 */
  isEquipped(weaponId){
    return this.getEquippedWeaponId() === String(weaponId);
  }

  /** 무기 장착 (예: 'longsword_iron') */
  async equipWeapon(weaponId, { syncDB = true } = {}){
    const wid = String(weaponId || 'fist');
    const changed = (this.equipped?.weapon !== wid);
    this.equipped = { weapon: wid };
    _saveEquippedLS(this.equipped);

    if (syncDB){
      const gateKey = `equip:${this.guestId}`;
      const doWrite = async () => {
        const out = await safeWrite('inventory-equip', () =>
          updateDoc(this.ref, { equipped: this.equipped, updatedAt: Date.now() })
        );
        if (!out.ok) { /* 낙관적 유지 */ }
      };
      await withWriteGate(gateKey, 600, doWrite);
    }
    if (changed){
      this._onEquipChange(this.equipped);
      _dispatchEquipChanged('weapon', this.equipped.weapon);
    }
    return this.equipped.weapon;
  }

  /** 무기 해제 → 'fist' */
  async unequipWeapon(opts = {}){
    return this.equipWeapon('fist', opts);
  }

  /** 편의: 장검 전용 */
  async equipLongsword(opts = {}){
    return this.equipWeapon('longsword_iron', opts);
  }

  /** 서버 문서에 equipped 필드가 없으면 채워 넣기 */
  async _ensureDoc(){
    const snap = await getDoc(this.ref);
    if (!snap.exists()){
      await setDoc(this.ref, { items: {}, equipped: this.equipped, updatedAt: Date.now() });
      return;
    }
    const data = snap.data() || {};
    if (!data.equipped || !data.equipped.weapon){
      await updateDoc(this.ref, { equipped: this.equipped, updatedAt: Date.now() });
    }
  }
}
