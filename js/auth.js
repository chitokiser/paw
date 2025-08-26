// /geolocation/js/geowallet-auth.js
// Wallet Sign-In for geohome.html
// - Tries SIWE → Firebase Custom Token (if backend is available)
// - Falls back to wallet-only session if backend missing
// - English-only messages

import { auth, authReady, db } from './firebase.js';
import {
  doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const HAS_ETH = () => !!window.ethereum;
const $ = (id)=> document.getElementById(id);

function toast(msg){
  try{
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position:'fixed',left:'50%',bottom:'24px',transform:'translateX(-50%)',
      background:'rgba(0,0,0,.8)',color:'#fff',padding:'10px 14px',
      borderRadius:'12px',zIndex:9999,fontWeight:'700'
    });
    document.body.appendChild(el); setTimeout(()=>el.remove(), 1800);
  }catch{}
}

async function ensureChain(chainIdHex="0xCC"){
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chainIdHex,
        rpcUrls:["https://opbnb-mainnet-rpc.bnbchain.org"],
        chainName:"opBNB",
        nativeCurrency:{ name:"BNB", symbol:"BNB", decimals:18 },
        blockExplorerUrls:["https://opbnbscan.com"]
      }]
    });
  }
}

async function siweSignIn({
  getNonceUrl="/api/siwe/nonce",
  createTokenUrl="/api/siwe/createCustomToken",
  chainIdHex="0xCC"
} = {}) {
  if (!HAS_ETH()) throw new Error("Wallet (MetaMask/Rabby) is required.");

  // network (optional)
  try { await ensureChain(chainIdHex); } catch {}

  // request account
  const [address] = await window.ethereum.request({ method:"eth_requestAccounts" });
  if (!address) throw new Error("Wallet address is empty.");

  // nonce
  const nonceRes = await fetch(getNonceUrl, { credentials: "include" });
  if (!nonceRes.ok) throw new Error("Failed to fetch nonce endpoint.");
  const { nonce } = await nonceRes.json();

  // message (EIP-4361-lite)
  const domain = location.host;
  const uri = location.origin;
  const now = new Date().toISOString();
  const message =
`Sign-In With Wallet

Address: ${address}
Domain: ${domain}
URI: ${uri}
Issued At: ${now}
Nonce: ${nonce}`;

  // sign
  const signature = await window.ethereum.request({
    method: "personal_sign",
    params: [message, address]
  });

  // get custom token
  const tokenRes = await fetch(createTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ address, message, signature })
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    throw new Error("Failed to create custom token: " + t);
  }
  const { customToken } = await tokenRes.json();
  if (!customToken) throw new Error("Custom token missing.");

  // sign in to Firebase
  await authReady;
  const { signInWithCustomToken } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  await signInWithCustomToken(auth, customToken);

  // ensure profile
  const uid = address.toLowerCase();
  await setDoc(doc(db, "users", uid), { addr: uid, lastLoginAt: serverTimestamp() }, { merge: true });

  return address;
}

/** Wallet-only fallback (no Firebase Auth) */
async function walletOnlyConnect(chainIdHex="0xCC"){
  if (!HAS_ETH()) throw new Error("Wallet (MetaMask/Rabby) is required.");
  try { await ensureChain(chainIdHex); } catch {}
  const [address] = await window.ethereum.request({ method:"eth_requestAccounts" });
  if (!address) throw new Error("Wallet address is empty.");
  const addr = address.toLowerCase();
  sessionStorage.setItem("GH_MODE", "wallet");
  sessionStorage.setItem("GH_WALLET", addr);
  return addr;
}

/** Wire geohome UI */
export function wireGeohomeWallet({
  btnId="btnConnect", addrId="addr", levelId="levelView", levelGateId="levelGate",
  endpoints = { nonce:"/api/siwe/nonce", token:"/api/siwe/createCustomToken" }
} = {}){
  const btn = $(btnId);
  const addrEl = $(addrId);
  const levelView = $(levelId);
  const levelGate = $(levelGateId);

  if (!btn) return;

  btn.addEventListener("click", async ()=>{
    try{
      btn.disabled = true;
      btn.textContent = "Connecting…";

      let address;
      // Try SIWE first
      try {
        address = await siweSignIn({ getNonceUrl:endpoints.nonce, createTokenUrl:endpoints.token, chainIdHex:"0xCC" });
        toast("Wallet connected & signed in.");
      } catch (e) {
        console.warn("[geowallet-auth] SIWE failed, falling back to wallet-only mode:", e?.message || e);
        address = await walletOnlyConnect("0xCC");
        toast("Wallet connected (session only).");
      }

      if (addrEl) addrEl.textContent = address;
      if (levelView && !levelView.textContent) levelView.textContent = "1";
      if (levelGate) levelGate.textContent = "Ready to connect.";
    }catch(e){
      console.error(e);
      toast("Failed to connect wallet.");
      alert(e?.message || "Failed to connect wallet.");
    }finally{
      btn.disabled = false;
      btn.textContent = "Connect Wallet";
    }
  }, { passive:false });
}
