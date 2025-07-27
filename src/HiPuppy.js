/* ---------- 주소 & ABI ---------- */
let pupaddr = {
  hipuppy: "0x188A8747a2D477206885D9f8f4FB00e95941a661"//HiPuppy
};

let pupabi = {
 hipuppy: [
  "function playSlot(uint _pay) external",
  "function rate()view returns(uint8)",
  "event lost(uint amount)",
  "event Bonus(address indexed user,uint amount,uint256 reward)",
  "event RewardGiven(address indexed user, uint amount, uint reward)",
  "event DebugBreed(uint8 myPuppy, uint8 matchCount, uint8[9] slotValues)"
]

};

async function updateRateInfo() {
  try {
    // contractRead는 이미 선언된 읽기 전용 컨트랙트 객체입니다.
    const rate = await contractRead.rate();
    // 보통 uint8이므로 숫자로 바로 쓸 수 있습니다.
    document.getElementById('rateValue').textContent = (rate/100);
  } catch (e) {
    document.getElementById('rateValue').textContent = '..';
  }
}

// 페이지 로드 시 자동 표시
window.onload = async () => {
  await updateRateInfo();
  // 필요하다면 connectWallet(); 등도 여기서!
};


  // ---------- 읽기 전용 provider/contract ----------
  const providerRead  = new ethers.providers.JsonRpcProvider(
    "https://opbnb-mainnet-rpc.bnbchain.org"
  );
  const contractRead  = new ethers.Contract(pupaddr.hipuppy, pupabi.hipuppy, providerRead);

  // ---------- 글로벌 변수 ----------
  let contractWrite;
  let signer;

  // ---------- 지갑 연결 ----------
  async function connectWallet() {
    if (window.ethereum) {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      signer = provider.getSigner();
      contractWrite = new ethers.Contract(pupaddr.hipuppy, pupabi.hipuppy, signer);
      console.log("✅ Wallet connected:", await signer.getAddress());
    } else {
      alert("Metamask를 설치해주세요!");
    }
  }

 // ---------- playSlot 실행 함수 ----------
 async function playSlot() {
  if (!contractWrite) await connectWallet();

  const pay = document.getElementById("betAmount").value;
  if (pay <= 0) return alert("1 이상의 GP를 입력하세요.");

  try {
    // 트랜잭션 제출(블록체인에 올라감)
    const tx = await contractWrite.playSlot(pay);
   document.getElementById("log").innerHTML += `<p>⏳ Sending transaction... TX: ${tx.hash}</p>`;

    // === [A] 트랜잭션 영수증(wait) 도착 전까지 UI는 그대로 ===

    const receipt = await tx.wait(); // 결과 확정(이벤트 발생)

document.getElementById("log").innerHTML += `<p>✅ Transaction Completed: ${tx.hash}</p>`;

    // === [B] 애니메이션 & 사운드는 여기서 실행! ===
    try {
      document.getElementById("dogRunContainer").style.display = "flex";
      const dogRunDiv = document.getElementById("dogRunContainer").querySelector('div');
    dogRunDiv.innerHTML = `
  <img src="/images/puppy/0.png" class="dog-runner absolute left-[-100px] w-24 h-24" style="animation-delay: 0s;">
  <img src="/images/puppy/1.png" class="dog-runner absolute left-[-120px] w-24 h-24" style="animation-delay: 0.15s;">
  <img src="/images/puppy/2.png" class="dog-runner absolute left-[-140px] w-24 h-24" style="animation-delay: 0.3s;">
  <img src="/images/puppy/3.png" class="dog-runner absolute left-[-160px] w-24 h-24" style="animation-delay: 0.45s;">
  <img src="/images/puppy/4.png" class="dog-runner absolute left-[-180px] w-24 h-24" style="animation-delay: 0.6s;">
  <img src="/images/puppy/5.png" class="dog-runner absolute left-[-200px] w-24 h-24" style="animation-delay: 0.75s;">
`;
      document.getElementById("barkSound").currentTime = 0;
      document.getElementById("barkSound").play();
    } catch (e) {}

    // [C] 1.3초 후 강아지 애니메이션 숨기고 실제 결과 화면 반영
    setTimeout(() => {
      document.getElementById("dogRunContainer").style.display = "none";

      // === 이벤트 로그 파싱 및 결과 표시 ===
      const iface = new ethers.utils.Interface(pupabi.hipuppy);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          const name = parsed.name;
          const args = parsed.args;

        if (name === "RewardGiven") {
  const [user, amount, matchCount] = args;
  document.getElementById("matchCount").textContent = matchCount.toString();
  document.getElementById("rewardAmount").textContent = amount.toString(); // 정수 그대로 사용
  document.getElementById("log").innerHTML += `<p>🎉 Reward Earned: ${amount.toString()} GP, ${matchCount} matches</p>`;
}

if (name === "Bonus") { 
  const [user, amount, reward] = args; 
  document.getElementById("bonusAmount").textContent = `${amount.toString()} GP (stat ${reward})`; 
  document.getElementById("log").innerHTML += `<p>🎁 Obtain bonus: ${amount.toString()} GP (stat ${reward})</p>`;
}

if (name === "lost") { 
  const [amount] = args; 
  document.getElementById("log").innerHTML += `<p>😢 Failed: ${amount.toString()} GP loss</p>`; 
}

if (name === "DebugBreed") {
const [myPuppy, matchCount, slots] = args;
// Show my puppy image
let imgPath = `/images/puppy/${myPuppy}.png`;
document.getElementById("myBreedImg").src = imgPath;

document.getElementById("matchCount").textContent = matchCount;
// Slot result image
const slotDivs = document.querySelectorAll("#slotResult div");
for (let i = 0; i < 9; i++) {
let puppyIdx = parseInt(slots[i]);
let imgPath = `/images/puppy/${puppyIdx}.png`;
slotDivs[i].innerHTML = `<img class="slot-img w-12 h-12 object-contain mx-auto" src="${imgPath}" alt="puppy" />`; 
} 
document.getElementById("log").innerHTML += `<p>🎰 slots result: ${slots.join(", ")}</p>`; 
} 
} catch (e) {} 
} 
}, 1300);

  } catch (err) {
    console.error(err);
    document.getElementById("log").innerHTML += `<p class="text-red-500">❌ error: ${err.message}</p>`;
  }
}



  // ---------- (선택) 자동 연결/동기화 ----------
  window.onload = async () => {
    await connectWallet(); // 필요시 자동연결
    await updateRateInfo();
    // (추가: 잔액/레이트 등 동기화)
  };