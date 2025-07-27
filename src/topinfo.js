const cA = {
  cyadexAddr: "0xa100276E165895d09A58f7ea27321943F50e7E61",//pawex
  betgp: "0x35f7cfD9D3aE6Fdf1c080C3dd725EC68EB017caE",
  mutbankAddr: "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D",
  erc20: "0xCC1ce312b7A7C4A78ffBf51F8fc0e087C1D4c72f",
};

const cB = {
  cyadex: [
    "function getprice() public view returns(uint256)",
    "function balance() public view returns(uint256)",
    "function cyabalances() public view returns(uint256)",
    "function buy() payable public",
    "function sell(uint256 num) public"
  ],
  betgp: [
    "function charge(uint _pay) public",
    "function withdraw() public",
    "function g1() public view returns(uint256)",
    "function g2(address user) public view returns(uint256)"
  ],
  mutbank: [
    "function sum() public view returns(uint256)",
    "function memberjoin(address _mento) public",
    "function withdraw() public",
    "function g9(address user) public view returns(uint256)"
  ]
};

// 에러 메시지 간소화
function shortError(e) {
  let msg = e?.data?.message || e?.error?.message || e?.message || "Unknown error";
  if (msg.includes("execution reverted:")) {
    msg = msg.split("execution reverted:")[1].trim();
  }
  return msg.split("(")[0].trim();
}

// BNB 가격 & 컨트랙트 데이터 불러오기
async function topData() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
    const bnbPrice = parseFloat(response.data.price);

    const bPriceEl = document.getElementById("bPrice");
    const cPrice2El = document.getElementById("cPrice2");
    const tvlEl = document.getElementById("Tvl");
    const sumEl = document.getElementById("Sum");

    if (bPriceEl) bPriceEl.innerHTML = bnbPrice.toFixed(2);
    if (cPrice2El) cPrice2El.innerHTML = (1 / bnbPrice).toFixed(4);

    const provider = new ethers.providers.JsonRpcProvider('https://1rpc.io/opbnb');
    const cyadexContract = new ethers.Contract(cA.cyadexAddr, cB.cyadex, provider);
    const mutbankContract = new ethers.Contract(cA.mutbankAddr, cB.mutbank, provider);

    const dexBal = await cyadexContract.balance();
    const holderCount = await mutbankContract.sum();

    if (tvlEl) tvlEl.innerHTML = (dexBal / 1e18).toFixed(2);
    if (sumEl) sumEl.innerHTML = holderCount.toString();
  } catch (e) {
    console.error("topData error:", e);
    alert(`Error: ${shortError(e)}`);
  }
}

let signer2;
async function initializeProvider() {
  const userProvider = new ethers.providers.Web3Provider(window.ethereum, "any");
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
  await userProvider.send("eth_requestAccounts", []);
  signer2 = userProvider.getSigner();
}

async function Tmemberjoin() {
  try {
    await initializeProvider();
    const meta5Contract = new ethers.Contract(cA.mutbankAddr, cB.mutbank, signer2);
    const mento = document.getElementById('Maddress')?.value || "";
    const tx = await meta5Contract.memberjoin(mento);
    await tx.wait();
    alert("Signup Success!");
  } catch (e) {
    alert(`Error: ${shortError(e)}`);
  }
}




// ================================
//  메타마스크 토큰 추가 함수
// ================================
async function addTokenPAW() {
  if (typeof window.ethereum === 'undefined') {
    alert("MetaMask is not installed!");
    return;
  }

  try {
    await window.ethereum.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: "0xCC1ce312b7A7C4A78ffBf51F8fc0e087C1D4c72f", // PAW Token 주소
          symbol: "PAW",
          decimals: 18,
        },
      },
    });
    alert("PAW Token has been added to MetaMask!");
  } catch (error) {
    console.error("Error adding PAW token:", error);
    alert("Failed to add PAW Token");
  }
}

async function addTokenPUP() {
  if (typeof window.ethereum === 'undefined') {
    alert("MetaMask is not installed!");
    return;
  }

  try {
    await window.ethereum.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: "0x147ce247Ec2B134713fB6De28e8Bf4cAA5B4300C", // PUP Token 주소
          symbol: "PUP",
          decimals: 0, // PUP은 소수점 없음
        },
      },
    });
    alert("PUP Token has been added to MetaMask!");
  } catch (error) {
    console.error("Error adding PUP token:", error);
    alert("Failed to add PUP Token");
  }
}


// DOM 로드 시 실행
window.addEventListener("load", () => {
  if (document.getElementById("bPrice")) {
    topData();
  }
});


