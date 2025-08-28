// topinfo.js — opBNB dashboard helper (fail-soft, collision-safe, v5/v6 ethers compatible)
;(function (g) {
  'use strict';

  // Avoid double-initialization
  if (g.__TopInfoInit) return;
  g.__TopInfoInit = true;

  // ---------- Config / ABI ----------
  const cA = {
    cyadexAddr: "0xa100276E165895d09A58f7ea27321943F50e7E61",
    betgp:      "0x35f7cfD9D3aE6Fdf1c080C3dd725EC68EB017caE",
    mutbankAddr:"0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D",  //pup뱅크
    erc20:      "0xCC1ce312b7A7C4A78ffBf51F8fc0e087C1D4c72f",
  };

  const cB = {
    cyadex: [
      "function getprice() view returns(uint256)",
      "function balance() view returns(uint256)",
      "function cyabalances() view returns(uint256)",
      "function buy() payable",
      "function sell(uint256 num)"
    ],
    betgp: [
      "function charge(uint256 _pay)",
      "function withdraw()",
      "function g1() view returns(uint256)",
      "function g2(address user) view returns(uint256)"
    ],
    mutbank: [
      "function sum() view returns(uint256)",
      "function memberjoin(address _mento)",
      "function withdraw()",
      "function g9(address user) view returns(uint256)"
    ]
  };

  // ---------- Small utils ----------
  function shortError(e) {
    let msg = e?.data?.message || e?.error?.message || e?.message || "Unknown error";
    if (typeof msg === "string" && msg.includes("execution reverted:"))
      msg = msg.split("execution reverted:")[1].trim();
    try { return msg.split("(")[0].trim(); } catch { return msg; }
  }
  function setText(id, text) {
    const el = g.document?.getElementById?.(id);
    if (el) el.textContent = text;
  }
  function hasAxios(){ return typeof g.axios === "function" || typeof g.axios === "object"; }

  async function httpGetJSON(url, params = {}, timeoutMs = 4000){
    // Prefer axios if present (to keep behavior consistent with other pages)
    if (hasAxios()){
      const r = await g.axios.get(url, { params, timeout: timeoutMs });
      return r.data;
    }
    // Fallback: fetch with AbortController
    const ctrl = ("AbortController" in g) ? new AbortController() : null;
    const t = ctrl ? setTimeout(()=>ctrl.abort(), timeoutMs) : null;
    try{
      const qs = Object.keys(params).length ? "?" + new URLSearchParams(params).toString() : "";
      const res = await fetch(url + qs, { signal: ctrl?.signal });
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } finally {
      if (t) clearTimeout(t);
    }
  }

  // ---------- BNB price (fail-soft with cache) ----------
  async function fetchBNBPrice() {
    // 1) CoinGecko
    try {
      const d = await httpGetJSON(
        "https://api.coingecko.com/api/v3/simple/price",
        { ids: "binancecoin", vs_currencies: "usd" },
        4000
      );
      const p = parseFloat(d?.binancecoin?.usd);
      if (!isNaN(p) && p > 0) return p;
    } catch {}

    // 2) Binance
    try {
      const d2 = await httpGetJSON(
        "https://api.binance.com/api/v3/ticker/price",
        { symbol: "BNBUSDT" },
        4000
      );
      const p2 = parseFloat(d2?.price);
      if (!isNaN(p2) && p2 > 0) return p2;
    } catch {}

    // 3) Cached value (30 min)
    try {
      const cached = localStorage.getItem("__bnb_usd_cache");
      if (cached){
        const obj = JSON.parse(cached);
        if (obj && Date.now() - obj.ts < 30 * 60 * 1000) {
          const pc = Number(obj.usd);
          if (!isNaN(pc) && pc > 0) return pc;
        }
      }
    } catch {}

    // Fail-soft: return null (never throw)
    return null;
  }

  // ---------- Provider (v5/v6 compatible) ----------
  const OPBNB_RPCS = [
    "https://opbnb-mainnet-rpc.bnbchain.org",
    "https://opbnb-rpc.publicnode.com",
    "https://opbnb.blockpi.network/v1/rpc/public",
    "https://1rpc.io/opbnb"
  ];
  const NET_V6 = { chainId: 204, name: "opbnb" };
  const NET_V5 = { chainId: 204, name: "opbnb" };

  function makeReadProvider(url, timeoutMs = 4000){
    // ethers v6 first
    if (g.ethers && typeof g.ethers.JsonRpcProvider === "function") {
      const p = new g.ethers.JsonRpcProvider(url, NET_V6);
      // patch: no built-in timeout; we will race in health check
      return p;
    }
    // ethers v5 fallback
    if (g.ethers && g.ethers.providers && typeof g.ethers.providers.StaticJsonRpcProvider === "function") {
      return new g.ethers.providers.StaticJsonRpcProvider({ url, timeout: timeoutMs }, NET_V5);
    }
    throw new Error("ethers.js not found");
  }

  async function healthCheck(p, timeoutMs){
    return Promise.race([
      p.getBlockNumber(),
      new Promise((_, rej)=>setTimeout(()=>rej(new Error("timeout")), timeoutMs))
    ]);
  }

  async function pickHealthyRpc(timeoutMs = 4000) {
    for (const url of OPBNB_RPCS) {
      try {
        const p = makeReadProvider(url, timeoutMs);
        await healthCheck(p, timeoutMs);
        return p;
      } catch {}
    }
    // Fail-soft: return null (topData will handle)
    return null;
  }

  let __readProvider = null;
  async function getReadProvider() {
    if (__readProvider) return __readProvider;
    __readProvider = await pickHealthyRpc();
    return __readProvider;
  }

  // ---------- Wallet / Signer (v5/v6 compatible) ----------
  async function ensureOpBNB(userProvider) {
    // v6 BrowserProvider: getNetwork(); v5 Web3Provider: getNetwork()
    const net = await userProvider.getNetwork();
    const cid = Number(net?.chainId ?? net?.chainId?.toString?.());
    if (cid === 204) return;

    if (!g.ethereum) throw new Error("No wallet found");
    try {
      await g.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xCC" }] });
    } catch {
      await g.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0xCC",
          rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
          chainName: "opBNB",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          blockExplorerUrls: ["https://opbnbscan.com"]
        }]
      });
    }
  }

  let __signer = null;
  async function initializeProvider() {
    if (!g.ethereum) throw new Error("No wallet found");
    // v6
    if (g.ethers && typeof g.ethers.BrowserProvider === "function") {
      const userProvider = new g.ethers.BrowserProvider(g.ethereum);
      await userProvider.send("eth_requestAccounts", []);
      await ensureOpBNB(userProvider);
      __signer = await userProvider.getSigner();
      return __signer;
    }
    // v5
    if (g.ethers && g.ethers.providers && typeof g.ethers.providers.Web3Provider === "function") {
      const userProvider = new g.ethers.providers.Web3Provider(g.ethereum, "any");
      await userProvider.send("eth_requestAccounts", []);
      await ensureOpBNB(userProvider);
      __signer = userProvider.getSigner();
      return __signer;
    }
    throw new Error("ethers.js not found");
  }

  // ---------- UI helpers ----------
  const tokenLogos = {
    PAW: "https://puppi.netlify.app/images/paw.png",
    PUP: "https://puppi.netlify.app/images/pup.png"
  };

  function showTokenLogo(symbol) {
    const url = tokenLogos[symbol];
    const box = g.document?.getElementById?.("tokenLogoContainer");
    if (url && box) {
      box.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px;">
          <img src="${url}" alt="${symbol} logo" style="width:40px;height:40px;border-radius:50%;">
          <span style="font-size:18px;font-weight:bold;">${symbol} Token Added!</span>
        </div>`;
    }
  }

  // ---------- Public functions (fail-soft) ----------
  async function topData() {
    try {
      // Price (fail-soft)
      const bnb = await fetchBNBPrice();
      if (typeof bnb === "number" && bnb > 0) {
        setText("bPrice", bnb.toFixed(2));
        setText("cPrice2", (1 / bnb).toFixed(4));
        try { localStorage.setItem("__bnb_usd_cache", JSON.stringify({ usd: bnb, ts: Date.now() })); } catch {}
      } else {
        setText("bPrice", "-");
        setText("cPrice2", "-");
      }

      // Read provider (fail-soft)
      const provider = await getReadProvider();
      if (!provider) {
        console.warn("[TopInfo] No healthy opBNB RPC found. Skipping on-chain reads.");
        return;
      }

      // On-chain reads
      const cyadex  = new g.ethers.Contract(cA.cyadexAddr, cB.cyadex, provider);
      const bank    = new g.ethers.Contract(cA.mutbankAddr, cB.mutbank, provider);

      const [dexBal, holders] = await Promise.allSettled([cyadex.balance(), bank.sum()]);
      if (dexBal.status === "fulfilled") setText("Tvl", (Number(dexBal.value) / 1e18).toFixed(2));
      else setText("Tvl", "-");

      if (holders.status === "fulfilled") setText("Sum", holders.value.toString());
      else setText("Sum", "-");
    } catch (e) {
      // Do not alert; do not throw (avoid breaking other pages)
      console.warn("[TopInfo] topData soft-fail:", shortError(e));
    }
  }

  async function Tmemberjoin() {
    try {
      const signer = __signer || await initializeProvider();
      const bank = new g.ethers.Contract(cA.mutbankAddr, cB.mutbank, signer);
      const mento = g.document?.getElementById?.("Maddress")?.value || "";
      const tx = await bank.memberjoin(mento);
      await tx.wait();
      alert("Signup success!");
    } catch (e) {
      alert("Error: " + shortError(e));
    }
  }

  async function addTokenPAW() {
    if (!g.ethereum) return alert("MetaMask/Rabby is not installed!");
    try {
      await g.ethereum.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: cA.erc20, symbol: "PAW", decimals: 18 } }
      });
      alert("PAW token has been added to your wallet!");
      showTokenLogo("PAW");
    } catch (e) {
      console.warn(e); alert("Failed to add PAW token.");
    }
  }

  async function addTokenPUP() {
    if (!g.ethereum) return alert("MetaMask/Rabby is not installed!");
    try {
      await g.ethereum.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: "0x147ce247Ec2B134713fB6De28e8Bf4cAA5B4300C", symbol: "PUP", decimals: 0 } }
      });
      alert("PUP token has been added to your wallet!");
      showTokenLogo("PUP");
    } catch (e) {
      console.warn(e); alert("Failed to add PUP token.");
    }
  }

  // ---------- Collision-safe exports ----------
  const NS = "TopInfo";
  const api = { topData, Tmemberjoin, addTokenPAW, addTokenPUP, getReadProvider, initializeProvider };
  g[NS] = g[NS] || api; // attach namespace
  // Backward-compatible aliases (only if NOT already defined)
  if (!g.topData)     g.topData     = topData;
  if (!g.Tmemberjoin) g.Tmemberjoin = Tmemberjoin;
  if (!g.addTokenPAW) g.addTokenPAW = addTokenPAW;
  if (!g.addTokenPUP) g.addTokenPUP = addTokenPUP;

  // ---------- Safe auto-run ----------
  g.addEventListener?.("load", () => {
    // Only run if these IDs exist on the page
    const need = g.document?.getElementById?.("bPrice")
              || g.document?.getElementById?.("cPrice2")
              || g.document?.getElementById?.("Tvl")
              || g.document?.getElementById?.("Sum");
    if (need) {
      Promise.resolve().then(()=> topData()).catch((e)=>console.warn("[TopInfo] autorun failed:", shortError(e)));
    }
  });

})(window);
