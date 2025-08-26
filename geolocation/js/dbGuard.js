
// dbGuard.js
import { db } from './firebase.js';
import { doc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
let quotaBlockedUntil = 0;
const RETRY_PAUSE_MS   = 120_000;   // 쿼터 초과 시 2분 차단
const FLUSH_INTERVAL   = 5_000;     // 큐 플러시 주기
const writeGate = new Map();         // key -> lastTs
const queue = [];                    // { label, fn }

export function keyOf(x){ return String(x||'').toLowerCase(); }
export function isWriteBlocked(){ return Date.now() < quotaBlockedUntil; }
export function blockWritesFor(ms){ quotaBlockedUntil = Date.now() + ms; }

export async function safeWrite(label, fn){
  if (isWriteBlocked()) return { ok:false, reason:'quota-blocked', label };
  try{
    const res = await fn();
    return { ok:true, res };
  }catch(e){
    if (e?.code === 'resource-exhausted'){
      // 앞으로 들어올 쓰기는 큐에 쌓고, 일정 주기로 재시도
      quotaBlockedUntil = Date.now() + RETRY_PAUSE_MS;
      queue.push({ label, fn });
      return { ok:false, reason:'quota-exceeded', error:e, label };
    }
    throw e;
  }
}

export async function withWriteGate(key, minMs, fn){
  const now = Date.now();
  const last = writeGate.get(key) || 0;
  if (now - last < minMs) return { ok:false, reason:'gated' };
  writeGate.set(key, now);
  return await fn();
}

async function flushQueueOnce(){
  if (isWriteBlocked() || queue.length === 0) return;
  // 한 번에 너무 많이 쏘지 않도록 1~3개만
  const batch = queue.splice(0, 3);
  for (const job of batch){
    try{
      await job.fn();
    }catch(e){
      if (e?.code === 'resource-exhausted'){
        // 다시 차단하고 큐 앞에 되돌리기
        quotaBlockedUntil = Date.now() + RETRY_PAUSE_MS;
        queue.unshift(job);
        break;
      }
      // 기타 오류는 드롭(필요하면 로깅)
      console.warn('[safeWrite/flush] drop', job.label, e);
    }
  }
}

/** 세션/지갑에서 0x 주소 받기 */
export async function resolveWalletAddress(){
  try {
    const s = sessionStorage.getItem('GH_WALLET');
    if (s) return keyOf(s);
    if (window.ethereum?.selectedAddress) return keyOf(window.ethereum.selectedAddress);
    const accts = await window.ethereum?.request?.({ method:'eth_accounts' }) || [];
    if (accts[0]) return keyOf(accts[0]);
    return null;
  } catch { return null; }
}

/** users/{지갑주소} 문서 ref */
export function userDocRefByAddress(addrLower){
  if (!addrLower) throw new Error('WALLET_REQUIRED');
  return doc(db, 'users', keyOf(addrLower));
}

// inventories/wa:{지갑주소}
export function invDocRefByAddress(addrLower){
  if (!addrLower) throw new Error('WALLET_REQUIRED');
  return doc(db, 'inventories', `wa:${keyOf(addrLower)}`);
}

setInterval(flushQueueOnce, FLUSH_INTERVAL);
