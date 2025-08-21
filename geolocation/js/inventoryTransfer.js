// /geolocation/js/inventoryTransfer.js
import {
  doc, runTransaction, increment, deleteField
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { rollDrops } from './loot.js';
import { safeWrite } from './dbGuard.js';

/* =========================================================
 * 공통 유틸
 * ======================================================= */
const DEFAULT_DROP = [
  { id: 'potion_small',  name: 'Small Potion',  qty: 2, rarity: 'common' },
  { id: 'bone_fragment', name: 'Bone Fragment', qty: 3, rarity: 'common' }
];

function sanitizeItems(arr){
  return (arr||[])
    .filter(it => it && it.id)
    .map(it => ({
      id: String(it.id),
      name: String(it.name || it.id),
      qty: Math.max(1, Number(it.qty || 1)),
      rarity: String(it.rarity || 'common')
    }));
}

/** 인벤 합치기: items 맵({ id: {name, qty, rarity} })로 누적 */
function mergeIntoMap(baseMap, arr){
  const out = { ...(baseMap || {}) };
  for (const it of (arr || [])){
    if (!it?.id) continue;
    const key = String(it.id);
    const prev = out[key] || { name: it.name || key, qty: 0, rarity: it.rarity || 'common' };
    out[key] = {
      name: prev.name || it.name || key,
      qty: Number(prev.qty||0) + Math.max(1, Number(it.qty||1)),
      rarity: prev.rarity || it.rarity || 'common'
    };
  }
  return out;
}

/* =========================================================
 * 지급(상점/보상) — 스냅샷 병합
 * ======================================================= */
async function _grantItemsDirect(db, guestId, items){
  const invRef = doc(db, 'inventories', String(guestId));

  const out = await safeWrite(`grant-${guestId}`, () =>
    runTransaction(db, async (tx) => {
      const grant = sanitizeItems(items);
      if (!grant.length) return [];

      const invSnap = await tx.get(invRef);
      const invData = invSnap.exists() ? (invSnap.data() || {}) : {};
      const merged = mergeIntoMap(invData.items || {}, grant);
      const updatedAt = Date.now();

      if (!invSnap.exists()) {
        tx.set(invRef, { items: merged, updatedAt, owner: String(guestId) });
      } else {
        tx.update(invRef, { items: merged, updatedAt });
      }
      return grant;
    })
  );

  if (!out.ok) throw (out.error || new Error('grant blocked'));
  return out.res || [];
}

/* =========================================================
 * 전리품 이전(몬스터 → 인벤)
 *  - cooldownUntil 예약만 (dead/alive/timer는 건드리지 않음)
 *  - items → lootTable → DEFAULT
 *  - 빨간약(red_potion) 보장(원본 유지)
 * ======================================================= */
async function _transferFromMonster(db, { monsterId, guestId }){
  const monRef = doc(db, 'monsters', String(monsterId));
  const invRef = doc(db, 'inventories', String(guestId));

  const out = await safeWrite(`loot-transfer-${monsterId}-${guestId}`, () =>
    runTransaction(db, async (tx) => {
      // 몬스터 읽기
      const monSnap = await tx.get(monRef);
      if (!monSnap.exists()) throw new Error('monster doc not found');
      const mon = monSnap.data() || {};

      const now = Date.now();
      const cooldownUntil = Number(mon.cooldownUntil || 0);
      const cooldownMs = Math.max(1_000, Number(mon.cooldownMs ?? mon.respawnMs ?? 600_000));

      // 레거시(죽음/리스폰) 우선 존중
      const legacyDead = (mon.dead === true) || (mon.alive === false);
      const legacyRespawnAt = Number(mon.respawnAt || 0);
      if (legacyDead && legacyRespawnAt > now) {
        const err = Object.assign(new Error('on cooldown'), { code: 'cooldown' });
        throw err;
      }

      // 쿨다운 중이면 차단
      if (now < cooldownUntil) {
        const err = Object.assign(new Error('on cooldown'), { code: 'cooldown' });
        throw err;
      }

      // 드롭 산출
      let drops = [];
      if (Array.isArray(mon.items) && mon.items.length > 0) {
        drops = sanitizeItems(mon.items);
      } else if (Array.isArray(mon.lootTable) && mon.lootTable.length > 0) {
        drops = sanitizeItems(rollDrops(mon.lootTable));
      }
      if (!drops || drops.length === 0) drops = sanitizeItems(DEFAULT_DROP);

      // 빨간약 보장(상점지급에는 미적용)
      const hasRed = drops.some(it => it.id === 'red_potion' || it.name === '빨간약');
      if (!hasRed) drops = [{ id:'red_potion', name:'빨간약', qty:1, rarity:'common' }, ...drops];

      // 인벤 병합
      const invSnap = await tx.get(invRef);
      const invData = invSnap.exists() ? (invSnap.data() || {}) : {};
      const merged = mergeIntoMap(invData.items || {}, drops);
      const updatedAt = now;

      if (!invSnap.exists()) {
        tx.set(invRef, { items: merged, updatedAt, owner: String(guestId) });
      } else {
        tx.update(invRef, { items: merged, updatedAt });
      }

      // 몬스터: 쿨다운 예약
      tx.update(monRef, {
        cooldownUntil: now + cooldownMs,
        lastKilledAt: now,
        lastKilledBy: String(guestId),
        killSeq: increment(1)
      });

      return drops;
    })
  );

  if (!out.ok) throw (out.error || new Error('loot-transfer blocked'));
  return out.res || [];
}

/* =========================================================
 * 조회/소비(-1) — 스키마 혼용(숫자형/객체형) 모두 지원
 * ======================================================= */

/** 현재 수량 조회: { kind: 'object'|'number'|'none', qty } */
export async function getItemQty(db, { guestId, itemId }) {
  const invRef = doc(db, 'inventories', String(guestId));
  const snap = await getDoc(invRef);
  if (!snap.exists()) return { kind: 'none', qty: 0 };
  const data = snap.data() || {};
  const items = data.items || {};
  const cur = items[itemId];
  if (cur == null) return { kind: 'none', qty: 0 };

  if (typeof cur === 'number') {
    return { kind: 'number', qty: Number.isFinite(cur) ? cur : 0 };
  }
  if (typeof cur === 'object' && cur) {
    const q = Number(cur.qty);
    return { kind: 'object', qty: Number.isFinite(q) ? q : 0 };
  }
  return { kind: 'none', qty: 0 };
}

/**
 * 아이템 1개 소비(-1)
 * - 숫자형: items.<id> → increment(-1). 0 되면 키 삭제
 * - 객체형: items.<id>.qty - 1. 0 되면 items.<id> 삭제
 * - 성공 시 차감 후 수량 반환(0 이상)
 */
export async function consumeItemOnce(db, { guestId, itemId }) {
  if (!db) throw new Error('NO_DB');
  if (!guestId) throw new Error('NO_GUEST');
  if (!itemId) throw new Error('NO_ITEM');

  const invRef = doc(db, 'inventories', String(guestId));

  const out = await safeWrite(`consume-${guestId}-${itemId}`, () =>
    runTransaction(db, async (tx) => {
      const snap = await tx.get(invRef);
      if (!snap.exists()) throw new Error('NO_STOCK');

      const data = snap.data() || {};
      const items = data.items || {};
      const cur = items[itemId];
      const now = Date.now();

      // (숫자형) items.<id> = number
      if (typeof cur === 'number') {
        const curQty = Number.isFinite(cur) ? cur : 0;
        if (curQty <= 0) throw new Error('NO_STOCK');

        if (curQty - 1 <= 0) {
          tx.update(invRef, { ['items.' + itemId]: deleteField(), updatedAt: now });
          return 0;
        } else {
          tx.update(invRef, { ['items.' + itemId]: increment(-1), updatedAt: now });
          return curQty - 1;
        }
      }

      // (객체형) items.<id> = { name, qty, rarity }
      if (typeof cur === 'object' && cur) {
        const curQty = Number(cur.qty);
        const safeCur = Number.isFinite(curQty) ? curQty : 0;
        if (safeCur <= 0) throw new Error('NO_STOCK');

        if (safeCur - 1 <= 0) {
          tx.update(invRef, { ['items.' + itemId]: deleteField(), updatedAt: now });
          return 0;
        } else {
          tx.update(invRef, { ['items.' + itemId + '.qty']: safeCur - 1, updatedAt: now });
          return safeCur - 1;
        }
      }

      // 없음
      throw new Error('NO_STOCK');
    })
  );

  if (!out.ok) throw (out.error || new Error('consume blocked'));
  return out.res;
}

/* =========================================================
 * 공개 API — 통합 진입점(원본 호환 + 상점지급 오버로드)
 * ======================================================= */
export async function transferMonsterInventory(db, arg1, arg2){
  // (2) 상점/직접 지급: (db, guestId:string, items:Array)
  if (typeof arg1 === 'string' && Array.isArray(arg2)){
    const guestId = arg1;
    const items   = arg2;
    return _grantItemsDirect(db, guestId, items);
  }

  // (1) 몬스터 전리품: (db, {monsterId, guestId})
  if (arg1 && typeof arg1 === 'object' && arg1.monsterId && arg1.guestId){
    return _transferFromMonster(db, arg1);
  }

  throw new Error('Invalid arguments for transferMonsterInventory');
}

export default transferMonsterInventory;
