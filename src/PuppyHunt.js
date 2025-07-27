// ========== 컨트랙트 주소 & ABI ==========
const CONTRACT_ADDRESS = "0x27c00bEa1D140851b63598824FF7E98C11618289"; // 실제 컨트랙트 주소로 교체!
const ABI = [
  "function myprey(address) view returns(uint[5] memory prey, uint8 sp, address owner)",
  "function getPreyArr(address) view returns(uint[5] memory)",
  "function getSp(address) view returns(uint8)",
  "function getMyPreyOwner(address) view returns(address)",
  "function getPreyAt(address,uint8) view returns(uint)",
  "function getmypuppy(address) view returns(uint8)",
  "function getjack(address) view returns(uint256)",
  "function jack() view returns(uint256)",
  "function getreward() view returns(uint256)",
  "function getprey1() view returns(uint256)",
  "function getprey2() view returns(uint256)",
  "function getprey3() view returns(uint256)",
  "function getprey4() view returns(uint256)",
  "function getprey5() view returns(uint256)",
  "function Hunting() external",
  "function sellprey() external",
  "function spWithdraw() external",
  "event Bonus(address indexed user, uint256 amount, uint256 reward)",
  "event RewardGiven(address indexed user, uint8 amount, uint8 kind)",
  "event getdepo(uint256 pay)",
  "event Sp(uint8 bear)"
];

// ========== 글로벌 변수 ==========
let providerRead, contractRead, signer, contractWrite, userAddress;

async function updateJackValue() {
  try {
    const value = await contractRead.jack();   // 인수 없이 호출
    document.getElementById("jackValue").textContent =  Number(value).toFixed(2)
  } catch (err) {  
    console.error("jack error:", err);
  }
}

// 페이지 로드 시 즉시 실행 + 2초마다 갱신
window.addEventListener("load", () => {
  updateJackValue();
  setInterval(updateJackValue, 2000);
});

// ========== 지갑 연결 ==========
async function connectWallet() { 
if (window. ethereum) { 
const provider = new ethers.providers.Web3Provider(window.ethereum); 
await provider.send("eth_requestAccounts", []); 
signer = provider.getSigner(); 
userAddress = await signer.getAddress(); 
providerRead = provider; 
contractWrite = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer); 
contractRead = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider); 
logEvent("✅ Wallet connection: " + userAddress); 
await refreshAll(); 
} else { 
alert("Please install MetaMask!"); 
}
}





// ========== 내 강아지/정보 렌더링 ==========
async function renderUser() {
  try {
    // 강아지 품종(번호) 및 이미지
    const myBreed = await contractRead.getmypuppy(userAddress);
    document.getElementById("myBreed").textContent = myBreed;
    document.getElementById("myPuppyImg").src = `/images/puppy/${myBreed}.png`;

 

    // 스페셜, 오너, 사냥감
    const preyArr = await contractRead.getPreyArr(userAddress);
    const sp = await contractRead.getSp(userAddress);
    const owner = await contractRead.getMyPreyOwner(userAddress);

    for (let i = 0; i < 5; i++) {
      document.getElementById(`prey${i}`).textContent = preyArr[i];
    }
    document.getElementById("mySp").textContent = sp;
    // document.getElementById("myOwner").textContent = owner; // 필요시 사용
  } catch (e) {
    for (let i = 0; i < 5; i++) {
      document.getElementById(`prey${i}`).textContent = "?";
    }
    document.getElementById("mySp").textContent = "?";
    logEvent("❌ Failed to retrieve my information");
  }
}

// ========== 사냥감별 시세 ==========
async function renderPreyPrices() {
  try {
    let prices = [];
    for (let i = 1; i <= 5; i++) {
      let p = await contractRead[`getprey${i}`]();
      // ethers.utils.formatEther(p) → 소수점 2자리로 변환
      prices.push( Number(p).toFixed(2));
    }
    document.getElementById("getprey1").textContent = prices[0];
    document.getElementById("getprey2").textContent = prices[1];
    document.getElementById("getprey3").textContent = prices[2];
    document.getElementById("getprey4").textContent = prices[3];
    document.getElementById("getprey5").textContent = prices[4];
  } catch (e) {
    for (let i = 1; i <= 5; i++) {
      document.getElementById(`getprey${i}`).textContent = "-";
    }
    logEvent("❌ Failed to check animal price");
  }
}


// ========== 잭팟(곰시세) ==========
async function renderJackpot() {
  try {
    if (!userAddress) await connectWallet();
    let jackpot = await contractRead.getjack(userAddress); // 잭팟은 유저레벨 기반
    document.getElementById("jackpot").textContent = Number(jackpot).toFixed(2);
  } catch (e) {
    document.getElementById("jackpot").textContent = "?";
    logEvent("❌ Bear price query failed");
  }
}

// ========== 내 사냥감 개수(최신 ABI 이용) ==========
async function renderMyPreyInfo() {
  try {
    const preyArr = await contractRead.getPreyArr(userAddress);
    const sp = await contractRead.getSp(userAddress);
    for (let i = 0; i < 5; i++) {
      document.getElementById(`prey${i}`).textContent = preyArr[i];
    }
    document.getElementById("mySp").textContent = sp;
  } catch (e) {
    for (let i = 0; i < 5; i++) {
      document.getElementById(`prey${i}`).textContent = "?";
    }
    document.getElementById("mySp").textContent = "?";
    logEvent("❌ Failed to check number of prey");
  }
}

// ========== Hunting execution ==========
async function hunting() {
if (!signer) await connectWallet();
try {
logEvent("⏳ Sending hunting transaction...");
const tx = await contractWrite.Hunting();
const receipt = await tx.wait();
logEvent("✅ Hunting success! (Tx: " + tx.hash + ")");
parseEvents(receipt);

// After hunting success, animation execution
playHuntAnimation();

await refreshAll();
} catch (e) {
logEvent("❌ Hunting failure: " + shortError(e));
}
}

// ========== 오버레이 애니메이션 실행 ==========
function playHuntAnimation() {
  const overlay = document.getElementById("huntOverlay");
  const frame = document.getElementById("huntFrame");
  const sound = document.getElementById("huntSound");

  // 사운드 재생
  sound.currentTime = 0;  // 처음부터 재생
  sound.play();

  // 오버레이 표시
  overlay.style.display = "flex";

  let current = 1;
  const maxFrames = 9;
  const interval = 200; 

  const anim = setInterval(() => {
    frame.src = `/images/puppy/hunt/${current}.png`;
    current++;
    if (current > maxFrames) {
      clearInterval(anim);
      // 애니메이션 끝나면 오버레이 숨기고 사운드 정지
      setTimeout(() => {
        overlay.style.display = "none";
        sound.pause();
        sound.currentTime = 0;
      }, 200);
    }
  }, interval);
}


// ========== Selling Prey ==========
async function sellPrey() {
if (!signer) await connectWallet();
try {
logEvent("⏳ Sending sale transaction...");
const tx = await contractWrite.sellprey();
const receipt = await tx.wait();
logEvent("✅ Sale Success! (Tx: " + tx.hash + ")");
parseEvents(receipt);
await refreshAll();
} catch (e) {
logEvent("❌ Sale Failed: " + shortError(e));
}
}
// ========== Special Reward Withdrawal ==========
async function spWithdraw() {
if (!signer) await connectWallet();
try {
logEvent("⏳ Sending special transaction...");
const tx = await contractWrite.spWithdraw();
const receipt = await tx.wait();
logEvent("✅ Special withdrawal success! (Tx: " + tx.hash + ")");
parseEvents(receipt);
await refreshAll();
} catch (e) {
logEvent("❌ Special withdrawal failure: " + shortError(e));
}
}

// ========== Event Parsing ==========
function parseEvents(receipt) {
  const iface = new ethers.utils.Interface(ABI);
  const preyNames = ["rabbit", "raccoon", "deer", "fox", "boar"];

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);

      if (parsed.name === "RewardGiven") {
        const [user, amount, kind] = parsed.args;
        const preyName = preyNames[kind] || `${kind}`;
        logEvent(`🎯 Hunting Result: ${amount} (${preyName})`); // 정수 그대로 출력
      }

      if (parsed.name === "Bonus") {
        const [user, amount, reward] = parsed.args;
        logEvent(`🎁 Bonus: ${amount} GP (ability ${reward})`); // formatEther 제거
      }

      if (parsed.name === "getdepo") {
        logEvent(`💰 Reward GP paid!`);
      }

      if (parsed.name === "Sp") {
        const [bear] = parsed.args;
        logEvent(`🐻 ${bear} bears!`);
      }

    } catch {}
  }
}



// ========== 로그 출력 ==========
function logEvent(msg) {
  const logDiv = document.getElementById("log");
  logDiv.innerHTML = `<div>${new Date().toLocaleTimeString()} ${msg}</div>` + logDiv.innerHTML;
}

// ========== Short Error Message ==========
function shortError(e) {
if (!e || !e.message) return "Unknown";
if (e.message.includes("Requires 10 or more")) return "Not enough game items";
if (e.message.includes("Special items are lacking")) return "Not enough special items";
if (e.message.includes("No Puppy")) return "No puppy";
if (e.message.includes("Not enough game points")) return "Not enough GP";
return e.message.split('\n')[0];
}

// ========== 정보 동기화 ==========
async function refreshAll() {
  if (!userAddress) return;
  await renderUser();
  await renderJackpot();
  await renderMyPreyInfo();
  await renderPreyPrices();
}

// ========== 자동 연결 및 데이터 동기화 ==========
window.onload = async () => {
  providerRead = new ethers.providers.JsonRpcProvider("https://opbnb-mainnet-rpc.bnbchain.org");
  contractRead = new ethers.Contract(CONTRACT_ADDRESS, ABI, providerRead);
  if (window.ethereum && window.ethereum.selectedAddress) {
    await connectWallet();
  } else {
    await refreshAll();
  }
};

