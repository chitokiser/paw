// mission.api.js — EVM/provider & contract calls (opBNB 204)
// ethers UMD(window.ethers) 전제. ES 모듈.

const ethers = globalThis.ethers;

// === 네트워크/컨트랙트 주소 (필요 시 교체) ===
export const C2E_ADDR     = "0xe650d115F07370e4A35cD2b85899F6Cc651c8d3C"; // C2E 컨트랙트
export const PUPBANK_ADDR = "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D"; // PupBank(옵션)
export const CHAIN_ID_DEC = 204;                       // opBNB
export const CHAIN_ID_HEX = "0x" + CHAIN_ID_DEC.toString(16);

// === ABI (미션별 claim/resolve + 모니터링 getter 포함) ===
const C2E_ABI = [
  // 읽기
  "function g1() view returns (uint256)",
  "function totalwithdraw() view returns (uint256)",
  "function mid() view returns (uint256)",
  "function memberid(uint256) view returns (address)",
  "function ranking(address) view returns (uint256)",
  "function pay(uint256) view returns (uint256)",

  // myinfo 구조는 컨트랙트 실제 정의를 따릅니다.
  // (여기 표기는 일반적인 필드명 예시)
  "function myinfo(address) view returns (uint256 mypay, uint256 totalpay, uint256 allow, uint256 rating, bool white, bool blacklisted)",

  "function allowt(address) view returns (uint256)",
  "function adprice(uint256) view returns (uint256)",
  "function availableToWithdraw(address) view returns (uint256)",
  "function isClaimPending2(address,uint256) view returns (bool)",
  "function isClaimPending3(address,uint256) view returns (bool)",
  "function isClaimPending4(address,uint256) view returns (bool)",

  // 쓰기(레거시)
  "function m1()",
  "function claimpay(uint256)",
  "function withdraw()",
  "function resolveClaim(address,uint256,uint8)",

  // ★ 미션별 보상요구/처리
  "function claimpay2(uint256)",
  "function claimpay3(uint256)",
  "function claimpay4(uint256)",
  "function resolveClaim2(address,uint256,uint8)",
  "function resolveClaim3(address,uint256,uint8)",
  "function resolveClaim4(address,uint256,uint8)",

  // ★ 모니터링용 public mapping getter
  "function claim2(address,uint256) view returns (bool)",
  "function claim3(address,uint256) view returns (bool)",
  "function claim4(address,uint256) view returns (bool)",
  "function claim44(uint256,address) view returns (uint256)",

  "function staff(address) view returns (uint8)"
];

const PUPBANK_ABI = [
  // 필요 시만 사용
  "function buffing()"
];

// ——————————————————————————————————————
// provider / signer / contracts
// ——————————————————————————————————————
let provider = null;
let signer   = null;
let me       = null;
let c2e      = null;
let pupbank  = null;

export async function ensureChain(){
  // connect() 이후 보통 호출됨. provider 없을 경우 지갑만 연결 없이 provider 생성
  if (!provider) {
    if (!globalThis.ethereum) throw new Error("No wallet provider");
    provider = new ethers.BrowserProvider(globalThis.ethereum, "any");
  }
  const net = await provider.getNetwork();
  if (net.chainId !== BigInt(CHAIN_ID_DEC)) {
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }]);
    } catch (e) {
      if (e?.code === 4902) {
        await provider.send("wallet_addEthereumChain", [{
          chainId: CHAIN_ID_HEX, chainName: "opBNB Mainnet",
          nativeCurrency:{ name:"BNB", symbol:"BNB", decimals:18 },
          rpcUrls:["https://opbnb-mainnet-rpc.bnbchain.org"],
          blockExplorerUrls:["https://mainnet.opbnbscan.com"]
        }]);
      } else { throw e; }
    }
  }
  const final = await provider.getNetwork();
  return "0x" + final.chainId.toString(16);
}

export async function connect(){
  if (!globalThis.ethereum) throw new Error("지갑(메타마스크 등)이 필요합니다");
  if (!provider) provider = new ethers.BrowserProvider(globalThis.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  me     = await signer.getAddress();
  await ensureChain();

  c2e     = new ethers.Contract(C2E_ADDR, C2E_ABI, signer);
  pupbank = new ethers.Contract(PUPBANK_ADDR, PUPBANK_ABI, signer);

  // 계정/체인 변경 시 새로고침
  const eth = globalThis.ethereum;
  eth?.removeAllListeners?.("accountsChanged");
  eth?.on?.("accountsChanged", ()=>location.reload());
  eth?.removeAllListeners?.("chainChanged");
  eth?.on?.("chainChanged", ()=>location.reload());

  return { me };
}

export function getState(){ return { provider, signer, me, c2e, pupbank }; }

async function getReaders(){
  // 읽기 전용 빠른 조회
  const ro = new ethers.JsonRpcProvider("https://opbnb-mainnet-rpc.bnbchain.org");
  return {
    c2eR: new ethers.Contract(C2E_ADDR, C2E_ABI, ro),
    pupR: new ethers.Contract(PUPBANK_ADDR, PUPBANK_ABI, ro),
  };
}

// ——————————————————————————————————————
// 공개 API
// ——————————————————————————————————————
export const api = {
  // 전체 정보
  async global(){
    const { c2eR } = await getReaders();
    const [pool, totalW, mid] = await Promise.all([
      c2eR.g1(), c2eR.totalwithdraw(), c2eR.mid()
    ]);
    return { pool, totalW, mid:Number(mid) };
  },

  // 개인 정보
  async my(addr){
    const { c2eR } = await getReaders();
    const [info, last, avail] = await Promise.all([
      c2eR.myinfo(addr),        // { mypay, totalpay, allow, rating, white, blacklisted, ... }
      c2eR.allowt(addr),        // last withdraw timestamp 등 (컨트랙트 구현에 맞춰 사용)
      c2eR.availableToWithdraw(addr)
    ]);
    return { info, last, avail };
  },

  async adprice(id){
    const { c2eR } = await getReaders();
    return c2eR.adprice(id);
  },

  async isPending(addr, id){
    const { c2eR } = await getReaders();
    const n = Number(id);
    if (n === 2) return c2eR.isClaimPending2(addr, n);
    if (n === 3) return c2eR.isClaimPending3(addr, n);
    if (n >= 4) return c2eR.isClaimPending4(addr, n);
    return false; // Default to false for other mission IDs
  },

  // 랭킹 Top 스캔
  async ranking(limit=300){
    const { c2eR } = await getReaders();
    const mid = Number(await c2eR.mid());
    const n = Math.min(mid, limit);
    const rows = [];
    for (let i=0;i<n;i++){
      try{
        const addr = await c2eR.memberid(i);
        if (!addr || addr === ethers.ZeroAddress) continue;
        const val = await c2eR.ranking(addr);
        rows.push({ addr, val });
      }catch{}
    }
    rows.sort((a,b)=> (a.val > b.val ? -1 : 1));
    return rows.slice(0,10);
  },

  // 미션1 등록
  async m1(){ return (await getState()).c2e.m1(); },

  // (레거시) 단일 클레임
  async claim(id){ return (await getState()).c2e.claimpay(Number(id)); },

  // ★ 미션별 분기 클레임: 2→claimpay2, 3→claimpay3, 4+→claimpay4
  async claimByMission(id){
    const s = await getState();
    const n = Number(id);
    if (n === 2) return s.c2e.claimpay2(n);
    if (n === 3) return s.c2e.claimpay3(n);
    if (n >= 4)  return s.c2e.claimpay4(n);
    return s.c2e.claimpay(n); // 미션1 등 레거시
  },

  // 인출
  async withdraw(){ return (await getState()).c2e.withdraw(); },

  // (레거시) 단일 resolve
  async resolve(u,id,g){ return (await getState()).c2e.resolveClaim(u, Number(id), Number(g)); },

  // ★ 미션별 분기 resolve: 2→resolveClaim2, 3→resolveClaim3, 4+→resolveClaim4
  async resolveByMission(user, id, grade){
    const s = await getState();
    const u = String(user);
    const n = Number(id);
    const g = Number(grade);
    if (n === 2) return s.c2e.resolveClaim2(u, n, g);
    if (n === 3) return s.c2e.resolveClaim3(u, n, g);
    if (n >= 4)  return s.c2e.resolveClaim4(u, n, g);
    return s.c2e.resolveClaim(u, n, g); // 레거시
  },

  // ★ 모니터링: claim2/3/4/44 값 조회 (필요 시 사용)
  async claimStatus(user, id){
    const { c2eR } = await getReaders();
    const u = String(user).toLowerCase();
    const n = Number(id);
    const [c2, c3, c4, c44] = await Promise.all([
      c2eR.claim2(u, n),
      c2eR.claim3(u, n),
      c2eR.claim4(u, n),
      c2eR.claim44(n, u)
    ]);
    return { c2, c3, c4, c44 };
  },

  // PupBank (옵션)
  async buffing(){
    // pupbank에 buffing()이 없으면 에러 → 상위에서 토스트 처리
    return (await getState()).pupbank.buffing();
  },

  async isStaff(addr){
    const { c2eR } = await getReaders();
    try{ return Number(await c2eR.staff(addr)) >= 5; }catch{ return false; }
  }
};
