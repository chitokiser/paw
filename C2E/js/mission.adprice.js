// mission.adprice.js — adprice(2..7) 읽어서 화면에 꽂기 (지갑 연결 불필요, 읽기 전용 RPC)
const ethers = globalThis.ethers;

// 필수 상수
const C2E_ADDR = "0x44deEe33ca98094c40D904BFf529659a742db97E";
const C2E_ABI  = ["function adprice(uint256) view returns (uint256)"];

// 읽기 전용 프로바이더 (opBNB 메인넷)
const ro = new ethers.JsonRpcProvider("https://opbnb-mainnet-rpc.bnbchain.org");
const c2eR = new ethers.Contract(C2E_ADDR, C2E_ABI, ro);

// 유틸: 18dec → Number → 보기좋게
const toPaw = (raw) => Number(ethers.formatUnits(raw, 18));
const fmt    = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

async function renderAdPrices(ids = [2,3,4,5,6,7]) {
  try {
    const vals = await Promise.all(ids.map(id => c2eR.adprice(id)));
    ids.forEach((id, i) => {
      const paw = toPaw(vals[i]);
      document.querySelectorAll(`[data-reward-for="${id}"]`)
        .forEach(el => el.textContent = fmt(paw));
    });
  } catch (e) {
    console.error("[adprice] 불러오기 실패:", e);
    ids.forEach(id => {
      document.querySelectorAll(`[data-reward-for="${id}"]`)
        .forEach(el => el.textContent = "-");
    });
  }
}

document.addEventListener("DOMContentLoaded", () => renderAdPrices());
