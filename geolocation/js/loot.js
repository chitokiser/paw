// /geolocation/js/loot.js

/* -----------------------------
 * RARITY & DROP SYSTEM
 * ----------------------------- */

export const RARITY = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
};

// 가중치는 낮을수록(=희귀할수록) 기본 chance가 작아짐
export const RARITY_WEIGHT = {
  [RARITY.COMMON]: 1,
  [RARITY.UNCOMMON]: 0.55,
  [RARITY.RARE]: 0.22,
  [RARITY.EPIC]: 0.08,
  [RARITY.LEGENDARY]: 0.02,
};

// 내부 유틸: 희귀도 문자열 정규화
function _normRarity(r) {
  if (!r) return RARITY.COMMON;
  const s = String(r).toLowerCase();
  switch (s) {
    case 'common': return RARITY.COMMON;
    case 'uncommon': return RARITY.UNCOMMON;
    case 'rare': return RARITY.RARE;
    case 'epic': return RARITY.EPIC;
    case 'legendary': return RARITY.LEGENDARY;
    default: return RARITY.COMMON;
  }
}

/**
 * lootTable 예시:
 * [
 *   { id:'potion_small', name:'Small Potion', rarity:'common', chance:0.6, min:1, max:2 },
 *   { id:'bone_fragment', name:'Bone Fragment', rarity:'common', chance:0.8, min:2, max:5 },
 *   { id:'mystic_orb', name:'Mystic Orb', rarity:'rare', chance:0.1, min:1, max:1 },
 * ]
 * - chance 미지정 시 rarity 기반 기본 확률 사용 (RARITY_WEIGHT)
 */
export function rollDrops(lootTable = [], rng = Math.random) {
  const out = [];
  for (const e of lootTable) {
    const rarity = _normRarity(e.rarity || 'common');
    const baseChance = RARITY_WEIGHT[rarity] ?? 0.1;
    const chance = (typeof e.chance === 'number') ? e.chance : baseChance;

    if (rng() <= chance) {
      const min = Number.isFinite(e.min) ? e.min : 1;
      const max = Number.isFinite(e.max) ? e.max : 1;
      const qty = Math.floor(rng() * (max - min + 1)) + min;
      out.push({
        id: e.id,
        name: e.name || e.id,
        qty,
        rarity
      });
    }
  }
  return collapseSame(out);
}

function collapseSame(arr) {
  const map = {};
  for (const it of arr) {
    const k = it.id;
    const prev = map[k] || { id: it.id, name: it.name, qty: 0, rarity: it.rarity };
    prev.qty += it.qty || 1;
    prev.rarity = prev.rarity || it.rarity;
    map[k] = prev;
  }
  return Object.values(map);
}

/* -----------------------------
 * WEAPON DATA & OVERRIDES
 * ----------------------------- */
/**
 * - 기본 무기 스탯 정의
 * - Firestore 등 외부 데이터로 덮어쓸 수 있도록 override 지원
 * - 전투코드(playerFx/battle)에서는 getWeaponData(장착아이디)로 스탯을 참조
 */
export const WEAPONS = {
  fist: {
    id: 'fist',
    name: '맨손',
    dmg: 1,             // 공격력
    rangeM: 0.9,        // 근접 사거리(미터)
    cooldownMs: 900,    // 공격 쿨다운
    knockback: 0.2,
    crit: 0.00,
    critMul: 1.00,
    rarity: RARITY.COMMON,
  },

  // 예시: 장검(철)
  longsword_iron: {
    id: 'longsword_iron',
    name: '장검(철)',
    dmg: 8,
    rangeM: 1.6,
    cooldownMs: 650,
    knockback: 0.8,
    crit: 0.10,
    critMul: 1.50,
    rarity: RARITY.UNCOMMON,
  },

  // 필요 시 더 추가...
};

// 무기 여부 유틸 (아이템 id가 WEAPONS에 있는지)
export function isWeaponId(id) {
  return !!WEAPONS[id];
}

// 외부 오버라이드 저장소 (예: Firestore의 items/{weaponId} 값)
let _weaponOverrides = {}; // { [id]: { dmg, rangeM, cooldownMs, knockback, crit, critMul, ... } }

/**
 * setWeaponOverride
 * - 특정 무기의 스탯을 외부 데이터로 덮어쓰기
 * - 예: items/longsword_iron 문서에 dmg, rangeM, cooldownMs 등을 저장해 두고 앱 시작 시 로딩
 */
export function setWeaponOverride(id, data) {
  if (!id || !data) return;
  _weaponOverrides[id] = {
    ...data,
    id
  };
}

/**
 * getWeaponData
 * - 덮어쓰기(override)가 있으면 우선 적용하여 최종 스탯 반환
 * - 정의가 없는 id면 fist로 폴백
 */
export function getWeaponData(id) {
  const base = WEAPONS[id] || WEAPONS.fist;
  const ov = _weaponOverrides[id];
  return ov ? { ...base, ...ov, id: base.id } : base;
}

/* -----------------------------
 * COMMON ITEM HELPERS (선택)
 * ----------------------------- */
/**
 * sanitizeItems
 * - 드랍/인벤 배열을 정규화 (qty 최소 1, rarity 표준화)
 */
export function sanitizeItems(arr) {
  return (arr || [])
    .filter(it => it && it.id)
    .map(it => ({
      id: String(it.id),
      name: String(it.name || it.id),
      qty: Math.max(1, Number(it.qty || 1)),
      rarity: _normRarity(it.rarity || 'common')
    }));
}

/**
 * mergeStacks
 * - 아이템 배열을 id 기준으로 합쳐 1레벨 평탄화된 스택으로 반환
 */
export function mergeStacks(baseArr = [], addArr = []) {
  const out = {};
  for (const src of [sanitizeItems(baseArr), sanitizeItems(addArr)]) {
    for (const it of src) {
      const prev = out[it.id] || { id: it.id, name: it.name, qty: 0, rarity: it.rarity };
      prev.qty += it.qty;
      if (!prev.rarity && it.rarity) prev.rarity = it.rarity;
      out[it.id] = prev;
    }
  }
  return Object.values(out);
}

/* -----------------------------
 * DEFAULT LOOT PRESETS (선택)
 * ----------------------------- */
// 간단한 기본 드랍 테이블 샘플
export const DEFAULT_MONSTER_LOOT = [
  { id: 'potion_small',  name:'Small Potion', rarity: RARITY.COMMON, chance: 0.5, min: 1, max: 2 },
  { id: 'bone_fragment', name:'Bone Fragment', rarity: RARITY.COMMON, chance: 0.75, min: 1, max: 4 },
  // 가끔 무기 파편/낮은 확률의 무기도 가능
  // { id: 'longsword_iron', name:'장검(철)', rarity: RARITY.UNCOMMON, chance: 0.03, min: 1, max: 1 },
];

/* -----------------------------
 * EXPORT DEFAULT (옵션)
 * ----------------------------- */
// 필요 시 하나로 가져오고 싶은 경우
export default {
  RARITY,
  RARITY_WEIGHT,
  rollDrops,
  WEAPONS,
  isWeaponId,
  setWeaponOverride,
  getWeaponData,
  sanitizeItems,
  mergeStacks,
  DEFAULT_MONSTER_LOOT,
};
