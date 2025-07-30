
// geohunt.js (전역 방식)
const CONTRACT_ADDRESS = "0xfc6914941f16Af5d1e25a178e9c44f5bC1e4015B"; // 배포 주소 넣기
const CONTRACT_ABI = [
  "function hunt(uint _mid,uint pass ) external",
  "function mons(uint) view returns (string memory name,uint mid,uint power)",
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
    });
  }
  return monsters;
}


connectWallet();