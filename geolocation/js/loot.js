// /geolocation/js/loot.js
export const RARITY = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
};

// 기본 가중치(필요시 조절)
export const RARITY_WEIGHT = {
  [RARITY.COMMON]: 1,
  [RARITY.UNCOMMON]: 0.55,
  [RARITY.RARE]: 0.22,
  [RARITY.EPIC]: 0.08,
  [RARITY.LEGENDARY]: 0.02,
};

/**
 * lootTable 예시:
 * [
 *   { id:'potion_small', name:'Small Potion', rarity:'common', chance:0.6, min:1, max:2 },
 *   { id:'bone_fragment', name:'Bone Fragment', rarity:'common', chance:0.8, min:2, max:5 },
 *   { id:'mystic_orb', name:'Mystic Orb', rarity:'rare', chance:0.1, min:1, max:1 },
 * ]
 */
export function rollDrops(lootTable = [], rng = Math.random){
  const out = [];
  for (const e of lootTable){
    const chance = (typeof e.chance === 'number') ? e.chance : (RARITY_WEIGHT[(e.rarity||'common').toLowerCase()] || 0.1);
    if (rng() <= chance){
      const min = Number.isFinite(e.min) ? e.min : 1;
      const max = Number.isFinite(e.max) ? e.max : 1;
      const qty = Math.floor(rng() * (max - min + 1)) + min;
      out.push({ id: e.id, name: e.name || e.id, qty, rarity: (e.rarity||'common').toLowerCase() });
    }
  }
  return collapseSame(out);
}

function collapseSame(arr){
  const map = {};
  for (const it of arr){
    const k = it.id;
    const prev = map[k] || { id: it.id, name: it.name, qty: 0, rarity: it.rarity };
    prev.qty += it.qty || 1;
    prev.rarity = prev.rarity || it.rarity;
    map[k] = prev;
  }
  return Object.values(map);
}
