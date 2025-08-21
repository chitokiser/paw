// Firestore Emulator seeder: monsters, treasures, shops(+items), inventories
// 실행: 1) firebase emulators:start --only firestore  2) node seed.js

import { initializeApp } from "firebase/app";
import {
  getFirestore, connectFirestoreEmulator,
  doc, setDoc, collection, getDocs, deleteDoc
} from "firebase/firestore";

/* ================== 설정 ================== */
const EMU_HOST = "127.0.0.1";
const EMU_PORT = 8080;

// 기준 좌표(원하는 위치로 수정)
const BASE_COORDS = [
  { name: "Office1", lat: 17.4649034, lon: 106.6027826 },
  { name: "Office2", lat: 17.4655000, lon: 106.6032000 },
];

// 기존 문서를 비우고 채울지 여부
const WIPE_FIRST = true;

/* ============ 초기화 & 유틸 ============ */
const app = initializeApp({ projectId: "puppi-d67a1" }); // 로컬 에뮬: projectId만 필요
const db  = getFirestore(app);
connectFirestoreEmulator(db, EMU_HOST, EMU_PORT);

const tileFromLatLon = (lat, lon, g = 0.01) => {
  const fy = Math.floor(lat / g), fx = Math.floor(lon / g);
  return `${fy}_${fx}`;
};
const jitter = (deg = 0.0006) => (Math.random() - 0.5) * deg * 2;

async function wipeCollection(colPath) {
  const snap = await getDocs(collection(db, colPath));
  const jobs = [];
  snap.forEach(d => jobs.push(deleteDoc(doc(db, colPath, d.id))));
  if (jobs.length) {
    console.log(`[wipe] ${colPath}: ${jobs.length} docs`);
    await Promise.all(jobs);
  }
}

/* ============ SEED: 몬스터 ============ */
/**
 * 정책
 * - imageURL 저장 ❌ (표시용은 mid 시트의 첫 프레임을 사용)
 * - mid: 숫자(스프라이트 파일명) — 예) /images/ani/7.png
 * - size, power, range, cooldownMs 등 최소 필드
 * - items/lootTable는 예시 1~2개
 */
async function seedMonsters(nPerBase = 5) {
  console.log(`Seeding monsters x${nPerBase} for each base...`);
  for (const base of BASE_COORDS) {
    for (let i = 0; i < nPerBase; i++) {
      const lat  = base.lat + jitter(0.0006);
      const lon  = base.lon + jitter(0.0006);
      const tile = tileFromLatLon(lat, lon);

      // mid는 1~10 중 랜덤(원하는 범위로 바꾸세요)
      const mid  = Math.floor(Math.random() * 10) + 1;

      const power = 50 + Math.floor(Math.random() * 4); // 2~5
      const id = `MON-${tile}-${Date.now().toString(36)}-${i}`;

      const payload = {
        type: "monster",
        lat, lon, tile,
        // ⬇️ 표시 정책에 맞는 핵심 필드
        mid,                 // ← 스프라이트 파일명 숫자
        size: 48,
        power,               // 전투 필요 타격 수 = power
        hitsLeft: power,     // (옵션) 관리자툴/트랜잭션 호환
        range: 5,
        damage: 1,
        cooldownMs: 1500 + Math.floor(Math.random() * 1000),
        items: [{ id: "red_potion", name: "빨간약", qty: 1, rarity: "common" }],
        lootTable: [
          { id: "bone_fragment", name: "Bone Fragment", rarity: "common", chance: 0.6, min: 1, max: 3 }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await setDoc(doc(db, "monsters", id), payload, { merge: true });
    }
  }
}

/* ============ SEED: 보물(그대로 유지) ============ */
async function seedTreasureBothWays() {
  console.log("Seeding treasures (treasures/ & monsters/ type:'treasure')...");
  for (const base of BASE_COORDS) {
    // A) treasures 컬렉션
    {
      const lat = base.lat + jitter(0.0004);
      const lon = base.lon + jitter(0.0004);
      const tile = tileFromLatLon(lat, lon);
      const id = `TR-${tile}-${Date.now().toString(36)}-A`;
      await setDoc(doc(db, "treasures", id), {
        type: "treasure",
        lat, lon, tile,
        imageURL: "https://puppi.netlify.app/images/event/treasure.png",
        size: 44,
        power: 3,
        hitsLeft: 3,
        rewards: {
          score: 15,
          items: [{ id: "red_potion", name: "빨간약", qty: 2, rarity: "common" }]
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });
    }
    // B) monsters 컬렉션 내부에 type:'treasure'
    {
      const lat = base.lat + jitter(0.0004);
      const lon = base.lon + jitter(0.0004);
      const tile = tileFromLatLon(lat, lon);
      const id = `TR-${tile}-${Date.now().toString(36)}-B`;
      await setDoc(doc(db, "monsters", id), {
        type: "treasure",
        lat, lon, tile,
        imageURL: "https://puppi.netlify.app/images/event/treasure.png",
        size: 44,
        power: 2,
        hitsLeft: 2,
        items: [{ id: "red_potion", name: "빨간약", qty: 1, rarity: "common" }],
        lootTable: [{ id: "mystic_orb", name: "Mystic Orb", rarity: "rare", chance: 0.2, min: 1, max: 1 }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });
    }
  }
}

/* ============ SEED: 상점(+아이템) ============ */
async function seedShopWithItems() {
  console.log("Seeding shops with two items each...");
  for (const base of BASE_COORDS) {
    const lat = base.lat + jitter(0.0005);
    const lon = base.lon + jitter(0.0005);
    const tile = tileFromLatLon(lat, lon);
    const shopId = `SHOP-${tile}-${Date.now().toString(36)}`;

    await setDoc(doc(db, "shops", shopId), {
      type: "shop",
      name: `Demo Shop @ ${base.name}`,
      imageURL: "https://puppi.netlify.app/images/event/shop.png",
      size: 48,
      active: true,
      lat, lon, tile,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });

    const items = [
      {
  id: "lightning_summon",
  data: {
    type: "shopItem",
    itemId: "lightning_summon",
    name: "벼락소환",
    iconURL: "/images/items/lightning.png", // 파일 없으면 기본 아이콘 표시됨
    stackable: true,
    active: true,
    buyPriceGP: 1000,   // 구매 가능
    sellPriceGP: 1000,  // 판매도 가능(원치 않으면 0)
    stock: null,        // 무한 재고
    weapon: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
},

      {
        id: "red_potion",
        data: {
          type: "shopItem",
          itemId: "red_potion",
          name: "빨간약",
          iconURL: "https://puppi.netlify.app/images/items/red_potion.png",
          stackable: true,
          active: true,
          buyPriceGP: 50,
          sellPriceGP: 25,
          stock: null, // 무한
          weapon: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      {
        id: "long_sword",
        data: {
          type: "shopItem",
          itemId: "long_sword",
          name: "장검",
          iconURL: "https://puppi.netlify.app/images/items/long_sword.png",
          stackable: false,
          active: true,
          buyPriceGP: 50,
          sellPriceGP: 25,
          stock: 10,
          weapon: { baseAtk: 10, extraInit: 0 },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    ];

    // (신규 shopId는 비어있지만 혹시 몰라 정리)
    const sub = await getDocs(collection(db, `shops/${shopId}/items`));
    await Promise.all(sub.docs.map(d => deleteDoc(doc(db, `shops/${shopId}/items`, d.id))));
    for (const it of items) {
      await setDoc(doc(db, `shops/${shopId}/items`, it.id), it.data, { merge: true });
    }
  }
}

/* ============ SEED: 인벤토리 ============ */
async function seedInventoryForGuest() {
  console.log("Seeding an inventory for 'guest'...");
  await setDoc(doc(db, "inventories", "guest"), {
    items: {
      red_potion: { name: "빨간약", qty: 3, rarity: "common" },
      bone_fragment: { name: "Bone Fragment", qty: 5, rarity: "common" },
    },
    updatedAt: Date.now(),
  }, { merge: true });
}

/* ============ 메인 ============ */
(async () => {
  try {
    console.log(`[emu] Firestore @ ${EMU_HOST}:${EMU_PORT}`);
    if (WIPE_FIRST) {
      await wipeCollection("monsters");
      await wipeCollection("treasures");
      await wipeCollection("shops");
      await wipeCollection("inventories");
    }

    await seedMonsters(5);
    await seedTreasureBothWays();
    await seedShopWithItems();
    await seedInventoryForGuest();

    console.log("✅ Seed data inserted!");
  } catch (e) {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  }
})();
