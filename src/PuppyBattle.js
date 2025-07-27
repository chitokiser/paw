/* ---------- 주소 & ABI ---------- */
const BATTLE_CONTRACT_ADDR = "0x455516a6d57A17615cD829eC13C3d01854591CAA";
const BATTLE_ABI = [
  "function bpid() view returns(uint8)",
  "function jack() view returns(uint256)",
  "function bps(uint8) view returns(uint8 mybreed, uint256 depo, uint256 power, address owner, uint8 defense)",
  "function getmypuppy(address) view returns(uint16)",
  "function getmypower(uint256 pid) view returns(uint256)",
  "function Battle(uint8 _pid) external",
  "function getreward() view returns(uint256)",
  "function allowcation(uint8 _pid) public returns (bool)",
  "event lost(uint256 amount, uint256 myPower)",
  "event Bonus(address indexed user, uint256 amount, uint256 reward)",
  "event RewardGiven(address indexed user, uint256 amount, uint256 myPower)",
  "event getdepo(uint256 pay)"
];
async function renderJackpot() {
  try {
    const jackpot = await battleContractRead.jack();
    
    document.getElementById('jackpotValue').textContent = parseFloat(jackpot/100).toFixed(2);
  } catch (e) {
    document.getElementById('jackpotValue').textContent = "알수없음";
}
}
/* ---------- provider & contract ---------- */
const providerRead = new ethers.providers.JsonRpcProvider("https://opbnb-mainnet-rpc.bnbchain.org");
const battleContractRead = new ethers.Contract(BATTLE_CONTRACT_ADDR, BATTLE_ABI, providerRead);

let signer, battleContractWrite;
let selectedSlot = 0;

/* ---------- 지갑 연결 ---------- */
async function connectWallet() {
  if (window.ethereum) {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    battleContractWrite = new ethers.Contract(BATTLE_CONTRACT_ADDR, BATTLE_ABI, signer);
    console.log("Wallet connected:", await signer.getAddress());
    return signer.getAddress();
  } else {
    alert("지갑을 설치해주세요!");
  }
}

/* ---------- 챔피언 리스트 렌더 ---------- */
async function renderChampionList() {
  const championListDiv = document.getElementById("championList");
  championListDiv.innerHTML = "불러오는 중...";

  try {
    const bpid = await battleContractRead.bpid();
    let html = "";
    for (let i = 0; i < bpid; i++) {
      const bp = await battleContractRead.bps(i);
      const mybreed = bp.mybreed;
      const depo = bp.depo;
      const power = bp.power;
      const owner = bp.owner;
      const defense = bp.defense;

      html += `
      <div class="card-body text-center bg-blue-50 rounded shadow p-2 m-1">
        <div class="font-bold text-blue-600">#${i + 1}</div>
        <img src="/images/puppy/${mybreed}.png" class="w-24 h-24 mx-auto rounded" alt="강아지"/>
        <div class="text-xs mt-1">품종: <span class="font-bold">${mybreed}</span></div>
        <div class="text-xs">파워: <span class="font-bold">${power}</span></div>
        <div class="text-xs">방어성공: <span class="font-bold">${defense}</span></div>
        <div class="text-[10px] truncate text-gray-400">오너: ${owner.substring(0, 6)}...${owner.substring(owner.length-4)}</div>
        <button class="mt-1 text-xs px-2 py-1 bg-green-600 text-white rounded allow-btn" data-slot="${i}">
  방어상금인출
</button>
      </div>
      `;
    }
    championListDiv.innerHTML = html;

    // 각 도전 버튼에 이벤트 연결 (해당 슬롯으로 도전)
    document.querySelectorAll(".battle-btn").forEach(btn => {
      btn.onclick = () => battle(parseInt(btn.dataset.slot));
    });

  } catch (e) {
    championListDiv.innerHTML = "<span class='text-red-500'>불러오기 실패</span>";
  }
}

/* ---------- 내 강아지 정보/파워 렌더 ---------- */
async function renderMyPuppy() {
  try {
    let account = signer ? await signer.getAddress() : null;
    if (!account) return;

    const myBreed = await battleContractRead.getmypuppy(account);
    document.getElementById("myBreed").textContent = myBreed;
    document.getElementById("myPuppyImg").src = `/images/puppy/${myBreed}.png`;

 
  } catch (e) {
    document.getElementById("myBreed").textContent = "?";
 
  }
}


async function randomBattle() {
      
  // bpid 읽어서 1~bpid 중 랜덤값 선택(슬롯은 0~bpid-1이므로)
  const bpid = await battleContractRead.bpid();
  if (bpid == 0) {
    alert("챔피언 슬롯이 없습니다.");
    return;
  }
  // 랜덤으로 0~(bpid-1) 중 하나 선택
  const slot = Math.floor(Math.random() * bpid);
  logEvent(`랜덤 슬롯 #${slot+1}에 도전합니다!`);
  battle(slot);
}

async function battle(slot) {
  if (!battleContractWrite) await connectWallet();
  try {
    document.getElementById("battleResult").textContent = "대결 진행 중...";
    const tx = await battleContractWrite.Battle(slot);
    logEvent(`⏳ 배틀 트랜잭션 전송: ${tx.hash}`);
    await showDogFrameAnimation();
    const receipt = await tx.wait();
    logEvent(`✅ 배틀 완료: ${tx.hash}`);

    const iface = new ethers.utils.Interface(BATTLE_ABI);
    let foundResult = false;

    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        const name = parsed.name;
        const args = parsed.args;

     if (name === "RewardGiven") {
  foundResult = true;
  document.getElementById("battleResult").innerHTML =
    `<span class='text-blue-600 font-bold'>🎉 승리! GP 보상: ${args.amount}</span>`;
  logEvent(`🎉 Reward: ${args.amount} GP, 내 파워: ${args.myPower}`);
}
if (name === "Bonus") {
  logEvent(`🎁 Bonus: ${args.amount} GP (능력치 ${args.reward})`);
}
if (name === "lost") {
  foundResult = true;
  document.getElementById("battleResult").innerHTML =
    `<span class='text-red-500 font-bold'>😢 패배! GP 소멸. 내 파워: ${args.myPower}</span>`;
  logEvent(`😢 Lost: ${args.amount} GP, 내 파워: ${args.myPower}`);
}
      } catch (e) {
        // 이벤트 파싱 오류는 무시 (ex. 내 이벤트 아닌 로그)
      }
    }
    if (!foundResult)
      document.getElementById("battleResult").textContent = "결과 없음(이벤트 미검출)";

    await renderChampionList();
    await renderMyPuppy();
  } catch (err) {
    let shortMsg = "❌ 배틀 실패";
    if (err && err.message && err.message.includes("You can't challenge yourself")) {
      shortMsg = "❌ 내 강아지 슬롯엔 도전 불가!";
    }
    document.getElementById("battleResult").innerHTML = `<span class="text-red-500">${shortMsg}</span>`;
    logEvent(shortMsg);
  }
}


// allowcation 실행 함수
async function claimReward(slot) {
  if (!battleContractWrite) await connectWallet();
  try {
    logEvent(`⏳ 인출 트랜잭션 전송...`);
    const tx = await battleContractWrite.allowcation(slot);
    logEvent(`✅ 인출 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    logEvent(`✅ 인출 완료!`);

    // 이벤트 파싱(옵션)
    // ... (이벤트 로그 파싱도 추가 가능)
    await renderChampionList();
    await renderMyPuppy();
  } catch (err) {
    logEvent(`❌ 인출실패: ${err.message}`);
    alert("상금 인출 실패: " + err.message);
  }
}


async function showDogFrameAnimation() {
  const aniDiv = document.getElementById("dogAnimationLayer");
  const aniImg = document.getElementById("dogAniFrame");
  aniDiv.style.display = "flex";
  // 효과음 재생
  try {
    const sound = document.getElementById("battleSound");
    sound.currentTime = 0;
    sound.play();
  } catch (e) {
    // 브라우저 자동재생 제한 등 무시
  }

  const frames = [0, 1, 2, 3, 4]; // 프레임 번호
  let idx = 0;

  // 프레임을 200ms 간격으로 순차 교체
  const interval = setInterval(() => {
    aniImg.src = `/images/puppy/battle/${frames[idx]}.png`;
    idx++;
    if (idx >= frames.length) {
      clearInterval(interval);
      // 0.3초 후 애니메이션 레이어 숨김
      setTimeout(() => {
        aniDiv.style.display = "none";
      }, 1000);
    }
  }, 200); // 200ms 간격 (조절 가능)
}


/* ---------- 로그 기록 ---------- */
function logEvent(msg) {
  const logDiv = document.getElementById("log");
  logDiv.innerHTML = `<div>${new Date().toLocaleTimeString()} ${msg}</div>` + logDiv.innerHTML;
}

/* ---------- 초기화 ---------- */
window.onload = async () => {
  await connectWallet();
  await renderChampionList();
  await renderMyPuppy();
   await renderJackpot();
};
