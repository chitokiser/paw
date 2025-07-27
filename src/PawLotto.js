
const RelayLottoAddress = {
  RelayLottoAddr: "0x6Cc95e853ae8572A1e2bB8038169ED60afA839e6" // PawLotto
};

const RelayLottoAbi = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "internalType": "uint256[]", "name": "numbers", "type": "uint256[]" }
    ],
    "name": "guess",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "wid",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "jack",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "", "type": "address" },
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "name": "tries",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256[]", "name": "numbers", "type": "uint256[]" }],
    "name": "createGame",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "getGameInfo",
    "outputs": [
      { "internalType": "bool", "name": "solved", "type": "bool" },
      { "internalType": "address", "name": "winner", "type": "address" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }],
    "name": "jackup",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "staff", "type": "address" },
      { "internalType": "uint8", "name": "role", "type": "uint8" }
    ],
    "name": "setStaff",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "getmento",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "GameCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "matched", "type": "uint256" }
    ],
    "name": "GuessMade",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "winner", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "reward", "type": "uint256" }
    ],
    "name": "GameEnded",
    "type": "event"
  }
];

const RPC = "https://1rpc.io/opbnb";

/*************************************
 * 잭팟 및 게임 ID 표시
 *************************************/
async function Data() {
  try {
    const provider = new ethers.providers.JsonRpcProvider(RPC);
    const contract = new ethers.Contract(RelayLottoAddress.RelayLottoAddr, RelayLottoAbi, provider);

    const [jackBN, widBN] = await Promise.all([
      contract.jack(),
      contract.wid()
    ]);

    const jackFormatted = jackBN.toNumber() / 10;
    const wid = widBN.toNumber();

    const jackElem = document.getElementById("Jack");
    const widElem = document.getElementById("Wid");

    if (jackElem) jackElem.textContent = jackFormatted;
    if (widElem) widElem.textContent = wid;

  } catch (error) {
    console.error("❌ Data() error:", error);
  }
}

/*************************************
 * 게임 생성
 *************************************/
async function CreateGame() {
  try {
    const nums = [
      +document.getElementById("num1").value,
      +document.getElementById("num2").value,
      +document.getElementById("num3").value,
      +document.getElementById("num4").value,
      +document.getElementById("num5").value
    ];

    if (nums.some(n => isNaN(n) || n < 1 || n > 45)) {
      alert("Only numbers between 1 and 45 can be entered.");
      return;
    }

    const unique = new Set(nums);
    if (unique.size !== 5) {
      alert("The number must be 5 without duplicates.");
      return;
    }

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = provider.getSigner();
    const contract = new ethers.Contract(RelayLottoAddress.RelayLottoAddr, RelayLottoAbi, signer);

    const tx = await contract.createGame(nums);
    alert("⏳ Sending transaction... Please wait.");
    await tx.wait();
    alert("✅ Game creation success!");
    await renderAllGames();

  } catch (err) {
    console.error("❌ CreateGame Error:", err);
    alert("Game creation failed: " + (err.reason || err.message));
  }
}

/*************************************
 * 이모지 버튼 렌더링
 *************************************/
const puppyEmojis = [
  "🐶","🐕","🦮","🐕‍🦺","🐩","🐾","🐺","🦊","🐱","🐈",
  "🦁","🐯","🐻","🐼","🐨","🐸","🐵","🦍","🐔","🐧",
  "🐦","🦉","🦅","🦆","🦢","🦜","🦩","🦚","🐤","🐣",
  "🐥","🦄","🐴","🐗","🐽","🐷","🐸","🐭","🐹","🐰",
  "🦝","🦔","🦨","🦡","🐻"
];

let selectedNumbers = {};

function renderEmojiInputs(gameId) {
  let container = `<div class="emoji-grid">`;
  for (let i = 0; i < 45; i++) {
    container += `<button type="button" class="emoji-btn" data-game="${gameId}" data-value="${i + 1}" onclick="selectEmoji(${gameId}, ${i + 1})">${puppyEmojis[i]}</button>`;
  }
  container += `</div>`;
  return container;
}

function selectEmoji(gameId, value) {
  if (!selectedNumbers[gameId]) selectedNumbers[gameId] = [];

  const nums = selectedNumbers[gameId];
  if (nums.includes(value)) {
    selectedNumbers[gameId] = nums.filter(n => n !== value);
  } else {
    if (nums.length >= 5) {
      alert("You can only select 5 emojis!");
      return;
    }
    selectedNumbers[gameId].push(value);
  }

  document.querySelectorAll(`.emoji-btn[data-game="${gameId}"]`).forEach(btn => {
    const val = parseInt(btn.dataset.value);
    if (selectedNumbers[gameId].includes(val)) {
      btn.classList.add("selected");
    } else {
      btn.classList.remove("selected");
    }
  });
}

/*************************************
 * 정답 제출
 *************************************/
async function submitAnswer(gameId) {
  const inputs = selectedNumbers[gameId] || [];

  if (inputs.length !== 5) {
    alert("Please select exactly 5 emojis (dogs)!");
    return;
  }

  const unique = new Set(inputs);
  if (unique.size !== 5) {
    alert("중복 없이 5개의 숫자를 입력해주세요.");
    return;
  }

  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = provider.getSigner();
    const user = await signer.getAddress();

    const contract = new ethers.Contract(RelayLottoAddress.RelayLottoAddr, RelayLottoAbi, signer);

    const tx = await contract.guess(gameId, inputs);
    const receipt = await tx.wait();

    const iface = new ethers.utils.Interface(RelayLottoAbi);
    let matched = null;

    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (
          parsed.name === "GuessMade" &&
          parsed.args.gameId.toString() === gameId.toString() &&
          parsed.args.user.toLowerCase() === user.toLowerCase()
        ) {
          matched = parsed.args.matched.toString();
          break;
        }
      } catch (e) {
        continue;
      }
    }

    const tries = await contract.tries(user, gameId);

    const resultDiv = document.createElement("div");
    resultDiv.className = "alert alert-success mt-2 fw-bold";
    resultDiv.textContent = `🎉 ${tries}th attempt! ${matched ?? '?'} correct!`;

    const cardBody = document.getElementById(`card-${gameId}`).querySelector(".card-body");
    cardBody.appendChild(resultDiv);
    setTimeout(() => {
      resultDiv.remove();
      renderAllGames();
    }, 3000);

  } catch (error) {
    console.error("❌ Failed to submit answer:", error);
    if (error.code === 4001) {
      alert("User rejected Metamask signing.");
    } else {
      alert("Failure: " + (error.reason || error.message));
    }
  }
}

/*************************************
 * 전체 게임 렌더링
 *************************************/
async function renderAllGames() {
  const container = document.getElementById("gameList");
  container.innerHTML = "⏳ Loading game list...";

  try {
    const provider = new ethers.providers.JsonRpcProvider(RPC);
    const contract = new ethers.Contract(RelayLottoAddress.RelayLottoAddr, RelayLottoAbi, provider);

    const wid = await contract.wid();
    const totalGames = wid.toNumber();

    const gameCards = [];

    for (let i = 0; i < totalGames; i++) {
      const [solved, winner] = await contract.getGameInfo(i);

      const inputHTML = !solved
        ? `
          <div class="mt-3">
            ${renderEmojiInputs(i)}
            <div class="d-flex justify-content-center mt-2">
              <button class="btn btn-outline-primary btn-sm px-4" onclick="submitAnswer(${i})">Submit answer</button>
            </div>
          </div>
        `
        : "";

      const shortWinner = solved
        ? `${winner.slice(0, 6)}...${winner.slice(-4)}`
        : "Not yet";

      const cardHTML = `
        <div class="card mb-3 border-${solved ? "success" : "secondary"}" id="card-${i}">
          <div class="card-body text-center">
            <h5 class="card-title">🎯 Game #${i}</h5>
            <p class="card-text">
              Status: <strong>${solved ? "✅ Completed" : "⏳ In Progress"}</strong><br>
              Winner: <br><small class="text-muted">${shortWinner}</small>
            </p>
            ${inputHTML}
          </div>
        </div>
      `;

      gameCards.push(cardHTML);
    }

    container.innerHTML = gameCards.join("");
  } catch (err) {
    console.error("❌ renderAllGames Error:", err);
    container.innerHTML = "<p class='text-danger'>게임 정보를 불러오는 데 실패했습니다.</p>";
  }
}

/*************************************
 * 최초 로드 시 실행
 *************************************/
document.addEventListener("DOMContentLoaded", async () => {
  await Data();
  await renderAllGames();
});

