const { ethers } = window;

const contractAddress = {
  pupbank: "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D", // PUPBank
  puptoken: "0x147ce247Ec2B134713fB6De28e8Bf4cAA5B4300C", // PUP
  pawtoken: "0xCC1ce312b7A7C4A78ffBf51F8fc0e087C1D4c72f",  // PAW
  gp: "0x35f7cfD9D3aE6Fdf1c080C3dd725EC68EB017caE"  // GamePoint
};

const pupbankAbi = [
  "function g1() view returns(uint256)",
  "function g3() view returns(uint)",
  "function g6() view returns(uint256)",
  "function g8(address) view returns(uint)",
  "function g9(address) view returns(uint)",
  "function g10() view returns(uint256)",
  "function g11() view returns(uint256)",
  "function allow() view returns(uint256)",
  "function allowt(address) view returns(uint256)",
  "function getprice() view returns(uint256)",
  "function gettime() view returns(uint256)",
  "function withdraw()",
  "function buypup(uint) returns(bool)",
  "function sellpup(uint) returns(bool)",
  "function getpay(address) view returns(uint256)",
  "function allowcation() returns(bool)",
  "function getlevel(address) view returns(uint)",
  "function getmento(address) view returns(address)",
  "function memberjoin(address)",
  "function myinfo(address) view returns(uint256,uint256,uint256,address,uint256)",
  "function levelup()",
  "function buffing()",
  "function getmymenty(address) view returns(address[])"
];

const pawAbi = [
  "function balanceOf(address) view returns (uint256)"
];

const pupAbi = [
  "function balanceOf(address) view returns (uint256)"
];
const gpAbi = [
  " function charge (uint _pay)public"
];

let provider;
let signer;
let pupbankContract;
let pawTokenContract;
let pupTokenContract;
let gpContract; // ★ GP 컨트랙트 추가
// 초기화
const initialize = async () => {
  if (signer) return;

  if (!window.ethereum) {
    alert("Wallet is not installed.");
    return;
  }

  provider = new ethers.providers.Web3Provider(window.ethereum, "any");

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
  } catch (e) {
    console.warn("네트워크 전환 실패:", e.message);
  }

  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();

  // 계약 인스턴스 초기화
  pupbankContract = new ethers.Contract(contractAddress.pupbank, pupbankAbi, signer);
  pawTokenContract = new ethers.Contract(contractAddress.pawtoken, pawAbi, signer);
  pupTokenContract = new ethers.Contract(contractAddress.puptoken, pupAbi, signer);
  gpContract = new ethers.Contract(contractAddress.gp, gpAbi, signer); // ★ GP 컨트랙트 추가
};

// 회원 로그인
const MemberLogin = async () => {
  await initialize();
  const userAddress = await signer.getAddress();

  // PUPBank myinfo 호출
  const [totaldepo, mybonus, mylev, mymento, myexp] = await pupbankContract.myinfo(userAddress);
  const levelexp = (2 ** mylev) * 10000;

  // 보유 PUP 수량
  const pupBalance = await pupTokenContract.balanceOf(userAddress);

  // 보유 PAW 수량
  const pawBalance = await pawTokenContract.balanceOf(userAddress);

  // DOM 업데이트
  document.getElementById("Mypaw").innerText = (pawBalance / 1e18).toFixed(2);
  document.getElementById("Mypup").innerText = (pupBalance);
  document.getElementById("Mymento").innerText = mymento;
  document.getElementById("Mylev").innerText = mylev;
  document.getElementById("Mylev2").innerText = mylev;
  document.getElementById("Exp").innerText = myexp;
  document.getElementById("Expneeded").innerText = levelexp;
  document.getElementById("Mypoint").innerText = (mybonus);
  document.getElementById("LevelBar").style.width = `${(myexp / levelexp) * 100}%`;
};

// 레벨업
const Levelup = async () => {
  try {
    await initialize();
    const tx = await pupbankContract.levelup();
    await tx.wait();
    alert("Levelup success!");
    location.reload();
  } catch (e) {
    alert("Levelup failure: " + extractRevertReason(e));
  }
};

// 보너스 출금
const Bonuswithdraw = async () => {
  try {
    await initialize();
    await pupbankContract.withdraw();
    alert("Bonus withdrawal completed");
    location.reload();
  } catch (e) {
    alert(extractRevertReason(e));
  }
};

// 버프
const Buff = async () => {
  try {
    await initialize();
    await pupbankContract.buffing();
    alert("Buff success!");
  } catch (e) {
    alert(extractRevertReason(e));
  }
};

// 멘티 주소 불러오기
const fetchAddresses = async () => {
  try {
    await initialize();
    const userAddress = await signer.getAddress();
    const addresses = await pupbankContract.getmymenty(userAddress);
    const addressList = document.getElementById("addressList");
    addressList.innerHTML = "";

    if (addresses.length === 0) {
      const li = document.createElement("li");
      li.textContent = "There are no menty.";
      addressList.appendChild(li);
    } else {
      addresses.forEach(addr => {
        const li = document.createElement("li");
        li.textContent = addr;
        addressList.appendChild(li);
      });
    }
  } catch (e) {
    alert(extractRevertReason(e));
  }
};

// PUP 구매
const BuyPup = async () => {
  try {
    await initialize();
    const amount = parseInt(document.getElementById("buyAmount").value);
    await pupbankContract.buypup(amount);
    alert("PUP 구매 성공!");
    location.reload();
  } catch (e) {
    alert(extractRevertReason(e));
  }
};

// PUP 판매
const SellPup = async () => {
  try {
    await initialize();
    const amount = parseInt(document.getElementById("sellAmount").value);
    await pupbankContract.sellpup(amount);
    alert("PUP 판매 성공!");
    location.reload();
  } catch (e) {
    alert(extractRevertReason(e));
  }
};

// 에러 메시지 추출
function extractRevertReason(error) {
  if (error?.error?.data?.message) {
    return error.error.data.message.replace("execution reverted: ", "");
  }
  if (error?.data?.message) {
    return error.data.message.replace("execution reverted: ", "");
  }
  if (error?.message?.includes("execution reverted:")) {
    return error.message.split("execution reverted:")[1].trim();
  }
  return "An unknown error occurred.";
}

// 초기 실행
window.addEventListener("load", async () => {
  await initialize();
  await MemberLogin();
});

// 버튼 이벤트
document.getElementById("fetchAddresses")?.addEventListener("click", fetchAddresses);
document.getElementById("levelUp")?.addEventListener("click", Levelup);
document.getElementById("withdraw")?.addEventListener("click", Bonuswithdraw);
document.getElementById("buff")?.addEventListener("click", Buff);
document.getElementById("buyPupBtn")?.addEventListener("click", BuyPup);
document.getElementById("sellPupBtn")?.addEventListener("click", SellPup);
// ================================
// GP 충전 함수
// ================================
async function chargeGP(amount) {
  try {
    await initialize();

    const tx = await gpContract.charge(amount); // GP 컨트랙트에서 호출
    console.log("Transaction hash:", tx.hash);

    await tx.wait();
    alert(`Successfully charged ${amount*1000} GP!`);
      // 충전 성공 후 페이지 새로고침
    location.reload();
  } catch (e) {
    console.error("Charge error:", e);
    alert(`Error: ${e.message}`);
  }
}

// ================================
// 버튼 이벤트
// ================================
document.getElementById("chargeButton").addEventListener("click", () => {
  const amount = parseInt(document.getElementById("Amount").value);
  if (isNaN(amount) || amount <= 0) {
    alert("Enter a valid amount");
    return;
  }
  chargeGP(amount);
});

// 전역 에러 처리
window.onerror = function (message, source, lineno, colno, error) {
  console.error("Global error:", message, error);
};
