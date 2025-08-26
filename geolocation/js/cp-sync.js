// /geolocation/js/cp-sync.js
// - 게스트: localStorage로 오늘 CP 관리
// - 지갑: users/{auth.uid} 문서에 cpToday/cp 읽기/쓰기, address 필드에 지갑주소 저장
// - 오늘 CP가 0이거나 미정의면, lastDate가 오늘일 때 cp를 "표시"용으로 Fallback
//   (AUTO_BACKFILL_CP_TODAY=true로 켜면 DB의 cpToday도 cp로 1회 보정)

import { db, auth, authReady } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc,
  increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { CLAIM_PASS } from './pass.js';

/* ------------ 설정 ------------ */
const AUTO_BACKFILL_CP_TODAY = false; // true로 바꾸면 cpToday가 0일 때 cp로 DB 채워넣음(1회)

/* ------------ DOM refs ------------ */
const $ = (id)=> document.getElementById(id);
const cpTodayEl     = $('cpToday');
const addrEl        = $('addr');
const levelViewEl   = $('levelView');     // 표기용
const levelGateEl   = $('levelGate');
const btnConnect    = $('btnConnect');
const btnSync       = $('btnSync');       // geohome.html 버튼과 연결
const chainStatusEl = $('chainStatus');
const btnResetGuest = $('btnResetGuest');
const walletBox     = $('walletBox');

/* ------------ Mode ------------ */
let mode = sessionStorage.getItem('GH_MODE') || localStorage.getItem('pf_mode') || 'guest';
function renderModeBox(){ if (walletBox) walletBox.style.display = (mode === 'wallet') ? '' : 'none'; }
renderModeBox();
window.addEventListener('pf:modeChanged', async (e)=>{
  mode = e?.detail?.mode || 'guest';
  renderModeBox();
  await hydrateAddressFromSessionOrWallet();
  await refreshCPUI();
});

/* ------------ EVM (ethers) ------------ */
const { ethers } = window;
const contractAddress = {
  pupbank: "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D",
  // gp: "0x35f7cfD9D3aE6Fdf1c080C3dd725EC68EB017caE",   // ❌ 사용 안 함(요청)
  claim:  "0x94472d875EE776496EcE59aC41A1F8292AfE7FBe" // ✅ 이번에 사용할 컨트랙트
};
const pupbankAbi = [
  "function myinfo(address) view returns(uint256,uint256,uint256,address,uint256)",
  "function getlevel(address) view returns(uint)"
];
const claimAbi = [ "function claimScore(uint256 _pass) external" ];

let provider=null, signer=null, userAddress=null, pupbank=null, claimC=null;

/* ------------ Auth / Firestore helpers ------------ */
const keyOf = (x)=> String(x||'').toLowerCase();
function currentUid(){ return auth.currentUser?.uid || null; }
function userDocRef(){
  const uid = currentUid();
  if (!uid) throw new Error('AUTH_REQUIRED');
  return doc(db, 'users', uid);
}
async function ensureAuthReady(){
  // 인증 완료까지 대기 (익명 로그인 포함)
  await authReady;
  if (!auth.currentUser) throw new Error('AUTH_REQUIRED');
}

/* ---------- Provider & Wallet ---------- */
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

/* ---------- 패시브 주소 수화(연결 없이도 주소/CP 표출) ---------- */
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
    if (addrEl) addrEl.textContent = userAddress;
    return;
  }
  const a = await getPassiveAddress();
  if (a){
    userAddress = a;
    if (addrEl) addrEl.textContent = userAddress;
  }
}
if (window.ethereum?.on){
  window.ethereum.on('accountsChanged', async ()=>{
    userAddress=null;
    await hydrateAddressFromSessionOrWallet();
    await refreshCPUI();
  });
  window.ethereum.on('chainChanged',   async ()=>{ await refreshCPUI(); });
}

/* ------------ 공통 유틸 ------------ */
function todayStr(){
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ------------ Firestore: users/{auth.uid} ------------ */
async function ensureUserDoc(addressLower, level=1){
  await ensureAuthReady();
  const ref = userDocRef();
  const snap = await getDoc(ref);
  const lv = Math.max(1, Number(level||1));
  if (!snap.exists()){
    await setDoc(ref, {
      uid: currentUid(),
      address: keyOf(addressLower||''),
      level: lv,
      // 파생값(레벨 기준)
      hp: lv*1000, maxHp: lv*1000, attack: lv,
      exp: 0, defense: 10,
      // CP
      cp: 0, cpToday: 0, lastDate: todayStr(),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    // 주소/레벨 갱신
    await updateDoc(ref, {
      address: keyOf(addressLower||''),
      level: lv,
      updatedAt: serverTimestamp()
    });
  }
}

async function ensureDailyReset(){
  await ensureAuthReady();
  const ref = userDocRef();
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const d = snap.data() || {};
  if ((d.lastDate||'') !== todayStr()){
    await updateDoc(ref, { cpToday: 0, lastDate: todayStr(), updatedAt: serverTimestamp() });
  }
}

/* ------------ CP read/write ------------ */
async function getTodayCP(){
  if (mode === 'wallet'){
    await ensureAuthReady();
    if (!userAddress) await hydrateAddressFromSessionOrWallet();
    if (userAddress){
      await ensureDailyReset();
      const snap = await getDoc(userDocRef());
      const data = snap.exists() ? (snap.data()||{}) : {};
      let daily  = Number(data.cpToday || 0) | 0;
      const last = String(data.lastDate || '');
      const total = Number(data.cp || 0) | 0;

      if (daily === 0 && last === todayStr() && total > 0){
        if (AUTO_BACKFILL_CP_TODAY){
          try{
            await updateDoc(userDocRef(), { cpToday: total, updatedAt: serverTimestamp() });
            daily = total;
          }catch(e){ console.warn('[cp-sync] backfill failed', e); daily = total; }
        } else {
          daily = total; // 표시만
        }
      }
      return daily;
    }
    return Number(localStorage.getItem('cp_today') || 0) | 0;
  }
  // 게스트
  return Number(localStorage.getItem('cp_today') || 0) | 0;
}

async function addTodayCP(delta){
  const d = Math.max(0, Number(delta)||0);
  if (!d) return;
  if (mode !== 'wallet' || !userAddress){
    const cur = Number(localStorage.getItem('cp_today') || 0) | 0;
    localStorage.setItem('cp_today', String(cur + d));
  } else {
    await ensureAuthReady();
    await ensureDailyReset();
    await updateDoc(userDocRef(), {
      cpToday: increment(d),
      cp: increment(d),
      updatedAt: serverTimestamp()
    });
  }
  await refreshCPUI();
}
window.__cp_addToday = addTodayCP;

/* ------------ Level 표기/버튼 상태 ------------ */
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
  const eligible = (Number(level||0) >= 1) && (Number(cp||0) >= 5000) && (mode === 'wallet');
  if (btnSync) btnSync.disabled = !eligible;
  if (chainStatusEl){
    chainStatusEl.textContent = eligible
      ? `가능: ${Math.floor(Number(cp)/5000)}회(×5000CP) 적립`
      : '조건: 레벨1 & 오늘 5000CP 이상';
  }
}

async function refreshCPUI(){
  const cp = await getTodayCP();
  if (cpTodayEl) cpTodayEl.textContent = String(cp);
  const lvl = Number(levelViewEl?.textContent || 0) || 0;
  updateSyncButtonState(lvl, cp);
}

/* ------------ Connect wallet flow ------------ */
async function connectWallet(){
  try{
    await ensureProvider();

    // 체인 레벨 조회 → UI
    const level = await fetchLevel(userAddress);
    if (levelViewEl) levelViewEl.textContent = String(level);
    if (level < 1){
      if (levelGateEl) levelGateEl.innerHTML = `레벨 1 이상 필요 → <a class="link-light" href="../memberjoin.html">회원가입</a>`;
      throw new Error('레벨 1 미만');
    } else {
      if (levelGateEl) levelGateEl.textContent = '연결 허가됨';
    }

    // Firebase 인증 후 유저 문서 준비(문서키=auth.uid, address 필드=지갑주소)
    await ensureAuthReady();
    await ensureUserDoc(userAddress, level);
    await ensureDailyReset();

    // 세션 상태 저장
    sessionStorage.setItem('GH_MODE', 'wallet');
    sessionStorage.setItem('GH_WALLET', userAddress);

    await refreshCPUI();
    if (addrEl) addrEl.textContent = userAddress;
  }catch(e){
    console.error(e);
    alert(e?.message || '지갑 연결 실패');
  }
}

/* ------------ Chain sync (5000CP per batch) ------------ */
// ✅ 요청 반영: claimScore(pass)를 호출, 성공 시 cpToday는 -5000으로 고정 저장
async function syncOnChain(){
  try{
    if (mode !== 'wallet') throw new Error('지갑 모드가 아닙니다');
    if (!userAddress) throw new Error('지갑을 먼저 연결하세요');

    const level = Number(levelViewEl?.textContent || 0) || 0;
    if (level < 1) throw new Error('레벨 1 필요');

    await ensureProvider();
    await ensureAuthReady();
    await ensureDailyReset();

    const cp = await getTodayCP();
    const batches = Math.floor(cp / 5000);
    if (batches <= 0) throw new Error('오늘 5000CP 이상 필요');

    // 1) 체인 트랜잭션 (가스는 유저 지갑에서 지출)
    const tx = await claimC.claimScore(ethers.BigNumber.from(CLAIM_PASS));
    await tx.wait();

    // 2) Firestore 업데이트 (문서키=auth.uid)
    const used = batches * 5000;
    await updateDoc(userDocRef(), {
      // 총합 cp는 사용량만큼 차감 (원 설계 유지)
      cp: increment(-used),
      // 오늘 cpToday는 0 대신 -5000 고정(요청)
      cpToday: -5000,
      updatedAt: serverTimestamp()
    });

    alert(`블록체인 적립 완료: ${batches} × 5000CP (오늘 CP = -5000)`);
    await refreshCPUI();
  }catch(e){
    console.error(e);
    alert(e?.message || '적립 실패');
  }
}

/* ------------ Events ------------ */
btnConnect?.addEventListener('click', connectWallet);
btnSync?.addEventListener('click', syncOnChain);
btnResetGuest?.addEventListener('click', ()=>{
  if (confirm('게스트 오늘 CP를 초기화할까요?')){
    localStorage.removeItem('cp_today');
    refreshCPUI();
    alert('게스트 데이터가 리셋되었습니다.');
  }
});

/* ------------ Boot ------------ */
(async function boot(){
  try{
    renderModeBox();
    // 인증 완료까지 미리 대기해 두면 초기 읽기에서 권한오류가 나지 않습니다.
    await ensureAuthReady();
  }catch(e){
    // 개발 단계에서 authReady가 실패할 일은 거의 없지만, 방어적으로 처리
    console.warn('[cp-sync] authReady failed or delayed', e);
  }
  await hydrateAddressFromSessionOrWallet();
  await refreshCPUI();
})();
