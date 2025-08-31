// /geolocation/js/cp-sync.js
// Wallet-only CP 동기화 & 체인 적립 (문서키 = 지갑주소 소문자)
// - users_uid/{auth.uid} : 권한 판단(레벨/관리자/지갑 바인딩) 기준 문서  ← ★ 추가
// - users/{walletLower}  : 게임 진행 데이터(cp, cpToday, exp 등)
// - 레벨은 pupbank.myinfo() → 실패시 getlevel() 폴백
// - 오늘 CP >= 5000 이면 체인 적립 버튼 활성화
// - 게스트 로직 전부 제거

import { db, auth, authReady } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc,
  increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { CLAIM_PASS } from './pass.js';

// ──────────────────────────────────────────────
// 설정
// ──────────────────────────────────────────────
const AUTO_BACKFILL_CP_TODAY = false; // cpToday=0 & lastDate=오늘 → total(cp)로 표시만 보정(저장까지 하려면 true)

// ──────────────────────────────────────────────
// DOM refs
// ──────────────────────────────────────────────
const $ = (id)=> document.getElementById(id);
const cpTodayEl     = $('cpToday');
const addrEl        = $('addr');
const levelViewEl   = $('levelView');
const levelGateEl   = $('levelGate');
const btnConnect    = $('btnConnect');
const btnSync       = $('btnSync');
const chainStatusEl = $('chainStatus');
const walletBox     = $('walletBox');

// ──────────────────────────────────────────────
// EVM (ethers)
// ──────────────────────────────────────────────
const { ethers } = window;
const contractAddress = {
  pupbank: "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D",
  claim:   "0x1Af8EFFD3CA2CADd0C57F043C7c37e6684C97b28"
};
const pupbankAbi = [
  "function myinfo(address) view returns(uint256,uint256,uint256,address,uint256)",
  "function getlevel(address) view returns(uint)"
];
const claimAbi = [ "function claimScore(uint256 _pass) external" ];

let provider=null, signer=null, userAddress=null, pupbank=null, claimC=null;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
const keyOf = (x)=> String(x||'').toLowerCase();
function todayStr(){
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function userDocRefByAddr(addrLower){
  const k = keyOf(addrLower);
  if (!k) throw new Error('지갑 주소가 필요합니다.');
  return doc(db, 'users', k);
}
function uidDocRef(){
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  return doc(db, 'users_uid', uid);
}

async function ensureAuthReadyOrThrow(){
  await authReady;
  if (!auth.currentUser) throw new Error('로그인이 필요합니다. 먼저 로그인한 뒤 지갑을 연결하세요.');
}

// ──────────────────────────────────────────────
// Provider & Wallet
// ──────────────────────────────────────────────
async function ensureProvider(){
  if (signer) return;
  if (!window.ethereum) throw new Error('지갑이 설치되어 있지 않습니다');

  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId:"0xCC", rpcUrls:["https://opbnb-mainnet-rpc.bnbchain.org"],
        chainName:"opBNB", nativeCurrency:{ name:"BNB", symbol:"BNB", decimals:18 },
        blockExplorerUrls:["https://opbnbscan.com"] }]
    });
  } catch(_) {}
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  userAddress = keyOf(await signer.getAddress());
  pupbank = new ethers.Contract(contractAddress.pupbank, pupbankAbi, signer);
  claimC  = new ethers.Contract(contractAddress.claim,   claimAbi,   signer);
  if (addrEl) addrEl.textContent = userAddress;
}

async function getPassiveAddress(){
  try{
    if (window.ethereum?.selectedAddress) return keyOf(window.ethereum.selectedAddress);
    const accts = await window.ethereum?.request?.({ method:'eth_accounts' }) || [];
    return keyOf(accts[0]||'') || null;
  }catch(_){ return null; }
}
async function hydrateAddressFromSessionOrWallet(){
  if (userAddress) return;
  const s = keyOf(sessionStorage.getItem('GH_WALLET') || '');
  if (s){
    userAddress = s;
    addrEl && (addrEl.textContent = userAddress);
    return;
  }
  const a = await getPassiveAddress();
  if (a){
    userAddress = a;
    addrEl && (addrEl.textContent = userAddress);
  }
}

if (window.ethereum?.on){
  window.ethereum.on('accountsChanged', async ()=>{
    userAddress=null;
    sessionStorage.removeItem('GH_WALLET');
    await hydrateAddressFromSessionOrWallet();
    await refreshCPUI();
  });
  window.ethereum.on('chainChanged',   async ()=>{ await refreshCPUI(); });
}

// ──────────────────────────────────────────────
// Firestore 보장 레이어
// ──────────────────────────────────────────────

// uid 프로필 문서 보장: users_uid/{auth.uid} ← ★ 권한 판단 기준 (level / walletLower)
async function ensureUidProfile(level){
  await ensureAuthReadyOrThrow();
  const ref = uidDocRef();
  await setDoc(ref, {
    level: Math.max(0, Number(level)||0),
    wallet: userAddress,
    walletLower: userAddress,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// 지갑키 문서 보장: users/{walletLower} ← 게임 진행 데이터
async function ensureUserDoc(addressLower, level=1){
  await ensureAuthReadyOrThrow();
  const ref = userDocRefByAddr(addressLower);
  const snap = await getDoc(ref);
  const lv = Math.max(1, Number(level||1));
  if (!snap.exists()){
    await setDoc(ref, {
      address: keyOf(addressLower||''),
      level: lv,
      hp: lv*1000, maxHp: lv*1000, attack: lv,
      exp: 0, defense: 10,
      cp: 0, cpToday: 0, lastDate: todayStr(),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    await updateDoc(ref, {
      address: keyOf(addressLower||''),
      level: lv,
      updatedAt: serverTimestamp()
    });
  }
}

async function ensureDailyReset(addressLower){
  await ensureAuthReadyOrThrow();
  const ref = userDocRefByAddr(addressLower);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const d = snap.data() || {};
  if ((d.lastDate||'') !== todayStr()){
    await updateDoc(ref, { cpToday: 0, lastDate: todayStr(), updatedAt: serverTimestamp() });
  }
}

// ──────────────────────────────────────────────
// CP read/write (Wallet only)
// ──────────────────────────────────────────────
async function getTodayCP(){
  await ensureAuthReadyOrThrow();
  if (!userAddress) await hydrateAddressFromSessionOrWallet();
  if (!userAddress) return 0;

  await ensureDailyReset(userAddress);
  const ref  = userDocRefByAddr(userAddress);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data()||{}) : {};
  let daily  = Number(data.cpToday || 0) | 0;
  const last = String(data.lastDate || '');
  const total = Number(data.cp || 0) | 0;

  if (daily === 0 && last === todayStr() && total > 0){
    if (AUTO_BACKFILL_CP_TODAY){
      try{
        await updateDoc(ref, { cpToday: total, updatedAt: serverTimestamp() });
        daily = total;
      }catch(e){ console.warn('[cp-sync] backfill failed', e); daily = total; }
    } else {
      daily = total; // 표시에만 반영
    }
  }
  return daily;
}

async function addTodayCP(delta){
  const d = Math.max(0, Number(delta)||0);
  if (!d) return;
  await ensureAuthReadyOrThrow();
  if (!userAddress) throw new Error('지갑을 먼저 연결하세요');

  await ensureDailyReset(userAddress);
  await updateDoc(userDocRefByAddr(userAddress), {
    cpToday: increment(d),
    cp: increment(d),
    updatedAt: serverTimestamp()
  });
  await refreshCPUI();
}
window.__cp_addToday = addTodayCP; // 외부(geohunt.js)에서 사용할 훅

// ──────────────────────────────────────────────
// 레벨/버튼 상태
// ──────────────────────────────────────────────
async function fetchLevel(address){
  let lv = 0;
  try {
    const [_td,_bonus,l] = await pupbank.myinfo(address);
    lv = Number(l||0);
  } catch {
    try { lv = Number(await pupbank.getlevel(address)); } catch {}
  }
  return lv|0;
}
function updateSyncButtonState(level, cp){
  const eligible = (Number(level||0) >= 1) && (Number(cp||0) >= 5000);
  if (btnSync) btnSync.disabled = !eligible;
  if (chainStatusEl){
    chainStatusEl.textContent = eligible
      ? `가능: ${Math.floor(Number(cp)/5000)}회(×5000CP) 적립`
      : '조건: 레벨1 & 오늘 5000CP 이상';
  }
}
async function refreshCPUI(){
  try{
    const cp = await getTodayCP();
    cpTodayEl && (cpTodayEl.textContent = String(cp));
    const lvl = Number(levelViewEl?.textContent || 0) || 0;
    updateSyncButtonState(lvl, cp);
  }catch(e){
    console.warn('[cp-sync] refreshCPUI:', e?.message||e);
    cpTodayEl && (cpTodayEl.textContent = '0');
    updateSyncButtonState(0, 0);
  }
}

// ──────────────────────────────────────────────
// Connect wallet flow  ← ★ 지갑 연결 시 한방 공유
// ──────────────────────────────────────────────
async function connectWallet(){
  try{
    await ensureProvider();

    // 1) 온체인에서 레벨 조회
    const level = await fetchLevel(userAddress);
    levelViewEl && (levelViewEl.textContent = String(level));
    if (level < 1){
      if (levelGateEl) levelGateEl.innerHTML = `레벨 1 이상 필요 → <a class="link-light" href="../memberjoin.html">회원가입</a>`;
      throw new Error('레벨 1 미만');
    } else {
      levelGateEl && (levelGateEl.textContent = '연결 허가됨');
    }

    // 2) Firebase Auth 세션 보장
    await ensureAuthReadyOrThrow();

    // 3) ✅ 한방 공유: UID 프로필 + 지갑키 문서 동기화
    await ensureUidProfile(level);           // users_uid/{auth.uid}
    await ensureUserDoc(userAddress, level); // users/{walletLower}
    await ensureDailyReset(userAddress);

    // 4) 세션 저장 & UI 갱신
    sessionStorage.setItem('GH_WALLET', userAddress);
    await refreshCPUI();
    addrEl && (addrEl.textContent = userAddress);
  }catch(e){
    console.error(e);
    alert(e?.message || '지갑 연결 실패');
  }
}

// ──────────────────────────────────────────────
// Chain sync (5000CP per batch)
// ──────────────────────────────────────────────
async function syncOnChain(){
  try{
    await ensureAuthReadyOrThrow();
    if (!userAddress) throw new Error('지갑을 먼저 연결하세요');

    await ensureProvider();
    await ensureDailyReset(userAddress);

    const level = Number(levelViewEl?.textContent || 0) || 0;
    if (level < 1) throw new Error('레벨 1 필요');

    const cp = await getTodayCP();
    const batches = Math.floor(cp / 5000);
    if (batches <= 0) throw new Error('오늘 5000CP 이상 필요');

    // 1) 체인 트랜잭션
    const tx = await claimC.claimScore(ethers.BigNumber.from(CLAIM_PASS));
    await tx.wait();

    // 2) Firestore 업데이트
    const used = batches * 5000;
    await updateDoc(userDocRefByAddr(userAddress), {
      cp: increment(-used),
      cpToday: increment(-used), // 사용량만큼 차감
      updatedAt: serverTimestamp()
    });

    alert(`블록체인 적립 완료: ${batches} × 5000CP (오늘 ${used} 차감)`);
    await refreshCPUI();
  }catch(e){
    console.error(e);
    alert(e?.message || '적립 실패');
  }
}

// ──────────────────────────────────────────────
// Events & Boot
// ──────────────────────────────────────────────
btnConnect?.addEventListener('click', connectWallet);
btnSync?.addEventListener('click', syncOnChain);

(async function boot(){
  try{
    await authReady; // 초기 인증 세션 확보
  }catch(e){
    console.warn('[cp-sync] authReady delayed', e);
  }
  await hydrateAddressFromSessionOrWallet();
  await refreshCPUI();
})();
