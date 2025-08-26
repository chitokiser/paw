// /geolocation/js/identity.js
// 단일 키 정책: wallet=지갑주소, guest=guestId
// inventories 는 'wa:<address>' / 'guest:<id>' 로 네임스페이스

import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// ───────── 모드/주소 ─────────
export function getMode(){
  try {
    return sessionStorage.getItem('GH_MODE') || localStorage.getItem('pf_mode') || 'guest';
  } catch { return 'guest'; }
}

export function getWalletAddressLowerSync(){
  try {
    // 세션에 저장된 지갑(지갑 연결 플로우에서 설정)
    const s = sessionStorage.getItem('GH_WALLET');
    if (s) return String(s).toLowerCase();
    // 수동 조회(지갑이 허용한 계정만 나옴)
    if (window.ethereum?.selectedAddress) return String(window.ethereum.selectedAddress).toLowerCase();
    return null;
  } catch { return null; }
}

export function getGuestId(){
  let id = null;
  try { id = localStorage.getItem('guestId'); } catch {}
  if (!id){
    id = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
    try { localStorage.setItem('guestId', id); } catch {}
  }
  return id;
}

// ───────── 키/레퍼런스 생성 ─────────
export function getInventoryId(){
  const mode = getMode();
  if (mode === 'wallet'){
    const addr = getWalletAddressLowerSync();
    return addr ? `wa:${addr}` : null;
  }
  return `guest:${getGuestId()}`;
}

export function getUserDocRef(db){
  const addr = getWalletAddressLowerSync();
  return addr ? doc(db, 'users', String(addr)) : null;
}

export function getInventoryDocRef(db){
  const id = getInventoryId();
  return id ? doc(db, 'inventories', String(id)) : null;
}

// 인벤 문서 없으면 생성(아이템 맵/장비 기본값)
export async function ensureInventoryDoc(db){
  const ref = getInventoryDocRef(db);
  if (!ref) return null;
  const ss = await getDoc(ref);
  if (!ss.exists()){
    await setDoc(ref, {
      owner: ref.id,                   // 권장: 소유자 식별 저장
      items: {},
      equipped: { weapon:'fist' },
      createdAt: serverTimestamp(),    // 권장: 최초 생성 시각
      updatedAt: serverTimestamp()
    }, { merge:true });
  }
  return ref;
}

// ───────── 1회 마이그레이션(선택) ─────────
// 구버전 UID/게스트 인벤이 있고, 새 주소 인벤이 없으면 복사
export async function migrateInventoryIfNeeded(db, { fromUid=null } = {}){
  try{
    const addr = getWalletAddressLowerSync();
    if (!addr) return false;
    const newRef = doc(db, 'inventories', `wa:${addr}`);

    const newSnap = await getDoc(newRef);
    if (newSnap.exists()) return false; // 이미 새 구조 존재

    // 후보: 1) UID  2) 게스트
    const candidates = [];
    if (fromUid) candidates.push(doc(db, 'inventories', String(fromUid)));
    const guestId = getGuestId();
    candidates.push(doc(db, 'inventories', `guest:${guestId}`));

    for (const oldRef of candidates){
      const oldSnap = await getDoc(oldRef);
      if (oldSnap.exists()){
        const data = oldSnap.data() || {};
        await setDoc(newRef, { ...data, owner: newRef.id, migratedFrom: oldRef.id, migratedAt: serverTimestamp() }, { merge:true });
        // 선택: console.info(`[identity] migrated ${oldRef.id} -> ${newRef.id}`);
        return true;
      }
    }
  }catch(e){
    console.warn('[identity] migrateInventoryIfNeeded fail', e);
  }
  return false;
}
