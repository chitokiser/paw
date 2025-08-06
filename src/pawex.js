
   
      const contractAddress = {
        cyadexAddr: "0xa100276E165895d09A58f7ea27321943F50e7E61", //pawex  
        cyabankAddr:"0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D", //pupbank
        erc20: "0xCC1ce312b7A7C4A78ffBf51F8fc0e087C1D4c72f" //paw
      };
      const contractAbi = {
        cyadex: [
          "function getprice() public view returns(uint256)",
          "function balance() public view returns(uint256)",
          "function pawbalances() public view returns(uint256)",
          "function pawbuy() external payable",
          "function bnbsell(uint256 num) external",
          "function priceup(uint256 newPrice) external",
        ],
     
        erc20: [
          "function approve(address spender, uint256 amount) external returns (bool)",
          "function allowance(address owner, address spender) external view returns (uint256)"
        ]
      };
     // 초기화
async function init() {
  provider = new ethers.providers.Web3Provider(window.ethereum, "any");

  // 네트워크 설정
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

  await provider.send("eth_requestAccounts", []);

  cyadexContract = new ethers.Contract(contractAddress.cyadexAddr, contractAbi.cyadex, provider);

  // 초기 데이터 갱신
  updatePriceInfo();

  // 입력 이벤트 바인딩
  setupInputListeners();
}

// 가격 및 잔고 갱신
async function updatePriceInfo() {
  const price = await cyadexContract.getprice();     // 정수 그대로
  const zembal = await cyadexContract.pawbalances(); // 18자리 단위

  document.getElementById("currentPrice").innerText = (price/1000).toFixed(2); // 그대로 표시
  document.getElementById("PAWbalan").innerText = (zembal / 1e18).toFixed(2);
}

// BNB → ZEM 환산
async function handleBnbInput(value) {
  const price = await cyadexContract.getprice(); // 정수
  if (!isNaN(value) && value > 0) {
    // 1BNB = price/1000 ZEM
    const zemAmount = (value * price/1000).toFixed(2);
    document.getElementById('bnbOutput').innerText = `${zemAmount} ZEM`;
  } else {
    document.getElementById('bnbOutput').innerText = "Estimated ZEM amount";
  }
}
        
  

// BNB → PAW 환산
async function handleBnbInput(value) {
  const price = await cyadexContract.getprice(); // 정수
  if (!isNaN(value) && value > 0) {
    // 1BNB = price/1000 ZEM
    const zemAmount = (value * price/1000).toFixed(2);
    document.getElementById('bnbOutput').innerText = `${zemAmount} PAW`;
  } else {
    document.getElementById('bnbOutput').innerText = "Estimated PAW amount";
  }
}

// PAW → BNB 환산
async function handleZemInput(value) {
  const price = await cyadexContract.getprice();
  if (!isNaN(value) && value > 0) {
    const bnbAmount = (value / price *1000).toFixed(4);
    document.getElementById('cyaOutput').innerText = `${bnbAmount} BNB`;
  } else {
    document.getElementById('cyaOutput').innerText = "Estimated BNB amount";
  }
}

// 입력 이벤트 설정
function setupInputListeners() {
  document.getElementById('bnbInput').addEventListener('input', (e) => {
    handleBnbInput(parseFloat(e.target.value));
  });

  document.getElementById('cyaInput').addEventListener('input', (e) => {
    handleZemInput(parseFloat(e.target.value));
  });
}
     
// 구매
async function buyCya() {
  const signer = provider.getSigner();
  const cyadexContractSigned = new ethers.Contract(
    contractAddress.cyadexAddr,
    contractAbi.cyadex,
    signer
  );

  const bnbValue = document.getElementById('bnbInput').value;
  if (!bnbValue || isNaN(bnbValue) || bnbValue <= 0) {
    alert("Please enter the correct BNB amount.");
    return;
  }

  try {
    const tx = await cyadexContractSigned.pawbuy({
      value: ethers.utils.parseUnits(bnbValue, 18)
    });
    await tx.wait();
    alert("PAW purchase successful!");
  } catch (err) {
    console.error(err);
    alert("Purchase failed: " + (err?.error?.message || err.message));
  }
}

// 판매
async function sellCya() {
  const signer = provider.getSigner();
  const cyadexContractSigned = new ethers.Contract(contractAddress.cyadexAddr, contractAbi.cyadex, signer);
  const erc20Contract = new ethers.Contract(contractAddress.erc20, contractAbi.erc20, signer);

  const zemValue = document.getElementById('cyaInput').value;
  if (!zemValue || isNaN(zemValue) || zemValue <= 0) {
    alert("Please enter the correct PAW quantity.");
    return;
  }

  const quantity = ethers.utils.parseUnits(zemValue, 18);

  // Allowance 확인 후 승인
  const allowance = await erc20Contract.allowance(await signer.getAddress(), contractAddress.cyadexAddr);
  if (allowance.lt(quantity)) {
    await erc20Contract.approve(contractAddress.cyadexAddr, ethers.constants.MaxUint256);
  }

  await cyadexContractSigned.bnbsell(quantity);
}

// 가격 업데이트 (정수 그대로)
async function Priceup() {
  const signer = provider.getSigner();
  const cyadexContractSigned = new ethers.Contract(
    contractAddress.cyadexAddr,
    contractAbi.cyadex,
    signer
  );

const newPriceInput = document.getElementById("newPriceInput").value;
if (!newPriceInput || isNaN(newPriceInput)) {
  alert("Please enter the correct price (integer).");
  return;
}

// 입력값을 정수 변환 후 1000 곱하기
const newPrice = ethers.BigNumber.from(parseInt(newPriceInput) * 1000);

try {
  const tx = await cyadexContractSigned.priceup(newPrice);
  await tx.wait();
  alert("Price update complete!");
  updatePriceInfo();
} catch (err) {
  console.error("Price update failed:", err);
  alert("Failed to update price: " + err.message);
}
}

// 초기 실행
init();