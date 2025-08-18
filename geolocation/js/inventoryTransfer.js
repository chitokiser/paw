// /geolocation/js/inventoryTransfer.js 
import { doc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { rollDrops } from './loot.js';
import { safeWrite } from './dbGuard.js';

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

/** 인벤 합치기 (원본 로직과 동일) */
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

/** ───────────────────────────────────────────────────────────────
 * 내부 헬퍼: 인벤토리에 주어진 items를 병합(상점/보상용)
 *  - 쿨다운 없음
 *  - 빨간약 강제 보장 없음 (요청: “상점 구매 시 확률/보장 강제하지 않음”)
 * ─────────────────────────────────────────────────────────────── */
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

/** ───────────────────────────────────────────────────────────────
 * 몬스터 처치 전리품 이전 (원본 스타일 유지)
 *  - write-on-kill only
 *  - now < cooldownUntil → 에러(code:'cooldown')
 *  - 쿨다운만 예약(cooldownUntil, lastKilledAt/by, killSeq)
 *  - alive/dead/respawnAt 등은 건드리지 않음
 *  - drops: items → lootTable → DEFAULT
 *  - 🔴 빨간약(red_potion) 1개 보장 (원본에 있던 보장 로직 유지)
 * ─────────────────────────────────────────────────────────────── */
async function _transferFromMonster(db, { monsterId, guestId }){
  const monRef = doc(db, 'monsters', String(monsterId));
  const invRef = doc(db, 'inventories', String(guestId));

  const out = await safeWrite(`loot-transfer-${monsterId}-${guestId}`, () =>
    runTransaction(db, async (tx) => {
      // 읽기
      const monSnap = await tx.get(monRef);
      if (!monSnap.exists()) throw new Error('monster doc not found');
      const mon = monSnap.data() || {};

      const now = Date.now();
      const cooldownUntil = Number(mon.cooldownUntil || 0);
      const cooldownMs = Math.max(1_000, Number(mon.cooldownMs ?? mon.respawnMs ?? 600_000));

      // 레거시 가드(alive/dead/respawnAt 존중)
      const legacyDead = (mon.dead === true) || (mon.alive === false);
      const legacyRespawnAt = Number(mon.respawnAt || 0);
      if (legacyDead && legacyRespawnAt > now) {
        const err = Object.assign(new Error('on cooldown'), { code: 'cooldown' });
        throw err;
      }

      // 쿨다운 체크
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

      // 🔴 빨간약 보장(원본 유지) — 상점 지급에는 적용하지 않음
      const hasRed = drops.some(it => it.id === 'red_potion' || it.name === '빨간약');
      if (!hasRed) {
        drops = [{ id:'red_potion', name:'빨간약', qty:1, rarity:'common' }, ...drops];
      }

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

      // 몬스터: 쿨다운 예약(쓰기 최소화)
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

/** ───────────────────────────────────────────────────────────────
 * 통합 진입점 (원본 호환 + 상점 직지급 오버로드)
 *
 * 사용법:
 *  1) 몬스터 전리품:
 *     await transferMonsterInventory(db, { monsterId, guestId })
 *
 *  2) 상점/보상 직지급:
 *     await transferMonsterInventory(db, guestId, [{id,name,qty,rarity}, ...])
 * ─────────────────────────────────────────────────────────────── */
export async function transferMonsterInventory(db, arg1, arg2){
  // (2) 상점/직접 지급 모드: (db, guestId:string, items:Array)
  if (typeof arg1 === 'string' && Array.isArray(arg2)){
    const guestId = arg1;
    const items   = arg2;
    return _grantItemsDirect(db, guestId, items);
  }

  // (1) 몬스터 전리품 모드: (db, {monsterId, guestId})
  if (arg1 && typeof arg1 === 'object' && arg1.monsterId && arg1.guestId){
    return _transferFromMonster(db, arg1);
  }

  throw new Error('Invalid arguments for transferMonsterInventory');
}

export default transferMonsterInventory;
