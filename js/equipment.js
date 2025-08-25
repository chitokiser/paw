// /geolocation/js/equipment.js
const LS_KEY = 'equip:v1';

function _load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function _save(obj){ try { localStorage.setItem(LS_KEY, JSON.stringify(obj || {})); } catch {} }

const _subs = new Set();
function _emit(){ const s=_load(); _subs.forEach(fn=>{ try{fn(s);}catch{} }); }

export function onEquipmentChange(fn){
  if (typeof fn !== 'function') return ()=>{};
  _subs.add(fn); try{ fn(_load()); }catch{}
  return ()=> _subs.delete(fn);
}

export function getEquippedWeapon(){
  const s=_load();
  const w = s.weapon;
  if (!w) return null;
  return {
    id: String(w.id),
    name: String(w.name || w.id),
    baseAtk: Number(w.baseAtk || w.weapon?.baseAtk || 0),
    // extraInit(=추가 크확) -> extraCrit으로 통일
    extraCrit: Number(w.extraCrit ?? w.weapon?.extraInit ?? w.extraInit ?? 0)
  };
}

export async function equipWeapon(item){
  if (!item) return;
  const state=_load();
  state.weapon = {
    id: String(item.id || item.itemId || 'weapon'),
    name: String(item.name || 'weapon'),
    baseAtk: Number(item.baseAtk ?? item.weapon?.baseAtk ?? 0),
    extraCrit: Number(item.extraCrit ?? item.weapon?.extraInit ?? 0)
  };
  _save(state); _emit();
}

export async function unequipWeapon(){
  const s=_load(); if (!s.weapon) return;
  delete s.weapon; _save(s); _emit();
}
