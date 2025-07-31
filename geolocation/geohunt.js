const CONTRACT_ADDRESS = "0x04635E711fAd7ba117c07D93bafF906Cc1aAf833";
const CONTRACT_ABI = [
  "function hunt(uint _mid,uint pass ) external",
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

  const addr = await signer.getAddress();
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
      name: mon.name,
      power: mon.power.toString(),
      // 로컬 이미지 경로 수정
      image: `/images/mon/${mon.mid}.png`
    };
  } catch (err) {
    console.error(`몬스터 ${mid} 정보 조회 실패:`, err);
    return null;
  }
}

// 카드 UI로 잡은 몬스터 출력
async function showMyMon() {
  const ids = await getMyMon();
  const container = document.getElementById("myMonsters");
  if (!container) return;

  if (ids.length === 0) {
    container.innerHTML = "<p>잡은 몬스터 없음</p>";
    return;
  }

  // 각 ID 상세 조회
  const details = await Promise.all(ids.map(id => getMonsterDetails(id)));

  container.innerHTML = `
    <div class="row row-cols-1 row-cols-md-3 g-4">
      ${details.map(mon => mon ? `
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
      ` : "").join("")}
    </div>
  `;
}

// 전역 등록
window.showMyMon = showMyMon;

connectWallet();
