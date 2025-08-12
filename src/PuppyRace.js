// PuppyRace 컨트랙트 주소 & ABI(필요한 함수만 포함)
const PUPPYRACE_ADDR = "0xC8f946174a5DE63B31d19F36A5180aCbCD401B50"; //PuppyRace
const ABI = [
  "function getbt() view returns(uint8)",
  "function myPuppy(address) view returns(uint8)",
  "function getmypuppy(address) view returns(uint8)",
  "function getreward() view returns(uint256)",
  "function jack() view returns(uint256)",
  "function Race(uint _ticket) external",
  "function winner(uint) view returns(address)",
  "event lost(uint256 amount, uint256 myPower)",
  "event Bonus(address indexed user, uint256 amount, uint256 reward)",
  "event RewardGiven(address indexed user, uint256 amount, uint256 myPower)"
];

let providerRead = new ethers.providers.JsonRpcProvider("https://opbnb-mainnet-rpc.bnbchain.org");
let contractRead = new ethers.Contract(PUPPYRACE_ADDR, ABI, providerRead);

let signer, contractWrite;

async function connectWallet() { 
if (!window.ethereum) return alert("Please install the wallet."); 
const provider = new ethers.providers.Web3Provider(window.ethereum); 
await provider.send("eth_requestAccounts", []); 
signer = provider.getSigner(); 
contractWrite = new ethers.Contract(PUPPYRACE_ADDR, ABI, signer); 
logEvent("✅ Wallet connection: " + await signer.getAddress()); 
await renderMyPuppy();
}

function logEvent(msg) {
  const div = document.getElementById("log");
  div.innerHTML = `<div>${new Date().toLocaleTimeString()} ${msg}</div>` + div.innerHTML;
}

// 잭팟 및 내 정보 렌더링
async function renderStatus() {
  // 잭팟
  try {
    let jackpot = await contractRead.getreward();
    document.getElementById("jackpotValue").textContent = Number(jackpot).toFixed(2);
      document.getElementById("jackpotValue2").textContent = Number(jackpot/2).toFixed(2);
        document.getElementById("jackpotValue3").textContent = Number(jackpot/3).toFixed(2);
          document.getElementById("jackpotValue4").textContent = Number(jackpot/4).toFixed(2);
            document.getElementById("jackpotValue5").textContent = Number(jackpot/5).toFixed(2);
              document.getElementById("jackpotValue6").textContent = Number(jackpot/6).toFixed(2);
                document.getElementById("jackpotValue7").textContent = Number(jackpot/7).toFixed(2);
                  document.getElementById("jackpotValue8").textContent = Number(jackpot/8).toFixed(2);

  } catch (e) {
    document.getElementById("jackpotValue").textContent = "-";
  }
}



// 내 강아지 정보
async function renderMyPuppy() {
  try {
    let addr = signer ? await signer.getAddress() : null;
    if (!addr) {
      document.getElementById("myBreed").textContent = "?";
      document.getElementById("myPuppyImg").src = "/images/puppy/0.png";
      return;
    }
    let myBreed = await contractRead.getmypuppy(addr);
    document.getElementById("myBreed").textContent = myBreed;
    document.getElementById("myPuppyImg").src = `/images/puppy/${myBreed}.png`;
  } catch (e) {
    document.getElementById("myBreed").textContent = "?";
    document.getElementById("myPuppyImg").src = "/images/puppy/0.png";
  }
}

// Display recent winners (maximum 5)
async function renderWinnerList() {
let html = "";
try {
// Print only the most recent 5 (the size of the winner[] array is unknown from the outside, loop up to 10 with try~catch)
for (let i = 0; i < 5; i++) {
try {
let addr = await contractRead.winner(i);
html += `<div>${addr.substring(0, 8)}...${addr.slice(-4)}</div>`;
} catch (e) { break; }
}
if (!html) html = "<span class='text-gray-400'>Not yet</span>";
} catch (e) {
html = "<span class='text-red-400'>Loading failed</span>"; } 
document.getElementById("winnerList").innerHTML = html;
}

// ===== Run the race =====
async function race() {
if (! contractWrite) await connectWallet();

let ticket = Number(document. getElementById("betAmount"). value);
if (! ticket || ticket <= 0) return alert("Enter the ticket (number).");

document. getElementById("raceRank"). textContent = "-";
document. getElementById("rewardAmount"). textContent = "0";
document. getElementById("bonusAmount"). textContent = "0";
document. getElementById("log"). innerHTML = "";

try {
document. getElementById("log"). innerHTML = `<div>⏳ Sending transaction...</div>`;
let tx = await contractWrite.Race(ticket); 
logEvent("Transaction: " + tx.hash); 

const receipt = await tx.wait(); 
logEvent("✅ Completed: " + tx.hash); 

let iface = new ethers.utils.Interface(ABI); 
let found = false; 
await showDogFrameAnimationBig(); 
for (const log of receipt.logs) { 
try { 
const parsed = iface.parseLog(log); 
const { name, args } = parsed; 
if (name === "RewardGiven") { 
found = true; 
document.getElementById("raceRank").textContent = args.myPower; 
document.getElementById("rewardAmount").textContent = Number(ethers.utils.formatEther(args.amount)).toFixed(2); 
logEvent(`🎉 Reward: ${ethers.utils.formatEther(args.amount)} GP (rank ${args.myPower})`); 
} 
if (name === "Bonus") { 
document.getElementById("bonusAmount").textContent = Number(ethers.utils.formatEther(args.amount)).toFixed(2); 
logEvent(`🎁 Bonus: ${ethers.utils.formatEther(args.amount)} GP (stat ${args.reward})`); 
} 
if (name === "lost") { 
found = true; 
document.getElementById("raceRank").textContent = args.myPower;
logEvent(`😢 Defeat! GP disappears (rank ${args.myPower})`);
}
} catch (e) { }
}
if (!found) logEvent("No result (Event not detected)");
await renderStatus();
await renderWinnerList();
await renderMyPuppy();
} catch (err) {
let msg = err.message;
if (msg.includes("No Puppy")) msg = "No Puppy!";
if (msg.includes("Not enough game points")) msg = "GP not enough!";
if (msg.includes("The amount is too large")) msg = "Jackpot not enough!";
logEvent("❌ " + msg);
}
}


const dogFrames = [
  "/images/puppy/race/0.png",
  "/images/puppy/race/1.png",
  "/images/puppy/race/2.png",
  "/images/puppy/race/3.png",
  "/images/puppy/race/4.png"
];

// race()에서 호출: 애니메이션 오버레이
async function showDogFrameAnimationBig() {
  const overlay = document.getElementById("raceAnimOverlay");
  const img = document.getElementById("animDogBig");
  let frame = 0;
  overlay.style.display = "flex";
  img.src = dogFrames[0];

  // === 사운드 재생(한 번만) ===
  try {
    document.getElementById("whistleSound").currentTime = 0;
    document.getElementById("whistleSound").play();
    setTimeout(() => {
      document.getElementById("barkSound").currentTime = 0;
      document.getElementById("barkSound").play();
    }, 350); // 0.35초 후 강아지 소리
  } catch (e) { /* 모바일 정책: 첫 터치 필요 */ }

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      frame++;
      img.src = dogFrames[frame % dogFrames.length];
      if (frame >= dogFrames.length - 1) {
        clearInterval(interval);
        setTimeout(() => {
          overlay.style.display = "none";
          resolve();
        }, 300);
      }
    }, 180);
  });
}


// ----------- 최초 로딩 시 ----------
window.onload = async () => {
  await renderStatus();
  await renderMyPuppy();
  await renderWinnerList();
};

