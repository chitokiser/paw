// /geolocation/js/inventoryTransfer.js
// 인벤토리 지급/이전/소비 유틸 (지갑주소 기반 inventories/wa:<address> 문서 사용)

import {
  doc, getDoc, setDoc, updateDoc, runTransaction,
  increment, serverTimestamp, FieldPath, deleteField
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { rollDrops } from './loot.js';
import { safeWrite } from './dbGuard.js';
import { ensureInventoryDoc } from './identity.js'; // 반드시 inventories/wa:<address> 반환하도록 구현

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

/* =========================================================
 * 상점/보상 지급: 트랜잭션으로 안전 병합
 * guestId = inventories 문서 ID(보통 "wa:<address>")
 * ======================================================= */
export async function grantItemsDirect(db, { guestId, items }) {
  const invRef = doc(db, 'inventories', String(guestId));

  const out = await safeWrite(`grant-${guestId}`, () =>
    runTransaction(db, async (tx) => {
      const grant = sanitizeItems(items);
      if (!grant.length) return [];

      // 문서 보장
      const snap = await tx.get(invRef);
      if (!snap.exists()) {
        tx.set(invRef, {
          items: {}, owner: String(guestId), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        }, { merge: true });
      }

      // 각 아이템 병합 (FieldPath 페어 나열형)
      for (const it of grant) {
        tx.update(
          invRef,
          fpQty(it.id),    increment(it.qty),
          fpName(it.id),   it.name,
          fpRarity(it.id), it.rarity,
          'updatedAt',     serverTimestamp()
        );
      }
      return grant;
    })
  );

  if (!out.ok) throw (out.error || new Error('grant blocked'));
  return out.res || [];
}

/* =========================================================
 * 전리품 이전(몬스터 → 인벤)
 *  - 몬스터 쿨다운 예약만 반영(dead/alive/resawnAt은 존중)
 *  - items / lootTable / DEFAULT 순서로 드롭 산출
 *  - 빨간약 1개 보장
 *  - inventories/wa:<address> 문서에 병합
 * ======================================================= */
export async function transferMonsterInventory(db, { monsterId, guestId }) {
  // 현재 지갑 세션 기준 인벤 문서 보장(주소 기반)
  const invRef = await ensureInventoryDoc(db);
  if (!invRef) throw new Error('인벤 문서를 찾을 수 없습니다');

  const monRef = doc(db, 'monsters', String(monsterId));

  const out = await safeWrite(`loot-${monsterId}`, () =>
    runTransaction(db, async (tx) => {
      const monSnap = await tx.get(monRef);
      if (!monSnap.exists()) throw new Error('monster doc not found');
      const mon = monSnap.data() || {};

      const now = Date.now();
      const cdUntil = Number(mon.cooldownUntil || 0);
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
        lastKilledBy:  String(guestId || 'unknown'),
        killSeq:       increment(1)
      });

      return drops;
    })
  );

  if (!out.ok) throw (out.error || new Error('loot-transfer blocked'));
  return out.res || [];
}

/* =========================================================
 * 조회/소비(-1) — 숫자형/객체형 스키마 모두 지원
 * ======================================================= */

/** 현재 수량 조회: { kind: 'object'|'number'|'none', qty } */
export async function getItemQty(db, { guestId, itemId }) {
  const invRef = doc(db, 'inventories', String(guestId));
  const snap = await getDoc(invRef);
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
  if (!db) throw new Error('NO_DB');
  if (!guestId) throw new Error('NO_GUEST');
  if (!itemId) throw new Error('NO_ITEM');

  const invRef = doc(db, 'inventories', String(guestId));

  const out = await safeWrite(`consume-${guestId}-${itemId}`, () =>
    runTransaction(db, async (tx) => {
      const snap = await tx.get(invRef);
      if (!snap.exists()) throw new Error('NO_STOCK');

      const items = (snap.data() || {}).items || {};
      const cur = items[itemId];

      // 숫자형: items.<id> = number
      if (typeof cur === 'number') {
        const curQty = Number.isFinite(cur) ? cur : 0;
        if (curQty <= 0) throw new Error('NO_STOCK');

        if (curQty - 1 <= 0) {
          tx.update(invRef, fpItem(itemId), deleteField(), 'updatedAt', serverTimestamp());
          return 0;
        } else {
          tx.update(invRef, fpItem(itemId), increment(-1), 'updatedAt', serverTimestamp());
          return curQty - 1;
        }
      }

      // 객체형: items.<id> = { name, qty, rarity }
      if (typeof cur === 'object' && cur) {
        const curQty = Number.isFinite(Number(cur.qty)) ? Number(cur.qty) : 0;
        if (curQty <= 0) throw new Error('NO_STOCK');

        if (curQty - 1 <= 0) {
          tx.update(invRef, fpItem(itemId), deleteField(), 'updatedAt', serverTimestamp());
          return 0;
        } else {
          tx.update(invRef, fpQty(itemId), curQty - 1, 'updatedAt', serverTimestamp());
          return curQty - 1;
        }
      }

      throw new Error('NO_STOCK');
    })
  );

  if (!out.ok) throw (out.error || new Error('consume blocked'));
  return out.res;
}

/* =========================================================
 * 편의: 현재 세션 인벤 문서에 간단 지급(필드 경로 문자열 버전)
 *  - 상점 등 “트랜잭션 필요 없음” 케이스용
 * ======================================================= */
export async function grantToCurrentInventory(db, items) {
  const invRef = await ensureInventoryDoc(db);
  if (!invRef) throw new Error('인벤 문서를 찾을 수 없습니다');

  const grant = sanitizeItems(items);
  if (!grant.length) return [];

  const payload = { updatedAt: serverTimestamp() };
  for (const it of grant) {
    payload[`items.${it.id}.qty`]    = increment(it.qty);
    payload[`items.${it.id}.name`]   = it.name;
    payload[`items.${it.id}.rarity`] = it.rarity;
  }
  await updateDoc(invRef, payload);
  return grant;
}

export default {
  grantItemsDirect,
  transferMonsterInventory,
  getItemQty,
  consumeItemOnce,
  grantToCurrentInventory
};
