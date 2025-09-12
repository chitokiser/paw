// mission.api.js — EVM/provider & contract calls (safe against 4900)
// ES Module (import 되는 파일). ethers는 UMD로 window.ethers에 로드됨.
const ethers = globalThis.ethers;

export const C2E_ADDR     = "0x44deEe33ca98094c40D904BFf529659a742db97E";
export const PUPBANK_ADDR = "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D";
export const CHAIN_ID_DEC = 204; // opBNB
export const CHAIN_ID_HEX = "0x" + CHAIN_ID_DEC.toString(16);

const C2E_ABI = [
  "function g1() view returns (uint256)",
  "function totalwithdraw() view returns (uint256)",
  "function mid() view returns (uint256)",
  "function memberid(uint256) view returns (address)",
  "function ranking(address) view returns (uint256)",
  "function pay(uint256) view returns (uint256)",
  "function myinfo(address) view returns (uint256 mypay, uint256 totalpay, uint256 allow, uint256 rating, bool white, bool blacklisted)",
  "function allowt(address) view returns (uint256)",
  "function adprice(uint256) view returns (uint256)",  //미션수행 보상 가져와서 보여주기
  "function availableToWithdraw(address) view returns (uint256)",
  "function isClaimPending(address,uint256) view returns (bool)",
  "function m1()", "function claimpay(uint256)", "function withdraw()", "function resolveClaim(address,uint256,uint8)",
  "function staff(address) view returns (uint8)"
];

const PUPBANK_ABI = [
  "function buffing()",
  "function getlevel(address) view returns (uint256)",
  "function myinfo(address) view returns(uint256,uint256,uint256,address,uint256)"
];

let provider, signer, me, c2e, pupbank;

export const getState = () => ({ provider, signer, me, c2e, pupbank });

export function fmt18(x){ try{ return Number(ethers.formatUnits(x,18)); } catch { return 0; } }
export function shortAddr(a){ return a ? a.slice(0,6)+"…"+a.slice(-4) : "-"; }

// --- 4900 방지 유틸 ---
export function isEthConnected() {
  const eth = globalThis.ethereum;
  if (!eth) return false;
  if (typeof eth.isConnected === "function") {
    try { return !!eth.isConnected(); } catch {}
  }
  return !!eth._state?.isConnected;
}

async function safeRequest(method, params = []) {
  const eth = globalThis.ethereum;
  if (!eth) throw new Error("No wallet provider");
  if (!isEthConnected() && method !== "eth_requestAccounts") {
    const err = new Error("Provider disconnected");
    err.code = 4900;
    throw err;
  }
  return await eth.request({ method, params });
}

// 온체인 스태프
async function staffLevel(addr){
  const { c2e } = getState();
  if (!addr) return 0;
  const n = await c2e.staff(addr);
  return Number(n);
}
async function isStaff(addr){ return (await staffLevel(addr)) >= 5; }

// --- Provider / Chain ---
export async function ensureProvider(){
  if (!globalThis.ethereum) throw new Error("No wallet provider");
  provider = new ethers.BrowserProvider(globalThis.ethereum, "any");
  return provider;
}

export async function ensureChain(){
  if (!isEthConnected()) return null; // 연결 전이면 생략
  const net = await safeRequest("eth_chainId");
  if ((net||"").toLowerCase() !== CHAIN_ID_HEX){
    try {
      await safeRequest("wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }]);
    } catch (e) {
      if (e?.code === 4902) {
        await safeRequest("wallet_addEthereumChain", [{
          chainId: CHAIN_ID_HEX, chainName: "opBNB Mainnet",
          nativeCurrency:{ name:"BNB", symbol:"BNB", decimals:18 },
          rpcUrls:["https://opbnb-mainnet-rpc.bnbchain.org"],
          blockExplorerUrls:["https://mainnet.opbnbscan.com"]
        }]);
      } else { throw e; }
    }
  }
  return await safeRequest("eth_chainId");
}

export async function connect(){
  await ensureProvider();
  const accs = await safeRequest("eth_requestAccounts");
  me = ethers.getAddress(accs[0]);
  signer = await provider.getSigner();
  await ensureChain();
  c2e = new ethers.Contract(C2E_ADDR, C2E_ABI, signer);
  pupbank = new ethers.Contract(PUPBANK_ADDR, PUPBANK_ABI, signer);

  const eth = globalThis.ethereum;
  eth?.removeAllListeners?.("disconnect");
  eth?.on?.("disconnect", () => {
    provider = undefined; signer = undefined; me = undefined; c2e = undefined; pupbank = undefined;
  });
  eth?.removeAllListeners?.("accountsChanged");
  eth?.on?.("accountsChanged", () => location.reload());
  eth?.removeAllListeners?.("chainChanged");
  eth?.on?.("chainChanged", () => location.reload());

  return { me };
}

// 읽기 인스턴스 (지갑 없을 때 RPC 폴백)
export async function getReaders(){
  if (provider) {
    const c2eR = new ethers.Contract(C2E_ADDR, C2E_ABI, provider);
    const pupR = new ethers.Contract(PUPBANK_ADDR, PUPBANK_ABI, provider);
    return { c2eR, pupR };
  }
  if (globalThis.ethereum) {
    // 지갑은 있으나 ensureProvider 전이면 브라우저 프로바이더로
    await ensureProvider();
    const c2eR = new ethers.Contract(C2E_ADDR, C2E_ABI, provider);
    const pupR = new ethers.Contract(PUPBANK_ADDR, PUPBANK_ABI, provider);
    return { c2eR, pupR };
  }
  // 완전 읽기 전용
  const ro = new ethers.JsonRpcProvider("https://opbnb-mainnet-rpc.bnbchain.org");
  const c2eR = new ethers.Contract(C2E_ADDR, C2E_ABI, ro);
  const pupR = new ethers.Contract(PUPBANK_ADDR, PUPBANK_ABI, ro);
  return { c2eR, pupR };
}

// ====== adprice helpers ======
async function getAdPrice(id) {
  const { c2eR } = await getReaders();
  return c2eR.adprice(id); // uint256 (18dec)
}
async function getAdPrices(ids = [2,3,4,5,6,7]) {
  const { c2eR } = await getReaders();
  const vals = await Promise.all(ids.map(i => c2eR.adprice(i)));
  return ids.map((id, idx) => ({ id, raw: vals[idx], paw: fmt18(vals[idx]) }));
}

// --- Read/Write API ---
export const api = {
  adprice:  getAdPrice,
  adprices: getAdPrices,

  async global() {
    const { c2eR } = await getReaders();
    const [pool, totalW, mid] = await Promise.all([ c2eR.g1(), c2eR.totalwithdraw(), c2eR.mid() ]);
    return { pool, totalW, mid: Number(mid) };
  },
  async my(meAddr){
    const { c2eR } = await getReaders();
    const [info, last, avail] = await Promise.all([
      c2eR.myinfo(meAddr), c2eR.allowt(meAddr), c2eR.availableToWithdraw(meAddr)
    ]);
    return { info, last, avail };
  },
  async pay(id){ const { c2eR } = await getReaders(); return c2eR.pay(id); },
  async isPending(user, id){ const { c2eR } = await getReaders(); return c2eR.isClaimPending(user, id); },
  async ranking(limit=300){
    const { c2eR } = await getReaders();
    const mid = Number(await c2eR.mid());
    const scan = Math.min(mid, limit);
    const out = [];
    for(let i=0;i<scan;i++){
      try{
        const addr = await c2eR.memberid(i);
        if(addr && addr !== ethers.ZeroAddress){
          const val = await c2eR.ranking(addr);
          if (BigInt(val) > 0n) out.push({ addr, val: BigInt(val) });
        }
      }catch{}
    }
    out.sort((a,b)=> (b.val>a.val?1:-1));
    return out.slice(0,10);
  },
  async m1(){ return (await getState()).c2e.m1(); },
  async claim(id){ return (await getState()).c2e.claimpay(id); },
  async withdraw(){ return (await getState()).c2e.withdraw(); },
  async resolve(u,id,g){ return (await getState()).c2e.resolveClaim(u,id,g); },
  async buffing(){ return (await getState()).pupbank.buffing(); },
  staffLevel,
  isStaff,
};
