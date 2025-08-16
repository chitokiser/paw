// /geolocation/js/inventoryTransfer.js
import { doc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { rollDrops } from './loot.js';
import { safeWrite } from './dbGuard.js';

const DEFAULT_DROP = [
  { id: 'potion_small', name: 'Small Potion', qty: 2, rarity: 'common' },
  { id: 'bone_fragment', name: 'Bone Fragment', qty: 3, rarity: 'common' }
];

function mergeIntoMap(baseMap, arr){
  const out = { ...(baseMap || {}) };
  for (const it of (arr || [])){
    if (!it?.id) continue;
    const key = String(it.id);
    const prev = out[key] || { name: it.name || key, qty: 0, rarity: it.rarity };
    out[key] = {
      name: prev.name || it.name || key,
      qty: Number(prev.qty||0) + Number(it.qty||1),
      rarity: prev.rarity || it.rarity || 'common'
    };
  }
  return out;
}

/**
 * ▶ write-on-kill only:
 *  - now < cooldownUntil  → 에러(이미 죽어있음)
 *  - now ≥ cooldownUntil  → 루팅 OK + cooldownUntil = now + respawnMs
 *  - monsters 문서에는 items/alive/dead/updatedAt 쓰지 않음 (쓰기 절감)
 */
export async function transferMonsterInventory(db, { monsterId, guestId }){
  const monRef = doc(db, 'monsters', String(monsterId));
  const invRef = doc(db, 'inventories', String(guestId));

  const out = await safeWrite(`loot-transfer-${monsterId}-${guestId}`, () =>
    runTransaction(db, async (tx) => {
      const monSnap = await tx.get(monRef);
      if (!monSnap.exists()) throw new Error('monster doc not found');

      const mon = monSnap.data() || {};
      const now = Date.now();
      const cooldownUntil = Number(mon.cooldownUntil || 0);
      const respawnMs = Math.max(5_000, Number(mon.respawnMs || 60_000)); // 기본 60초

      // 레거시 호환: dead/respawnAt 체계가 있으면 함께 가드
      const legacyDead = (mon.dead === true) || (mon.alive === false);
      const legacyRespawnAt = Number(mon.respawnAt || 0);
      if (legacyDead && legacyRespawnAt > now) {
        throw Object.assign(new Error('on cooldown'), { code: 'cooldown' });
      }

      // ▶ 쿨다운 체크: now >= cooldownUntil 이어야 루팅 허용
      if (now < cooldownUntil) {
        throw Object.assign(new Error('on cooldown'), { code: 'cooldown' });
      }

      // ▷ 드랍 산출 (lootTable 있으면 사용, 없으면 기본)
      let items = [];
      if (Array.isArray(mon.lootTable) && mon.lootTable.length > 0) {
        items = rollDrops(mon.lootTable);
      }
      if (!items || items.length === 0) items = DEFAULT_DROP;

      // ▷ 인벤토리 병합
      const invSnap = await tx.get(invRef);
      const invData = invSnap.exists() ? (invSnap.data() || {}) : {};
      const merged = mergeIntoMap(invData.items || {}, items);

      if (!invSnap.exists()) tx.set(invRef, { items: merged, updatedAt: now });
      else                   tx.update(invRef, { items: merged, updatedAt: now });

      // ▷ 몬스터는 "부활 안 함" — 대신 다음 쿨다운만 예약
      //    alive/dead/items/updatedAt 쓰지 않음(쓰기 절감의 핵심)
      tx.update(monRef, {
        cooldownUntil: now + respawnMs,
        lastKilledAt: now,
        lastKilledBy: String(guestId),
        killSeq: increment(1) // 통계/디버깅용
      });

      return items;
    })
  );

  if (!out.ok) throw out.error || new Error('loot-transfer blocked');
  return out.res || [];
}
