const contractAddress = {
  cyabankAddr: "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D" // PUPbank
};

const contractAbi = {
  cyabank: [
    "function g1() public view virtual returns(uint256)",
    "function g3() public view returns(uint)",
    "function g11() public view virtual returns(uint256)",
    "function getprice() public view returns (uint256)",
    "function allow() view returns(uint256)",
    "function allowt(address) view returns(uint256)",
    "function act() view returns(uint256)",
    "function g8(address user) public view returns(uint)",
    "function getpay(address user) public view returns (uint256)",
    "function buypup(uint _num) public returns(bool)",
    "function sellpup(uint num) public returns(bool)",
    "function allowcation() public returns(bool)"
  ]
};

let userProvider, signer, userAddress;

// ==========================
// 자동 지갑 연결 함수
// ==========================
async function autoConnectWallet() {
  if (!window.ethereum) {
    alert("Metamask 또는 Web3 지갑을 설치하세요.");
    return;
  }

  try {
    // opBNB 네트워크 추가/전환
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0xCC", // opBNB Mainnet
        rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
        chainName: "opBNB",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        blockExplorerUrls: ["https://opbnbscan.com"]
      }]
    });

    // 계정 자동 요청
    userProvider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await userProvider.send("eth_requestAccounts", []);
    signer = userProvider.getSigner();
    userAddress = await signer.getAddress();

    console.log("지갑 연결 완료:", userAddress);
  } catch (err) {
    console.error("지갑 자동 연결 실패:", err);
  }
}

// 페이지 로드 시 자동 연결
window.addEventListener("load", autoConnectWallet);

// ==========================
// 잔고 조회 함수
// ==========================
const topMut = async () => {
  const provider = new ethers.providers.JsonRpcProvider('https://opbnb-mainnet-rpc.bnbchain.org');
  const cyabankContract = new ethers.Contract(contractAddress.cyabankAddr, contractAbi.cyabank, provider);

  let cyabal = await cyabankContract.g1();
  let mutbal = await cyabankContract.g3();
  let mutcir = await cyabankContract.g11();
  let iprice = await cyabankContract.getprice();
  let iallow = await cyabankContract.allow();
  let iact = await cyabankContract.act();

  document.getElementById("Cyabal").innerHTML = (cyabal / 1e18).toFixed(4);
  document.getElementById("Mutbal").innerHTML = mutbal;
  document.getElementById("Mutcir").innerHTML = mutcir;
  document.getElementById("Mprice").innerHTML = (iprice / 1e18).toFixed(4);
  document.getElementById("Mallow").innerHTML = (iallow * 10 / 2000 / 1e18 * 52).toFixed(8);
  document.getElementById("Act").innerHTML = iact;
};
topMut();

// ==========================
// 내 잔고 로그인 상태 조회
// ==========================
let cutmemberLogin = async () => {
  if (!signer) await autoConnectWallet();

  const provider = new ethers.providers.JsonRpcProvider('https://opbnb-mainnet-rpc.bnbchain.org');
  const cyabankContract = new ethers.Contract(contractAddress.cyabankAddr, contractAbi.cyabank, signer);
  const cyabankContract2 = new ethers.Contract(contractAddress.cyabankAddr, contractAbi.cyabank, provider);

  let mycut = parseInt(await cyabankContract.g8(userAddress));
  let bankprice = parseInt(await cyabankContract2.getprice());
  let myallow = parseInt(await cyabankContract.getpay(userAddress));

  document.getElementById("myCut").innerHTML = mycut.toFixed(0);
  document.getElementById("myCutvalue").innerHTML = (mycut * (bankprice / 1e18)).toFixed(4);
  document.getElementById("myAllow").innerHTML = (myallow / 1e18).toFixed(4);

  let myt = parseInt(await cyabankContract2.allowt(userAddress));
  let time2 = 604800;
  let nowt = Math.floor(new Date().getTime() / 1000) + (4 * 60 * 60);
  let left = parseInt((myt + time2) - nowt);
  let day = parseInt(left / 60 / 60 / 24);
  let hour = parseInt(left / 3600) % 24;
  let min = parseInt((left / 60) % 60);
  let sec = left % 60;

  document.getElementById("epsLeftTime").innerHTML = left > 0 ? `${day}day${hour}hour${min}min${sec}sec` : '';
};

// ==========================
// 에러 핸들러
// ==========================
function handleError(e) {
  let rawMessage = e?.data?.message || e?.error?.message || e?.message || "";
  let cleanMessage = "알 수 없는 오류가 발생했습니다.";

  if (rawMessage.includes("execution reverted:")) {
    rawMessage = rawMessage.split("execution reverted:")[1];
  }
  const match = rawMessage.match(/"([^"]+)"/);
  if (match && match[1]) {
    cleanMessage = match[1];
  } else {
    cleanMessage = rawMessage.split("(")[0].trim();
  }

  alert(cleanMessage);
  console.error("전체 에러:", e);
}

// ==========================
// Allow 실행
// ==========================
let Allow = async () => {
  if (!signer) await autoConnectWallet();

  const cyabankContract = new ethers.Contract(
    contractAddress.cyabankAddr,
    contractAbi.cyabank,
    signer
  );

  try {
    await cyabankContract.allowcation();
  } catch (e) {
    handleError(e);
  }
};

// ==========================
// Buy & Sell
// ==========================
let Buymut = async () => {
  if (!signer) await autoConnectWallet();

  const cyabankContract = new ethers.Contract(
    contractAddress.cyabankAddr,
    contractAbi.cyabank,
    signer
  );

  try {
    await cyabankContract.buypup(document.getElementById('buyAmount').value);
  } catch (e) {
    handleError(e);
  }
};

let Sellmut = async () => {
  if (!signer) await autoConnectWallet();

  const cyabankContract = new ethers.Contract(
    contractAddress.cyabankAddr,
    contractAbi.cyabank,
    signer
  );

  try {
    await cyabankContract.sellpup(document.getElementById('sellAmount').value);
  } catch (e) {
    handleError(e);
  }
};
