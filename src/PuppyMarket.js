// 1. 컨트랙트 주소
const contractAddress = {
  puppymarketAddr: "0xE14eC3de50be7f66d9cA962ECFb86f842b6e6d76",
  pawAddr:       "0xCC1ce312b7A7C4A78ffBf51F8fc0e087C1D4c72f",
  puppyAddr:     "0x4ceDeF50FB76113be3c65e59e5da11E85e53e22d"
};

// 2. 컨트랙트 ABI
const contractAbi = {
  puppymarket: [
    "function calculatePrice(uint256 _pid) public view returns (uint256)",
    "function max() public view returns (uint256)",
    "function ls(uint256) public view returns (uint256 bid, address owner, uint256 price)",
    "function listPuppy() external",
    "function buyPuppy(uint256 _mid) external",
    "function g1() public view virtual returns(uint256)",
    "event PuppyListed(uint256 pid, address seller, uint256 price)",
    "event PuppySold(  uint256 pid, address buyer, uint256 price)",
    "event PuppyDelisted(uint256 pid)"
  ],
  puppy: [
    "function myPuppyid(address user) external view returns (uint256)",
    "function getowner(uint256 _pid) external view returns (address)"
  ]
};

// 3. Provider & Contract 생성
const provider = new ethers.providers.JsonRpcProvider("https://1rpc.io/opbnb");
const market   = new ethers.Contract(contractAddress.puppymarketAddr, contractAbi.puppymarket, provider);
const puppy    = new ethers.Contract(contractAddress.puppyAddr,       contractAbi.puppy,      provider);

// 잔고 조회 함수
async function getContractBalance() {
  try {
    const balance = await market.g1();
    console.log("[DEBUG] Contract g1 balance:", balance.toString());
    document.getElementById("contractBalance").innerText = `Contract Balance: ${(balance/1e18).toString()} PAW`;
  } catch (err) {
    console.error("g1 조회 실패:", err);
    document.getElementById("contractBalance").innerText = "Contract Balance: 조회 실패";
  }
}

// 4. 내 강아지 가격 표시 + 등록 버튼
async function showMyPuppyPrice() {
  if (!window.ethereum) { alert("MetaMask가 필요합니다"); return; }
  await window.ethereum.request({ method: "eth_requestAccounts" });
  const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer        = web3Provider.getSigner();

  const puppyWithSigner  = new ethers.Contract(contractAddress.puppyAddr,       contractAbi.puppy,      signer);
  const pid              = await puppyWithSigner.myPuppyid(await signer.getAddress());
  console.log("[DEBUG] PID:", pid.toString());

  const marketWithSigner = new ethers.Contract(contractAddress.puppymarketAddr, contractAbi.puppymarket, signer);
  const price            = await marketWithSigner.calculatePrice(pid);
  console.log("[DEBUG] Raw Price:", price.toString());

  const formattedPrice = parseFloat(ethers.utils.formatUnits(price, 18)).toFixed(2);
  document.getElementById("myPuppyPrice").innerHTML = `
    My Puppy Price: ${formattedPrice} PAW
    <button class="btn btn-success btn-sm" onclick="listMyPuppy()">등록하기</button>
  `;
}

// 5. 강아지 등록
async function listMyPuppy() {
  if (!window.ethereum) { alert("MetaMask가 필요합니다"); return; }
  await window.ethereum.request({ method: "eth_requestAccounts" });
  const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer        = web3Provider.getSigner();

  const marketWithSigner = new ethers.Contract(contractAddress.puppymarketAddr, contractAbi.puppymarket, signer);
  const tx               = await marketWithSigner.listPuppy();
  await tx.wait();

  alert("강아지 등록 완료!");
  fetchAllListings();
}

// 6. 강아지 구매
async function buyPuppy(mid) {
  try {
    if (!window.ethereum) {
      alert("MetaMask가 필요합니다");
      return;
    }

    // Ensure wallet connection
    const [user] = await window.ethereum.request({ method: "eth_requestAccounts" });
    const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = web3Provider.getSigner();

    // Fetch listing details to pre-check conditions
    const listing = await market.ls(mid);
    const price = listing.price;
    if (price.toString() === "0") {
      alert("해당 슬롯에 판매중인 강아지가 없습니다.");
      return;
    }

    // Check PAW balance
    const pawContract = new ethers.Contract(contractAddress.pawAddr, ["function balanceOf(address) view returns(uint256)"], web3Provider);
    const balance = await pawContract.balanceOf(user);
    if (balance.lt(price)) {
      alert("PAW 잔액이 부족합니다.");
      return;
    }

    // Prepare contract with signer
    const marketWithSigner = new ethers.Contract(contractAddress.puppymarketAddr, contractAbi.puppymarket, signer);

    // Send transaction with explicit gasLimit
    const tx = await marketWithSigner.buyPuppy(mid, { gasLimit: 200000 });
    console.log("[DEBUG] buyPuppy tx hash:", tx.hash);

    await tx.wait();
    alert("Puppy 구매 완료!");
    fetchAllListings();
  } catch (err) {
    console.error("구매 실패:", err);
    alert("구매 실패: " + (err.data?.message || err.message || err));
  }
}

// 7. 전체 리스트 불러오기
async function fetchAllListings() {
  const container = document.getElementById("listing-container");
  container.innerHTML = "";
  const max = await market.max();

  for (let i = 1; i <= max; i++) {
    const listing = await market.ls(i);
    renderCard(i, listing.bid, listing.owner, listing.price);
  }
}

// 8. 카드 렌더링 (이미지 + 가격 + 버튼)
function renderCard(mid, bid, owner, price) {
  const container = document.getElementById("listing-container");
  const card      = document.createElement("div");
  card.className  = "card col-5 m-2";

  const shortOwner  = (owner && owner !== ethers.constants.AddressZero)
    ? `${owner.slice(0, 6)}…${owner.slice(-4)}`
    : "None";

  const isEmpty     = price == 0;
  const priceDisplay = isEmpty
    ? "Empty Slot"
    : `${parseFloat(ethers.utils.formatUnits(price, 18)).toFixed(2)} PAW`;

  const imagePath   = `images/puppy/${bid}.png`;
  const buyButton   = `<button class='btn btn-primary btn-action' onclick='buyPuppy(${mid})'>Buy</button>`;

  card.innerHTML = `
    <h3>Puppy #${mid}</h3>
    <img src="${imagePath}" alt="Puppy ${bid}" style="width:100px;height:100px;object-fit:cover;">
    <div class="info"><strong>Bid:</strong> ${bid}</div>
    <div class="info"><strong>Owner:</strong> ${shortOwner}</div>
    <div class="price">${priceDisplay}</div>
    ${isEmpty
      ? `<button class='btn btn-secondary btn-action' disabled>등록 가능</button>`
      : buyButton}
  `;

  if (isEmpty) card.classList.add("empty");
  container.appendChild(card);
}

// 9. 초기 실행
window.addEventListener("load", () => {
  showMyPuppyPrice();
  fetchAllListings();
  getContractBalance();
});
