/* ---------- 주소 & ABI ---------- */
let pupaddr = {
  puppy: "0x4ceDeF50FB76113be3c65e59e5da11E85e53e22d"//WithPuppy
};

let pupabi = {
 puppy: [
  // --- Read Functions ---
  "function pid() view returns (uint256)",
  "function myPuppy(address) view returns (uint256)",
  "function myPuppyid(address) view returns (uint256)",
  "function g1() view returns (uint256)",
  "function puppys(uint256) view returns (uint8 breed, string name,uint256 battleExp, address owner)",
  "function myinfo(uint256) view returns (uint16 intell, uint16 courage, uint16 strength, uint16 agility, uint16 endurance, uint16 flexibility)",

  // --- Write Functions ---
  "function buyPuppy(string _name)",

  // --- My Puppy Actions ---
  "function sellpuppy(uint256 _pid, uint256 _price) external",
  "function forsale(uint256 _pid) external",
  "function rename(uint256 _pid, string calldata _newName) external",
  "function boostIntell(uint256 _pid) external",
  "function boostCourage(uint256 _pid) external",
  "function boostStrength(uint256 _pid) external",
  "function boostAgility(uint256 _pid) external",
  "function boostEndurance(uint256 _pid) external",
  "function boostFlexibility(uint256 _pid) external"
]

};



/* ---------- ① 읽기 전용 provider/contract (✨ 새로 추가) ---------- */
const providerRead  = new ethers.providers.JsonRpcProvider(
  "https://opbnb-mainnet-rpc.bnbchain.org"
);
const contractRead  = new ethers.Contract(pupaddr.puppy, pupabi.puppy, providerRead);

/* ---------- ② topSync ---------- */
let topSync = async () => {
  const total  = await contractRead.pid();
  const izum  = await contractRead.g1();
  document.getElementById("totalPid").textContent = total.toString();
  document.getElementById("Zumbal").textContent = izum;
};


/* ---------- 3) buyPuppy(string) 실행 ---------- */
async function mintPuppy() {
  /* MetaMask 네트워크 스위치(필요 시) */
  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: "0xCC",                                 // opBNB(204)
      rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
      chainName: "opBNB",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      blockExplorerUrls: ["https://opbnbscan.com"]
    }]
  });

  const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  const signer = provider.getSigner();
  const puppy = new ethers.Contract(pupaddr.puppy, pupabi.puppy, signer);

  const name = document.getElementById("puppyName").value.trim();
  if (!name) return alert("Please enter your dog's name");

  try {
    document.getElementById("status").textContent = "⏳ Transaction pending…";
    const tx = await puppy.buyPuppy(name);
    document.getElementById("status").textContent =
      document.getElementById("status").textContent =
    `⛓ Waiting for confirmation (${tx.hash.slice(0, 10)}…)`;

    await tx.wait();
    document.getElementById("status").textContent = "✅ Puppy creation complete!";
    document.getElementById("puppyName").value = "";
    window.location.reload();
  } catch (e) {
    handleError(e);
  }
}
/* ---------- ④ renderList (contractRead 이제 정의됨) ---------- */
async function renderList() {
  try {
    const total = (await contractRead.pid()).toNumber();
    const grid  = document.getElementById("list");
    grid.innerHTML = total ? "" : "<em>No puppies yet</em>";

    for (let id = 0; id < total; id++) {
      const pup   = await contractRead.puppys(id);
      const stats = await contractRead.myinfo(id);

      const [breed, name, battleBN, owner] = pup;
      const battle = Number(battleBN.toString());
     
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
      
        <h4>#${id} ${name}</h4>
       <div class="img-container"><img src="/images/puppy/${breed}.png" alt="breed ${breed}" class="puppy-img"></div>
             <div class="stats">
          Breed : ${breed}<br>
          Owner : ${owner.slice(0,6)}…${owner.slice(-4)}<br>
          Battle : ${battle}<br>
         <div class="stat-bars">
      ${renderStatBar("INT", stats.intell, "#FF6F61")}
      ${renderStatBar("COU", stats.courage, "#6B5B95")}
      ${renderStatBar("STR", stats.strength, "#88B04B")}
      ${renderStatBar("AGI", stats.agility, "#FFA500")}
      ${renderStatBar("END", stats.endurance, "#009B77")}
      ${renderStatBar("FLX", stats.flexibility, "#00AEEF")}
    </div>
        </div>`;
      grid.appendChild(card);
    }
  } catch (err) {
    console.error("renderList error:", err);
  }
}

function renderStatBar(label, value, color) {
  const percent = Math.min((value / 1000) * 100, 100);
  return `
    <div class="stat-line" title="${label}: ${value}">
      <span class="stat-label">${label}</span>
      <div class="stat-bar-horizontal">
        <div class="stat-fill-horizontal" style="width: ${percent}%; background-color: ${color};" title="${value}"></div>
      </div>
    </div>
  `;
}

/*************** my puppy ***************/
async function loadMyPuppyInfo() {
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();
    const userAddress = await signer.getAddress();

    const contract = new ethers.Contract(pupaddr.puppy, pupabi.puppy, provider);

    // ✅ myPuppyid(address) 호출하여 정확한 pid 가져오기
    const pid = await contract.myPuppyid(userAddress);
    const mybreed = await contract.myPuppy(userAddress);

    if (pid === 0) {
     document.getElementById("puppyName").innerText = "⚠️ I haven't purchased a puppy yet.";
      return;
    }

    // 강아지 정보 가져오기
    const pup = await contract.puppys(pid);
    const stats = await contract.myinfo(pid);

    const [breed, name, battleBN, owner] = pup;
    const battle = Number(battleBN.toString());

    // HTML 요소에 적용
    const imgEl = document.getElementById("puppyImg");
    const nameEl = document.getElementById("puppyName");
    const infoEl = document.getElementById("puppyInfo");

    // 이미지 출력 (pid 기준)
    imgEl.src = `/images/puppy/${mybreed}.png`;
    imgEl.style.display = "block";

    // 이름 및 ID 출력
    nameEl.innerText = `#${pid} ${name}`;

    // 상세 정보 출력
    infoEl.innerHTML = `
      <p><strong>Owner:</strong> ${owner.slice(0, 6)}…${owner.slice(-4)}</p>
      <p><strong>Breed:</strong> ${breed}</p>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Battle:</strong> ${battle}</p>
    
      <hr>
      <div class="stat-bars">
        ${renderStat("INT", stats.intell)}
        ${renderStat("COU", stats.courage)}
        ${renderStat("STR", stats.strength)}
        ${renderStat("AGI", stats.agility)}
        ${renderStat("END", stats.endurance)}
        ${renderStat("FLX", stats.flexibility)}
      </div>
    `;
  } catch (err) {
    console.error("내 강아지 불러오기 실패:", err);
    const nameEl = document.getElementById("puppyName");
    if (nameEl) nameEl.innerText = "⚠️ No puppy or wallet connected.";
  }
}

// 능력치 게이지 구성 함수
function renderStat(label, value) {
  const widthPercent = (value / 1000) * 100;
  return `
    <div class="stat-line">
      <div class="stat-label">${label}</div>
      <div class="stat-bar-horizontal" title="${value}">
        <div class="stat-fill-horizontal bg-success" style="width: ${widthPercent}%;"></div>
      </div>
    </div>
  `;
}


/*************** feed my puppy ***************/
async function feedMyPuppy() {
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();
    const userAddress = await signer.getAddress();

    const contract = new ethers.Contract(pupaddr.puppy, pupabi.puppy, signer);

    // 내 강아지의 pid 확인
    const pidBN = await contract.myPuppyid(userAddress);
    const pid = pidBN.toNumber();

    if (pid === 0) {
      alert("⚠️ I haven't purchased a puppy yet.");
      return;
    }

    // 랜덤으로 하나 선택
    const functions = [
      "boostIntell",
      "boostCourage",
      "boostStrength",
      "boostAgility",
      "boostEndurance",
      "boostFlexibility"
    ];
    const randomIndex = Math.floor(Math.random() * functions.length);
    const selectedFunction = functions[randomIndex];

    // 실행
    const tx = await contract[selectedFunction](pid);
    document.getElementById("status").textContent = `⏳ Feeding in progress... (${selectedFunction})`;
    await tx.wait();

 document.getElementById("status").textContent = `✅ ${selectedFunction} success!`;
await loadMyPuppyInfo(); // Reflect updated ability
} catch (err) {
console.error("Feeding failed:", err);
alert("An error occurred while feeding");
}
}

/*************** Error helper ***************/
function handleError(e){
  let msg = e?.data?.message||e?.message||'';
  if(msg.includes('execution reverted:')) msg=msg.split('execution reverted:')[1];
  alert(msg||'Error'); console.error(e);
}




window.onload = () => {
  topSync();
  renderList();
  loadMyPuppyInfo(); // 함수 이름과 정의 정확히 일치시켜야 함                       
  document.getElementById("mintBtn").onclick = mintPuppy;
};

