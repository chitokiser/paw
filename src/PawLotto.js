// PawLotto.js — dark-glass UI ready, mobile-optimized, EN messages, RPC fallback
(function (g) {
  'use strict';
  const { ethers } = g;

  /* ---------- addresses & abi ---------- */
  const RelayLottoAddress = {
    RelayLottoAddr: "0xbab89d17BC73a9cD168Cf93E4B0B57C25B88f67B" // PawLotto
  };

  const RelayLottoAbi = [
    {"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"},{"internalType":"uint256[]","name":"numbers","type":"uint256[]"}],"name":"guess","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[],"name":"wid","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"jack","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"}],"name":"tries","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"internalType":"uint256[]","name":"numbers","type":"uint256[]"}],"name":"createGame","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"getGameInfo","outputs":[{"internalType":"bool","name":"solved","type":"bool"},{"internalType":"address","name":"winner","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"jackup","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"internalType":"address","name":"staff","type":"address"},{"internalType":"uint8","name":"role","type":"uint8"}],"name":"setStaff","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"getmento","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"GameCreated","type":"event"},
    {"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"gameId","type":"uint256"},{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":false,"internalType":"uint256","name":"matched","type":"uint256"}],"name":"GuessMade","type":"event"},
    {"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"gameId","type":"uint256"},{"indexed":true,"internalType":"address","name":"winner","type":"address"},{"indexed":false,"internalType":"uint256","name":"reward","type":"uint256"}],"name":"GameEnded","type":"event"}
  ];

  /* ---------- rpc fallback ---------- */
  const OPBNB_RPCS = [
    "https://opbnb-mainnet-rpc.bnbchain.org",
    "https://opbnb-rpc.publicnode.com",
    "https://opbnb.blockpi.network/v1/rpc/public",
    "https://1rpc.io/opbnb"
  ];
  let __readProvider = null;
  let __signer = null;

  function $(id){ return document.getElementById(id); }
  function setText(id, v){ const el=$(id); if(el) el.textContent=String(v); }
  function log(msg){
    const box = $('log'); if(!box) return;
    box.innerHTML = `<div>${new Date().toLocaleTimeString()} ${msg}</div>` + box.innerHTML;
  }
  function shortError(e){
    let m = e?.data?.message || e?.error?.message || e?.reason || e?.message || "";
    if(m.includes("execution reverted:")) m = m.split("execution reverted:")[1];
    return m || "Unknown error";
  }

  async function getHealthyReadProvider(timeout = 4000) {
    if (__readProvider) return __readProvider;
    for (const url of OPBNB_RPCS) {
      try {
        const p = new ethers.providers.StaticJsonRpcProvider(
          { url, timeout },
          { chainId: 204, name: "opbnb" }
        );
        await Promise.race([
          p.getBlockNumber(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeout))
        ]);
        __readProvider = p;
        return p;
      } catch {}
    }
    throw new Error("No healthy opBNB RPC");
  }

  async function ensureOpBNB(userProvider) {
    const net = await userProvider.getNetwork();
    if (Number(net.chainId) === 204) return;
    try {
      await g.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xCC" }] });
    } catch {
      await g.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0xCC",
          rpcUrls: [OPBNB_RPCS[0]],
          chainName: "opBNB",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          blockExplorerUrls: ["https://opbnbscan.com"]
        }]
      });
    }
  }

  async function connectWallet(){
    if(!g.ethereum){ alert("Please install a wallet (MetaMask/Rabby)."); return; }
    const provider = new ethers.providers.Web3Provider(g.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    await ensureOpBNB(provider);
    __signer = provider.getSigner();
    log("🔌 Connected: " + await __signer.getAddress());
  }

  /* ---------- top data (jackpot, wid) ---------- */
  async function Data() {
    try {
      const provider = await getHealthyReadProvider();
      const contract = new ethers.Contract(RelayLottoAddress.RelayLottoAddr, RelayLottoAbi, provider);

      const [jackBN, widBN] = await Promise.all([contract.jack(), contract.wid()]);
      // contract: jack has 1 decimal (÷10)
      const jack = Number(jackBN.toString()) / 10;
      const wid  = Number(widBN.toString());

      setText("Jack", jack);
      setText("Wid", wid);
      log("ℹ️ Updated jackpot & total games.");
    } catch (error) {
      console.error("❌ Data() error:", error);
      setText("Jack", "—"); setText("Wid", "—");
      log("⚠️ Failed to load top stats.");
    }
  }

  /* ---------- emoji input ui ---------- */
  const puppyEmojis = ["🐶","🐺","🦊","🐱","🦁","🐯","🐻","🐼","🐨","🐸"]; // 1..10
  const selectedNumbers = {}; // gameId -> number[]

  function renderEmojiInputs(gameId) {
    let html = `<div class="emoji-grid">`;
    for (let i = 0; i < 10; i++) {
      html += `<button type="button" class="emoji-btn" data-game="${gameId}" data-value="${i+1}" onclick="selectEmoji(${gameId}, ${i+1})">${puppyEmojis[i]}</button>`;
    }
    html += `</div>`;
    return html;
  }

  function selectEmoji(gameId, value) {
    if (!selectedNumbers[gameId]) selectedNumbers[gameId] = [];
    const arr = selectedNumbers[gameId];
    const exists = arr.includes(value);

    if (exists) {
      selectedNumbers[gameId] = arr.filter(n => n !== value);
    } else {
      if (arr.length >= 5) return alert("You can only select 5 emojis!");
      arr.push(value);
    }

    // toggle visual
    document.querySelectorAll(`.emoji-btn[data-game="${gameId}"]`).forEach(btn => {
      const v = parseInt(btn.dataset.value, 10);
      btn.classList.toggle("selected", selectedNumbers[gameId].includes(v));
    });
  }

  /* ---------- create game (staff) ---------- */
  async function CreateGame() {
    try {
      const nums = [
        +($( "num1")?.value || 0),
        +($( "num2")?.value || 0),
        +($( "num3")?.value || 0),
        +($( "num4")?.value || 0),
        +($( "num5")?.value || 0)
      ];

      // Spec: numbers are 1..10, 5 picks, no duplicates
      if (nums.some(n => !Number.isFinite(n) || n < 1 || n > 10)) {
        alert("Only numbers 1–10 are allowed.");
        return;
      }
      if (new Set(nums).size !== 5) {
        alert("Provide exactly 5 unique numbers.");
        return;
      }

      if (!__signer) await connectWallet();
      const contract = new ethers.Contract(RelayLottoAddress.RelayLottoAddr, RelayLottoAbi, __signer);
      const tx = await contract.createGame(nums);
      log("⏳ Sending createGame tx: " + tx.hash);
      $('statusMessage').textContent = "Sending transaction…";
      await tx.wait();
      $('statusMessage').textContent = "Game creation success!";
      log("✅ Game created.");
      await renderAllGames();
      await Data();
    } catch (err) {
      console.error("❌ CreateGame Error:", err);
      $('statusMessage').textContent = "Game creation failed: " + shortError(err);
      alert("Game creation failed: " + shortError(err));
    }
  }

  /* ---------- submit answer ---------- */
  async function submitAnswer(gameId) {
    const inputs = selectedNumbers[gameId] || [];
    if (inputs.length !== 5) return alert("Please select exactly 5 emojis!");
    if (new Set(inputs).size !== 5) return alert("Pick 5 unique emojis.");

    try {
      if (!__signer) await connectWallet();
      const user = (await __signer.getAddress()).toLowerCase();
      const contract = new ethers.Contract(RelayLottoAddress.RelayLottoAddr, RelayLottoAbi, __signer);

      const tx = await contract.guess(gameId, inputs);
      log(`⏳ Submitting guess for game #${gameId}… ${tx.hash}`);
      const receipt = await tx.wait();
      log(`✅ Guess confirmed: ${tx.hash}`);

      const iface = new ethers.utils.Interface(RelayLottoAbi);
      let matched = null;

      for (const logRec of receipt.logs) {
        try {
          const parsed = iface.parseLog(logRec);
          if (parsed.name === "GuessMade" &&
              parsed.args.gameId.toString() === String(gameId) &&
              String(parsed.args.user).toLowerCase() === user) {
            matched = parsed.args.matched.toString();
            break;
          }
        } catch {}
      }

      const tries = await contract.tries(user, gameId);
      const cardBody = g.document.getElementById(`card-${gameId}`)?.querySelector(".card-body");
      if (cardBody) {
        const div = g.document.createElement("div");
        div.className = "alert alert-success mt-2 fw-bold";
        div.textContent = `🎉 Attempt ${tries.toString()} — ${matched ?? "?"} correct!`;
        cardBody.appendChild(div);
        setTimeout(() => div.remove(), 3000);
      }

      await renderAllGames();
      await Data();
    } catch (error) {
      console.error("❌ Failed to submit answer:", error);
      if (error?.code === 4001) {
        alert("User rejected the request.");
      } else {
        alert("Failure: " + shortError(error));
      }
    }
  }

  /* ---------- render all games ---------- */
  async function renderAllGames() {
    const container = $("gameList");
    if (container) container.innerHTML = "⏳ Loading game list...";

    try {
      const provider = await getHealthyReadProvider();
      const contract = new ethers.Contract(RelayLottoAddress.RelayLottoAddr, RelayLottoAbi, provider);

      const widBN = await contract.wid();
      const total = Number(widBN.toString());

      const cards = [];
      for (let i = 0; i < total; i++) {
        const info = await contract.getGameInfo(i);
        const solved = Boolean(info.solved ?? info[0]);
        const winner = String(info.winner ?? info[1]);

        const shortWinner = solved ? `${winner.slice(0,6)}...${winner.slice(-4)}` : "Not yet";
        const inputHTML = !solved
          ? `
            <div class="mt-3">
              ${renderEmojiInputs(i)}
              <div class="d-flex justify-content-center mt-2">
                <button class="btn btn-outline-primary btn-sm px-4" onclick="submitAnswer(${i})">Submit answer</button>
              </div>
            </div>`
          : "";

        cards.push(`
          <div class="card mb-3 border-${solved ? "success" : "secondary"}" id="card-${i}">
            <div class="card-body text-center">
              <h5 class="card-title">🎯 Game #${i}</h5>
              <p class="card-text">
                Status: <strong>${solved ? "✅ Completed" : "⏳ In Progress"}</strong><br/>
                Winner:<br/><small class="text-muted">${shortWinner}</small>
              </p>
              ${inputHTML}
            </div>
          </div>
        `);
      }

      container.innerHTML = cards.join("") || "<em>No games yet</em>";
      log("ℹ️ Game list updated.");
    } catch (err) {
      console.error("❌ renderAllGames Error:", err);
      container.innerHTML = "<p class='text-danger'>Failed to load game info.</p>";
      log("⚠️ Failed to load game info.");
    }
  }

  /* ---------- boot ---------- */
  g.addEventListener("DOMContentLoaded", async () => {
    await Data();
    await renderAllGames();
  });

  /* ---------- expose for inline handlers & buttons ---------- */
  g.CreateGame = CreateGame;
  g.selectEmoji = selectEmoji;
  g.submitAnswer = submitAnswer;
  g.PawLotto = {
    connectWallet,
    refresh: async () => { await Data(); await renderAllGames(); }
  };

})(window);
