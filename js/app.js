// /geolocation/js/app.js
// 지갑 연결 → PUPBank 레벨1 검사 → users/{addressLower} 보장 → main() 시작
import { main } from './main.js';
import { db } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* -------------------- UI: 지갑 게이트 -------------------- */
function showWalletGate() {
  document.getElementById('auth-gate')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'auth-gate';
  Object.assign(wrap.style, {
    position:'fixed', inset:'0',
    background:'linear-gradient(180deg,#0b1220,#0b1220e6)',
    display:'grid', placeItems:'center', zIndex:999999
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    width:'min(420px,92vw)', background:'#111827', color:'#e5e7eb',
    borderRadius:'16px', boxShadow:'0 20px 60px rgba(0,0,0,.45)', padding:'18px'
  });
  card.innerHTML = `
    <div style="font-weight:800;font-size:20px;margin-bottom:14px;">GeoHunt · 지갑 연결</div>
    <button id="btn-wallet" style="
      width:100%;padding:12px;border-radius:12px;border:none;
      background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;font-weight:800;">
      🔐 opBNB 지갑 연결
    </button>
    <div id="auth-msg" style="min-height:18px;margin-top:10px;color:#93c5fd;font-size:12px;"></div>
    <div style="margin-top:8px;color:#9ca3af;font-size:12px;">
      * 레벨 1 이상만 입장 가능합니다. 미달 시 회원가입/레벨업 페이지로 이동합니다.
    </div>
  `;

  const msgEl = card.querySelector('#auth-msg');
  card.querySelector('#btn-wallet').addEventListener('click', async () => {
    msgEl.textContent = '지갑 확인 중…';
    try {
      await walletLevelGateAndStart((m)=> msgEl.textContent = m);
    } catch (e) {
      msgEl.textContent = e?.message || '지갑 연결 실패';
    }
  });

  wrap.appendChild(card);
  document.body.appendChild(wrap);
}
function hideWalletGate(){ document.getElementById('auth-gate')?.remove(); }

/* -------------------- Chain / Gate helpers -------------------- */
const contractAddress = {
  pupbank: "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D",
};
const pupbankAbi = [
  "function myinfo(address) view returns(uint256,uint256,uint256,address,uint256)",
  "function getlevel(address) view returns(uint)"
];

async function ensureEthers() {
  if (window.ethers) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js";
    s.onload = resolve; s.onerror = ()=>reject(new Error('ethers 로드 실패'));
    document.head.appendChild(s);
  });
}

async function ensureProvider() {
  await ensureEthers();
  const { ethers } = window;
  if (!window.ethereum) throw new Error('지갑이 설치되어 있지 않습니다.');
  const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0xCC",
        rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
        chainName: "opBNB",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        blockExplorerUrls: ["https://opbnbscan.com"]
      }]
    });
  } catch(_) {}
  await provider.send("eth_requestAccounts", []);
  const signer = provider.getSigner();
  const address = (await signer.getAddress()).toLowerCase();
  const pupbank = new window.ethers.Contract(contractAddress.pupbank, pupbankAbi, signer);
  return { provider, signer, address, pupbank };
}

async function getLevel(pupbank, address) {
  try {
    const [_td, _bonus, lv] = await pupbank.myinfo(address);
    return Number(lv||0);
  } catch {
    try { return Number(await pupbank.getlevel(address)) || 0; }
    catch { return 0; }
  }
}

/* -------------------- Firestore: 지갑주소 = 기준ID -------------------- */
function userRefByAddress(addressLower) {
  return doc(db, 'users', addressLower);
}
function todayStr(){
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
async function ensureUserDoc(addressLower, level) {
  const ref = userRefByAddress(addressLower);
  const ss = await getDoc(ref);
  if (!ss.exists()) {
    await setDoc(ref, {
      address: addressLower,
      level: level || 1,
      hp: 1000, exp: 0, attack: 1, defense: 10,
      cp: 0, cpToday: 0, lastDate: todayStr(),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    await updateDoc(ref, { level: level || 1, updatedAt: serverTimestamp() });
  }
}

/* -------------------- Gate → main() -------------------- */
async function walletLevelGateAndStart(setMsg = ()=>{}) {
  setMsg('opBNB 지갑 연결…');
  const { address, pupbank } = await ensureProvider();

  setMsg('레벨 확인…');
  const level = await getLevel(pupbank, address);
  if (level < 1) {
    setMsg('레벨 1 미만입니다. 회원가입 페이지로 이동합니다…');
    alert('레벨 1 이상만 입장 가능합니다.');
    location.href = '../memberjoin.html';
    throw new Error('level_gate_blocked');
  }

  setMsg('프로필 준비…');
  await ensureUserDoc(address, level);

  // 게임 전역/세션에 기준 ID 공유
  sessionStorage.setItem('GH_MODE', 'wallet');
  sessionStorage.setItem('GH_WALLET', address);
  window.__GH_WALLET__ = address;

  hideWalletGate();

  // ✅ 레벨1 통과 → 게임 시작
  await main();
}

/* -------------------- 부팅 -------------------- */
(function boot(){
  console.log('[APP] boot() wallet gate');
  showWalletGate();

  // 월렛이 이미 연결되어 있으면 자동 시도 (UX 편의)
  // 일부 지갑은 selectedAddress를 제공하지 않을 수 있음
  if (window.ethereum && window.ethereum.selectedAddress) {
    walletLevelGateAndStart().catch(()=>{ /* 사용자 수동 클릭 대기 */ });
  }
})();
