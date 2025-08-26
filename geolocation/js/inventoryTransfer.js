// /geolocation/js/inventoryTransfer.js
// 인벤토리 지급/이전/소비 유틸 (지갑주소 기반 inventories/wa:<address> 문서 사용)
// - 외부 지갑/세션 의존 없음: 모든 함수는 명시적 guestId("wa:<address>") 인자를 받음
// - monstersRT 폴백 제거: monsters 컬렉션만 사용
// - 모든 변경은 Firestore 트랜잭션(runTransaction)으로 일관 처리

import {
  doc, getDoc, setDoc, updateDoc, runTransaction,
  increment, serverTimestamp, FieldPath, deleteField
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { rollDrops } from './loot.js';

/* =========================================================
 * 공통 유틸
 * ======================================================= */
const DEFAULT_DROP = [
  { id: 'potion_small',  name: 'Small Potion',  qty: 2, rarity: 'common' },
  { id: 'bone_fragment', name: 'Bone Fragment', qty: 3, rarity: 'common' }
];

const sanitizeItems = (arr) => (arr||[])
  .filter(it => it && it.id)
  .map(it => ({
    id: String(it.id),
    name: String(it.name || it.id),
    qty: Math.max(1, Number(it.qty || 1)),
    rarity: String(it.rarity || 'common')
  }));

// FieldPath helpers
const fpItem   = (id) => new FieldPath('items', String(id));
const fpQty    = (id) => new FieldPath('items', String(id), 'qty');
const fpName   = (id) => new FieldPath('items', String(id), 'name');
const fpRarity = (id) => new FieldPath('items', String(id), 'rarity');

// inventories 문서 참조 헬퍼(guestId는 반드시 "wa:<addressLower>" 형식)
function invDoc(db, guestId){
  if (!db)       throw new Error('NO_DB');
  if (!guestId)  throw new Error('NO_GUEST');
  return doc(db, 'inventories', String(guestId));
}

/* =========================================================
 * 상점/보상 지급: 트랜잭션 안전 병합
 * guestId = "wa:<address>"
 * ======================================================= */
export async function grantItemsDirect(db, { guestId, items }) {
  const ref = invDoc(db, guestId);

  return await runTransaction(db, async (tx) => {
    const grant = sanitizeItems(items);
    if (!grant.length) return [];

    // 문서 보장
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        owner: String(guestId),
        items: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    // 각 아이템 병합
    for (const it of grant) {
      tx.update(
        ref,
        fpQty(it.id),    increment(it.qty),
        fpName(it.id),   it.name,
        fpRarity(it.id), it.rarity,
        'updatedAt',     serverTimestamp()
      );
    }
    return grant;
  });
}

/* =========================================================
 * 전리품 이전(몬스터 → 인벤)
 *  - 몬스터 쿨다운 예약
 *  - items / lootTable / DEFAULT 순서로 드롭 산출
 *  - 빨간약 1개 보장
 *  - inventories/wa:<address> 문서에 병합
 * ======================================================= */
export async function transferMonsterInventory(db, { monsterId, guestId }) {
  if (!monsterId) throw new Error('NO_MONSTER');

  const invRef = invDoc(db, guestId);
  const monRef = doc(db, 'monsters', String(monsterId));

  return await runTransaction(db, async (tx) => {
    const monSnap = await tx.get(monRef);
    if (!monSnap.exists()) throw new Error('monster doc not found');

    const mon = monSnap.data() || {};
    const now = Date.now();

    const cdUntil    = Number(mon.cooldownUntil || 0);
    const legacyDead = (mon.dead === true) || (mon.alive === false);
    const legacyResp = Number(mon.respawnAt || 0);
    const cooldownMs = Math.max(1_000, Number(mon.cooldownMs ?? mon.respawnMs ?? 600_000));

    if ((legacyDead && legacyResp > now) || now < cdUntil) {
      const err = Object.assign(new Error('on cooldown'), { code: 'cooldown' });
      throw err;
    }

    // 드롭 산출
    let drops = [];
    if (Array.isArray(mon.items) && mon.items.length) {
      drops = sanitizeItems(mon.items);
    } else if (Array.isArray(mon.lootTable) && mon.lootTable.length) {
      drops = sanitizeItems(rollDrops(mon.lootTable));
    }
    if (!drops.length) drops = sanitizeItems(DEFAULT_DROP);

    // 빨간약 보장
    if (!drops.some(it => it.id === 'red_potion' || it.name === '빨간약')) {
      drops.unshift({ id:'red_potion', name:'빨간약', qty:1, rarity:'common' });
    }

    // 인벤 문서 보장
    const invSnap = await tx.get(invRef);
    if (!invSnap.exists()) {
      tx.set(invRef, { items:{}, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge:true });
    }

    // 병합
    for (const it of drops) {
      tx.update(
        invRef,
        fpQty(it.id),    increment(it.qty),
        fpName(it.id),   it.name,
        fpRarity(it.id), it.rarity,
        'updatedAt',     serverTimestamp()
      );
    }

    // 몬스터 쿨다운 예약
    tx.update(monRef, {
      cooldownUntil: now + cooldownMs,
      lastKilledAt:  now,
      lastKilledBy:  String(guestId),
      killSeq:       increment(1)
    });

    return drops;
  });
}

/* =========================================================
 * 조회/소비(-1) — 숫자형/객체형 스키마 모두 지원
 * ======================================================= */

/** 현재 수량 조회: { kind: 'object'|'number'|'none', qty } */
export async function getItemQty(db, { guestId, itemId }) {
  if (!itemId) throw new Error('NO_ITEM');
  const ref = invDoc(db, guestId);

  const snap = await getDoc(ref);
  if (!snap.exists()) return { kind: 'none', qty: 0 };

  const items = (snap.data() || {}).items || {};
  const cur = items[itemId];
  if (cur == null) return { kind: 'none', qty: 0 };

  if (typeof cur === 'number') {
    return { kind: 'number', qty: Number.isFinite(cur) ? cur : 0 };
  }
  if (typeof cur === 'object') {
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
  if (!itemId) throw new Error('NO_ITEM');
  const ref = invDoc(db, guestId);

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('NO_STOCK');

    const items = (snap.data() || {}).items || {};
    const cur = items[itemId];

    // 숫자형: items.<id> = number
    if (typeof cur === 'number') {
      const curQty = Number.isFinite(cur) ? cur : 0;
      if (curQty <= 0) throw new Error('NO_STOCK');

      if (curQty - 1 <= 0) {
        tx.update(ref, fpItem(itemId), deleteField(), 'updatedAt', serverTimestamp());
        return 0;
      } else {
        tx.update(ref, fpItem(itemId), increment(-1), 'updatedAt', serverTimestamp());
        return curQty - 1;
      }
    }

    // 객체형: items.<id> = { name, qty, rarity }
    if (typeof cur === 'object' && cur) {
      const curQty = Number.isFinite(Number(cur.qty)) ? Number(cur.qty) : 0;
      if (curQty <= 0) throw new Error('NO_STOCK');

      if (curQty - 1 <= 0) {
        tx.update(ref, fpItem(itemId), deleteField(), 'updatedAt', serverTimestamp());
        return 0;
      } else {
        tx.update(ref, fpQty(itemId), curQty - 1, 'updatedAt', serverTimestamp());
        return curQty - 1;
      }
    }

    throw new Error('NO_STOCK');
  });
}

/* =========================================================
 * 편의: 현재 세션 인벤 문서에 간단 지급(트랜잭션 불필요 케이스)
 *  - 가이드대로 guestId를 명시적으로 받습니다.
 * ======================================================= */
export async function grantToInventory(db, { guestId, items }) {
  const ref = invDoc(db, guestId);

  const grant = sanitizeItems(items);
  if (!grant.length) return [];

  const payload = { updatedAt: serverTimestamp() };
  for (const it of grant) {
    payload[`items.${it.id}.qty`]    = increment(it.qty);
    payload[`items.${it.id}.name`]   = it.name;
    payload[`items.${it.id}.rarity`] = it.rarity;
  }

  // 문서 없으면 생성
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { owner:String(guestId), items:{}, createdAt: serverTimestamp() }, { merge:true });
  }
  await updateDoc(ref, payload);
  return grant;
}

export default {
  grantItemsDirect,
  transferMonsterInventory,
  getItemQty,
  consumeItemOnce,
  grantToInventory,
};
