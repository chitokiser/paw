
// geohunt.js (전역 방식)
const CONTRACT_ADDRESS = "0xD36b5769b3eea86ecB352E8DF200e1B09462ffc5"; // 배포 주소 넣기
const CONTRACT_ABI = [
  "function createmon(string memory name, uint power,uint breed,uint pass) external",
  "function hunt(uint _mid,uint pass ) external",
  "function mons(uint) view returns (string memory name,uint breed,uint mid,uint power)",
  "function mid() view returns (uint)"
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

// 몬스터 등록
async function createMonster(name, power, breed, pass) {
  if (!window.contract) {
    alert("먼저 지갑을 연결하세요");
    return;
  }
  try {
    const tx = await window.contract.createmon(name, power, breed, pass);
    await tx.wait();
    alert("몬스터 등록 성공!");
  } catch (err) {
    console.error(err);
    alert("몬스터 등록 실패: " + err.message);
  }
}

// 몬스터 목록 불러오기
async function getMonsters() {
  const total = await window.contract.mid();
  let monsters = [];
  for (let i = 0; i < total; i++) {
    const mon = await window.contract.mons(i);
    monsters.push({
      id: mon.mid.toString(),
      name: mon.name,
      power: mon.power.toString(),
      breed: mon.breed.toString()
    });
  }
  return monsters;
}

// 사냥하기
async function huntMonster(monId, pass) {
  if (!window.contract) {
    alert("먼저 지갑을 연결하세요");
    return;
  }
  try {
    const tx = await window.contract.hunt(monId, pass);
    await tx.wait();
    alert("사냥 완료!");
  } catch (err) {
    console.error(err);
    alert("사냥 실패: " + err.message);
  }
}
connectWallet();