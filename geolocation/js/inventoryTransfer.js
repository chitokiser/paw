// /geolocation/js/inventoryTransfer.js
import { doc, runTransaction } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { rollDrops } from './loot.js';

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

export async function transferMonsterInventory(db, { monsterId, guestId }){
  const monRef = doc(db, 'monsters', String(monsterId));
  const invRef = doc(db, 'inventories', String(guestId));

  const moved = await runTransaction(db, async (tx) => {
    const monSnap = await tx.get(monRef);
    if (!monSnap.exists()) throw new Error('monster doc not found');
    const invSnap = await tx.get(invRef);

    const monData = monSnap.data() || {};
    let items = Array.isArray(monData.items) ? monData.items : null;
    if (!items || items.length === 0) {
      if (Array.isArray(monData.lootTable) && monData.lootTable.length > 0) items = rollDrops(monData.lootTable);
      if (!items || items.length === 0) items = DEFAULT_DROP;
    }

    const invData = invSnap.exists() ? (invSnap.data() || {}) : {};
    const merged = mergeIntoMap(invData.items || {}, items);

    if (!invSnap.exists()) tx.set(invRef, { items: merged, updatedAt: Date.now() });
    else                   tx.update(invRef, { items: merged, updatedAt: Date.now() });

    tx.update(monRef, { items: [], updatedAt: Date.now() });

    return items;
  });

  return moved || [];
}
