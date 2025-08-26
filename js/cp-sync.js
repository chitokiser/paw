// /geolocation/js/cp-sync.js
// - No Firebase Auth dependency (wallet-only flow)
// - English-only messages
// - Firestore safe access with graceful fallbacks
// - ethers v5 style (Web3Provider)

import { db } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ------------ Settings ------------ */
const AUTO_BACKFILL_CP_TODAY = false; // if true: when cpToday is 0 but total cp>0 on same day, backfill DB once

/* ------------ DOM refs ------------ */
const $ = (id)=> document.getElementById(id);
const cpTodayEl     = $('cpToday');
const addrEl        = $('addr');
const levelViewEl   = $('levelView');
const levelGateEl   = $('levelGate');
const btnConnect    = $('btnConnect');
const btnSync       = $('btnSync');
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

/* ------------ EVM (ethers v5) ------------ */
const { ethers } = window || {};
const contractAddress = {
  pupbank: "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D",
  gp:       "0x35f7cfD9D3aE6Fdf1c080C3dd725EC68EB017caE"
};
const pupbankAbi = [
  "function myinfo(address) view returns(uint256,uint256,uint256,address,uint256)",
  "function getlevel(address) view returns(uint)"
];
const gpAbi = [ "function charge(uint _pay) public" ];

let provider=null, signer=null, userAddress=null, pupbank=null, gp=null;

async function ensureProvider(){
  if (signer) return;
  if (!window.ethereum) throw new Error('Wallet (MetaMask/Rabby) is required.');
  if (!ethers?.providers?.Web3Provider) throw new Error('ethers v5 is required on this page.');

  provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  // Optional: ensure opBNB
  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId:"0xCC",
        rpcUrls:["https://opbnb-mainnet-rpc.bnbchain.org"],
        chainName:"opBNB",
        nativeCurrency:{ name:"BNB", symbol:"BNB", decimals:18 },
        blockExplorerUrls:["https://opbnbscan.com"]
      }]
    });
  } catch(_) {}
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  userAddress = (await signer.getAddress()).toLowerCase();
  pupbank = new ethers.Contract(contractAddress.pupbank, pupbankAbi, signer);
  gp      = new ethers.Contract(contractAddress.gp,      gpAbi,      signer);
  if (addrEl) addrEl.textContent = userAddress;
}

/* ---------- Passive address hydration (without explicit connect) ---------- */
async function getPassiveAddress(){
  try{
    if (window.ethereum?.selectedAddress) return window.ethereum.selectedAddress.toLowerCase();
    const accts = await window.ethereum?.request?.({ method:'eth_accounts' }) || [];
    return (accts[0] || '').toLowerCase() || null;
  }catch(_){ return null; }
}
async function hydrateAddressFromSessionOrWallet(){
  if (userAddress) return;
  const s = sessionStorage.getItem('GH_WALLET');
  if (s){
    userAddress = s.toLowerCase();
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

/* ------------ Firestore helpers (users/{address}) ------------ */
const keyOf  = (address)=> String(address||'').toLowerCase();
const userRef= (address)=> doc(db, 'users', keyOf(address));

function todayStr(){
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function ensureUserDoc(address, level=1){
  const ref = userRef(address);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    await setDoc(ref, {
      address: keyOf(address),
      level: level||1,
      hp: 1000, exp: 0, attack: 1, defense: 10,
      cp: 0, cpToday: 0, lastDate: todayStr(),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    await updateDoc(ref, { level: level||1, updatedAt: serverTimestamp() });
  }
}

async function ensureDailyReset(address){
  const ref = userRef(address);
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
    if (!userAddress) await hydrateAddressFromSessionOrWallet();
    if (userAddress){
      await ensureDailyReset(userAddress);
      const snap = await getDoc(userRef(userAddress));
      const data = snap.exists() ? (snap.data()||{}) : {};
      let daily  = Number(data.cpToday || 0) | 0;
      const last = String(data.lastDate || '');
      const total = Number(data.cp || 0) | 0;

      // Backfill or display-only fallback
      if (daily === 0 && last === todayStr() && total > 0){
        if (AUTO_BACKFILL_CP_TODAY){
          try{
            await updateDoc(userRef(userAddress), { cpToday: total, updatedAt: serverTimestamp() });
            daily = total;
          }catch(e){ console.warn('[cp-sync] backfill failed', e); daily = total; }
        } else {
          daily = total;
        }
      }
      return daily;
    }
    // no address yet => use local placeholder
    return Number(localStorage.getItem('cp_today') || 0) | 0;
  }
  // guest
  return Number(localStorage.getItem('cp_today') || 0) | 0;
}

async function addTodayCP(delta){
  const d = Math.max(0, Number(delta)||0);
  if (!d) return;
  if (mode !== 'wallet' || !userAddress){
    const cur = Number(localStorage.getItem('cp_today') || 0) | 0;
    localStorage.setItem('cp_today', String(cur + d));
  } else {
    await ensureDailyReset(userAddress);
    await updateDoc(userRef(userAddress), {
      cpToday: increment(d),
      cp: increment(d),
      updatedAt: serverTimestamp()
    });
  }
  await refreshCPUI();
}
window.__cp_addToday = addTodayCP; // optional external use

/* ------------ Level & buttons ------------ */
async function fetchLevel(address){
  let lv = 0;
  if (!address || !pupbank) return 0;
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
      ? `Eligible: ${Math.floor(Number(cp)/5000)} claim(s) (×5000 CP)`
      : 'Req: Level 1 & 5000+ CP today';
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
    const level = await fetchLevel(userAddress);
    if (levelViewEl) levelViewEl.textContent = String(level);

    if (level < 1){
      if (levelGateEl) levelGateEl.innerHTML = `Level 1 required → <a class="link-light" href="../memberjoin.html">Sign up</a>`;
      throw new Error('Level 1 required.');
    } else {
      if (levelGateEl) levelGateEl.textContent = 'Ready to connect.';
    }

    await ensureUserDoc(userAddress, level);
    await ensureDailyReset(userAddress);

    sessionStorage.setItem('GH_MODE', 'wallet');
    sessionStorage.setItem('GH_WALLET', userAddress);

    await refreshCPUI();
    alert('Wallet connected.');
  }catch(e){
    console.error(e);
    alert(e?.message || 'Failed to connect wallet.');
  }
}

/* ------------ Chain sync (5000 CP per batch) ------------ */
async function syncOnChain(){
  try{
    if (mode !== 'wallet') throw new Error('Wallet mode is required.');
    if (!userAddress) throw new Error('Connect your wallet first.');

    const level = Number(levelViewEl?.textContent || 0) || 0;
    if (level < 1) throw new Error('Level 1 required.');

    await ensureProvider();
    await ensureDailyReset(userAddress);

    const cp = await getTodayCP();
    const batches = Math.floor(cp / 5000);
    if (batches <= 0) throw new Error('5000+ CP is required to claim.');

    const tx = await gp.charge(batches);
    await tx.wait();

    const used = batches * 5000;
    await updateDoc(userRef(userAddress), {
      cpToday: increment(-used),
      cp: increment(-used),
      updatedAt: serverTimestamp()
    });

    alert(`On-chain claim completed: ${batches} × 5000 CP`);
    await refreshCPUI();
  }catch(e){
    console.error(e);
    alert(e?.message || 'Failed to claim on chain.');
  }
}

/* ------------ Events ------------ */
btnConnect?.addEventListener('click', connectWallet);
btnSync?.addEventListener('click', syncOnChain);
btnResetGuest?.addEventListener('click', ()=>{
  if (confirm('Reset guest CP for today?')){
    localStorage.removeItem('cp_today');
    refreshCPUI();
    alert('Guest data has been reset.');
  }
});

/* ------------ Boot ------------ */
(async function boot(){
  renderModeBox();
  await hydrateAddressFromSessionOrWallet();
  await refreshCPUI();
})();
