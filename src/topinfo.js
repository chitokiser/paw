// topinfo.js — StaticJsonRpcProvider fallback + 안정화(재선언 보호, 전역 오염 최소화)
;(function (g) {
  'use strict';

  // 이미 초기화되어 있으면 재선언/중복 바인딩 방지
  if (g.__TopInfoInit) return;
  g.__TopInfoInit = true;

  /* ================== 상수/ABI ================== */
  const cA = {
    cyadexAddr: "0xa100276E165895d09A58f7ea27321943F50e7E61",
    betgp:      "0x35f7cfD9D3aE6Fdf1c080C3dd725EC68EB017caE",
    mutbankAddr:"0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D",
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

  /* ================== 유틸 ================== */
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

  /* ================== BNB 가격 ================== */
  async function fetchBNBPrice() {
    try {
      const r = await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT", { timeout: 4000 });
      const p = parseFloat(r.data?.price);
      if (!isNaN(p) && p > 0) return p;
    } catch {}
    try {
      const r2 = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd", { timeout: 4000 });
      const p2 = parseFloat(r2.data?.binancecoin?.usd);
      if (!isNaN(p2) && p2 > 0) return p2;
    } catch {}
    throw new Error("Failed to fetch BNB price");
  }

  /* ================== RPC 헬스체크 & Provider ================== */
  // ⚠️ 전역 재선언 방지: OPBNB_RPCS를 파일 스코프로 한정 (전역에 올리지 않음)
  const OPBNB_RPCS = [
    "https://opbnb-mainnet-rpc.bnbchain.org",
    "https://opbnb-rpc.publicnode.com",
    "https://opbnb.blockpi.network/v1/rpc/public",
    "https://1rpc.io/opbnb"
  ];

  async function pickHealthyRpc(timeoutMs = 4000) {
    for (const url of OPBNB_RPCS) {
      try {
        const p = new ethers.providers.StaticJsonRpcProvider(
          { url, timeout: timeoutMs },
          { chainId: 204, name: "opbnb" }
        );
        await Promise.race([
          p.getBlockNumber(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))
        ]);
        return p;
      } catch {}
    }
    throw new Error("No healthy opBNB RPC found");
  }

  // 싱글톤 캐시(전역 충돌 없이 window에만 저장)
  let __readProvider = null;
  async function getReadProvider() {
    if (__readProvider) return __readProvider;
    __readProvider = await pickHealthyRpc();
    return __readProvider;
  }

  /* ================== 지갑/사인 ================== */
  let signer2;
  async function ensureOpBNB(userProvider) {
    const net = await userProvider.getNetwork();
    if (Number(net.chainId) === 204) return;
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

  async function initializeProvider() {
    if (!g.ethereum) throw new Error("No wallet");
    const userProvider = new ethers.providers.Web3Provider(g.ethereum, "any");
    await userProvider.send("eth_requestAccounts", []);
    await ensureOpBNB(userProvider);
    signer2 = userProvider.getSigner();
    return signer2;
  }

  /* ================== UI 헬퍼 ================== */
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

  /* ================== 퍼블릭 함수 ================== */
  async function topData() {
    try {
      const bnb = await fetchBNBPrice();
      setText("bPrice", bnb.toFixed(2));
      setText("cPrice2", (1 / bnb).toFixed(4));

      const provider = await getReadProvider();
      const cyadex  = new ethers.Contract(cA.cyadexAddr, cB.cyadex, provider);
      const bank    = new ethers.Contract(cA.mutbankAddr, cB.mutbank, provider);

      const [dexBal, holders] = await Promise.all([cyadex.balance(), bank.sum()]);
      setText("Tvl", (Number(dexBal) / 1e18).toFixed(2));
      setText("Sum", holders.toString());
    } catch (e) {
      console.error("topData error:", e);
      alert(`Error: ${shortError(e)}`);
    }
  }

  async function Tmemberjoin() {
    try {
      await initializeProvider();
      const bank = new ethers.Contract(cA.mutbankAddr, cB.mutbank, signer2);
      const mento = g.document?.getElementById?.("Maddress")?.value || "";
      const tx = await bank.memberjoin(mento);
      await tx.wait();
      alert("Signup Success!");
    } catch (e) {
      alert(`Error: ${shortError(e)}`);
    }
  }

  async function addTokenPAW() {
    if (!g.ethereum) return alert("MetaMask/Rabby is not installed!");
    try {
      await g.ethereum.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: cA.erc20, symbol: "PAW", decimals: 18 } }
      });
      alert("PAW Token has been added to your wallet!");
      showTokenLogo("PAW");
    } catch (e) {
      console.error(e); alert("Failed to add PAW Token");
    }
  }

  async function addTokenPUP() {
    if (!g.ethereum) return alert("MetaMask/Rabby is not installed!");
    try {
      await g.ethereum.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: "0x147ce247Ec2B134713fB6De28e8Bf4cAA5B4300C", symbol: "PUP", decimals: 0 } }
      });
      alert("PUP Token has been added to your wallet!");
      showTokenLogo("PUP");
    } catch (e) {
      console.error(e); alert("Failed to add PUP Token");
    }
  }

  /* ================== 전역 노출 (중복 바인딩 방지) ================== */
  if (!g.topData)      g.topData      = topData;
  if (!g.Tmemberjoin)  g.Tmemberjoin  = Tmemberjoin;
  if (!g.addTokenPAW)  g.addTokenPAW  = addTokenPAW;
  if (!g.addTokenPUP)  g.addTokenPUP  = addTokenPUP;

  // 자동 실행(있을 때만)
  g.addEventListener?.("load", () => {
    if (g.document?.getElementById?.("bPrice")) topData();
  });

})(window);
