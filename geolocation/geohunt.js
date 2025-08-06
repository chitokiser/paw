const CONTRACT_ADDRESS = "0xE81E0976D6aa80c9C2C210cEA6106592feBEB220"; // geohunt
const CONTRACT_ABI = [
  "function mons(uint) view returns (string memory name,uint mid,uint power)",
  "function mid() view returns (uint)",
  "function getmymon(address user) external view returns (uint256[] memory)"
];

let provider, signer, contract;

// 지갑 연결
async function connectWallet() {
  if (!window.ethereum) {
    alert("메타마스크 설치 필요");
    return;
  }

  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();

  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

  // 전역에서도 사용 가능하게
  window.contract = contract;

  const addr = await signer.getAddgitress();
  document.getElementById("walletAddress").innerText = `지갑: ${addr}`;
}

// getmymon 호출
async function getMyMon() {
  if (!window.contract || !signer) {
    alert("지갑 연결이 필요합니다.");
    return [];
  }
  try {
    const userAddress = await signer.getAddress();
    const myMonArray = await window.contract.getmymon(userAddress);
    return myMonArray.map(num => Number(num)); // BigNumber → Number
  } catch (err) {
    console.error("getmymon 호출 에러:", err);
    return [];
  }
}

// 몬스터 상세 조회 (mons(mid) 호출)
async function getMonsterDetails(mid) {
  try {
    const mon = await window.contract.mons(mid);
    return {
      id: mon.mid.toString(),
      name: mon.name && mon.name.trim() !== "" ? mon.name : "Unknown Monster",
      power: mon.power.toString(),
      image: `/images/mon/${mon.mid}.png`
    };
  } catch (err) {
    console.error(`몬스터 ${mid} 정보 조회 실패:`, err);
    return null;
  }
}

// 카드 UI로 잡은 몬스터 출력 (순차 조회)
async function showMyMon() {
  const ids = await getMyMon();
  const container = document.getElementById("myMonsters");
  if (!container) return;

  if (ids.length === 0) {
    container.innerHTML = "<p>No monsters caught</p>";
    return;
  }

  let cardsHTML = "";

  for (const id of ids) {
    const mon = await getMonsterDetails(id);

    if (mon) {
      cardsHTML += `
        <div class="col">
          <div class="card h-100 shadow-sm">
            <img src="${mon.image}" class="card-img-top" alt="${mon.name}">
            <div class="card-body">
              <h5 class="card-title">${mon.name}</h5>
              <p class="card-text">Power: ${mon.power}</p>
              <p class="text-muted">#${mon.id}</p>
            </div>
          </div>
        </div>
      `;
    } else {
      // mons() 조회 실패 시 Unknown 카드 출력
      cardsHTML += `
        <div class="col">
          <div class="card h-100 shadow-sm">
            <div class="card-body">
              <h5 class="card-title">Unknown Monster</h5>
              <p class="card-text">Power: 0</p>
              <p class="text-muted">#${id}</p>
            </div>
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = `
    <div class="row row-cols-1 row-cols-md-3 g-4">
      ${cardsHTML}
    </div>
  `;
}

// 전역 등록
window.showMyMon = showMyMon;

// 지갑 연결
connectWallet();
