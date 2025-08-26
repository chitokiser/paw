// WithPuppy.js — stabilized (DOM-safe, RPC fallback, BigNumber-safe)
(function (g) {
  const { ethers } = g;

  /* ---------- Addresses & ABIs ---------- */
  const ADDR = {
    puppy: "0x4ceDeF50FB76113be3c65e59e5da11E85e53e22d"
  };
  const ABI = {
    puppy: [
      // Read
      "function pid() view returns (uint256)",
      "function myPuppy(address) view returns (uint256)",
      "function myPuppyid(address) view returns (uint256)",
      "function g1() view returns (uint256)",
      "function puppys(uint256) view returns (uint8 breed, string name, uint256 battleExp, address owner)",
      "function myinfo(uint256) view returns (uint16 intell, uint16 courage, uint16 strength, uint16 agility, uint16 endurance, uint16 flexibility)",
      // Write
      "function buyPuppy(string _name)",
      // Actions
      "function sellpuppy(uint256 _pid, uint256 _price) external",
      "function forsale(uint256 _pid) external",
      "function rename(uint256 _pid, string _newName) external",
      "function boostIntell(uint256 _pid) external",
      "function boostCourage(uint256 _pid) external",
      "function boostStrength(uint256 _pid) external",
      "function boostAgility(uint256 _pid) external",
      "function boostEndurance(uint256 _pid) external",
      "function boostFlexibility(uint256 _pid) external"
    ]
  };

  /* ---------- Read provider (RPC fallback) ---------- */
  const OPBNB_RPCS = [
    "https://opbnb-mainnet-rpc.bnbchain.org",
    "https://opbnb-rpc.publicnode.com",
    "https://opbnb.blockpi.network/v1/rpc/public",
    "https://1rpc.io/opbnb"
  ];
  let readProv, readContract;

  async function getHealthyReadProvider(timeout = 4000) {
    if (readProv) return readProv;
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
        readProv = p;
        return p;
      } catch {}
    }
    // 최후 fallback
    readProv = new ethers.providers.JsonRpcProvider("https://opbnb-mainnet-rpc.bnbchain.org");
    return readProv;
  }
  async function getReadContract() {
    if (!readContract) {
      const p = await getHealthyReadProvider();
      readContract = new ethers.Contract(ADDR.puppy, ABI.puppy, p);
    }
    return readContract;
  }

  /* ---------- DOM helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
  function shortError(e) {
    let m = e?.data?.message || e?.error?.message || e?.message || "";
    if (m.includes("execution reverted:")) m = m.split("execution reverted:")[1];
    return m || "Unknown error";
  }

  /* ---------- Top summary (safe) ---------- */
  async function topSync() {
    try {
      const c = await getReadContract();
      const [totalBN, izumBN] = await Promise.all([c.pid(), c.g1()]);
      setText("totalPid", totalBN.toString());
      setText("Pupbal", ethers.BigNumber.isBigNumber(izumBN) ? izumBN.toString() : String(izumBN));
    } catch (e) {
      console.warn("topSync error:", e);
    }
  }

  /* ---------- List rendering ---------- */
  async function renderList() {
    try {
      const c = await getReadContract();
      const totalBN = await c.pid();
      const total = totalBN.toNumber ? totalBN.toNumber() : Number(totalBN);
      const grid = $("list");
      if (!grid) return;
      grid.innerHTML = total ? "" : "<em>No puppies yet</em>";

      for (let id = 0; id < total; id++) {
        const [pup, stats] = await Promise.all([c.puppys(id), c.myinfo(id)]);
        const breed  = Number(pup.breed ?? pup[0]);
        const name   = String(pup.name ?? pup[1]);
        const battle = Number((pup.battleExp ?? pup[2]).toString());
        const owner  = String(pup.owner ?? pup[3]);

        const card = document.createElement("div");
        card.className = "card p-2";
        card.innerHTML = `
          <h4 class="mb-2">#${id} ${name}</h4>
          <div class="img-container mb-2">
            <img src="/images/puppy/${breed}.png" alt="breed ${breed}" class="puppy-img">
          </div>
          <div class="stats small">
            Breed: ${breed}<br>
            Owner: ${owner.slice(0,6)}…${owner.slice(-4)}<br>
            Battle: ${battle}
            <div class="stat-bars mt-2">
              ${renderStatBar("INT",  Number(stats.intell     ?? stats[0]), "#FF6F61")}
              ${renderStatBar("COU",  Number(stats.courage    ?? stats[1]), "#6B5B95")}
              ${renderStatBar("STR",  Number(stats.strength   ?? stats[2]), "#88B04B")}
              ${renderStatBar("AGI",  Number(stats.agility    ?? stats[3]), "#FFA500")}
              ${renderStatBar("END",  Number(stats.endurance  ?? stats[4]), "#009B77")}
              ${renderStatBar("FLX",  Number(stats.flexibility?? stats[5]), "#00AEEF")}
            </div>
          </div>`;
        grid.appendChild(card);
      }
    } catch (e) {
      console.error("renderList error:", e);
    }
  }
  function renderStatBar(label, value = 0, color) {
    const percent = Math.min((Number(value) / 1000) * 100, 100);
    return `
      <div class="stat-line" title="${label}: ${value}">
        <span class="stat-label">${label}</span>
        <div class="stat-bar-horizontal">
          <div class="stat-fill-horizontal" style="width:${percent}%;background-color:${color};"></div>
        </div>
      </div>`;
  }

  /* ---------- Wallet helpers ---------- */
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
          rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
          chainName: "opBNB",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          blockExplorerUrls: ["https://opbnbscan.com"]
        }]
      });
    }
  }

  /* ---------- Actions ---------- */
  async function mintPuppy() {
    const input = $("puppyNameInput") || $("puppyName"); // fallback
    if (!input) return alert("Name input not found.");
    const name = input.value.trim();
    if (!name) return alert("Please enter your dog's name");

    if (!g.ethereum) return alert("No wallet");
    const provider = new ethers.providers.Web3Provider(g.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    await ensureOpBNB(provider);
    const signer = provider.getSigner();
    const c = new ethers.Contract(ADDR.puppy, ABI.puppy, signer);

    try {
      setText("status", "⏳ Transaction pending…");
      const tx = await c.buyPuppy(name);
      setText("status", `⛓ Waiting for confirmation (${tx.hash.slice(0, 10)}…)`);
      await tx.wait();
      setText("status", "✅ Puppy creation complete!");
      input.value = "";
      await Promise.all([topSync(), renderList(), loadMyPuppyInfo()]);
    } catch (e) {
      alert(shortError(e));
      console.error(e);
      setText("status", "");
    }
  }

  async function loadMyPuppyInfo() {
    try {
      if (!g.ethereum) return;
      const provider = new ethers.providers.Web3Provider(g.ethereum, "any");
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      const user = await signer.getAddress();
      const c = new ethers.Contract(ADDR.puppy, ABI.puppy, provider);

      const pidBN = await c.myPuppyid(user);
      if (pidBN.isZero ? pidBN.isZero() : pidBN.toString() === "0") {
        const nameEl = $("puppyNameLabel") || $("puppyName");
        if (nameEl) nameEl.textContent = "⚠️ I haven't purchased a puppy yet.";
        return;
      }
      const pid = pidBN.toNumber ? pidBN.toNumber() : Number(pidBN);
      const mybreedBN = await c.myPuppy(user);
      const mybreed = mybreedBN.toNumber ? mybreedBN.toNumber() : Number(mybreedBN);

      const pup   = await c.puppys(pid);
      const stats = await c.myinfo(pid);
      const breed  = Number(pup.breed ?? pup[0]);
      const name   = String(pup.name ?? pup[1]);
      const battle = Number((pup.battleExp ?? pup[2]).toString());
      const owner  = String(pup.owner ?? pup[3]);

      const imgEl  = $("puppyImg");
      const nameEl = $("puppyNameLabel") || $("puppyName");
      const infoEl = $("puppyInfo");

      if (imgEl) { imgEl.src = `/images/puppy/${mybreed}.png`; imgEl.style.display = "block"; }
      if (nameEl) nameEl.textContent = `#${pid} ${name}`;
      if (infoEl) {
        infoEl.innerHTML = `
          <p><strong>Owner:</strong> ${owner.slice(0,6)}…${owner.slice(-4)}</p>
          <p><strong>Breed:</strong> ${breed}</p>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Battle:</strong> ${battle}</p>
          <hr>
          <div class="stat-bars">
            ${renderStat("INT", Number(stats.intell ?? stats[0]))}
            ${renderStat("COU", Number(stats.courage ?? stats[1]))}
            ${renderStat("STR", Number(stats.strength ?? stats[2]))}
            ${renderStat("AGI", Number(stats.agility ?? stats[3]))}
            ${renderStat("END", Number(stats.endurance ?? stats[4]))}
            ${renderStat("FLX", Number(stats.flexibility ?? stats[5]))}
          </div>`;
      }
    } catch (err) {
      console.error("loadMyPuppyInfo failed:", err);
      const nameEl = $("puppyNameLabel") || $("puppyName");
      if (nameEl) nameEl.textContent = "⚠️ No puppy or wallet connected.";
    }
  }
  function renderStat(label, value = 0) {
    const widthPercent = Math.min((Number(value) / 1000) * 100, 100);
    return `
      <div class="stat-line">
        <div class="stat-label">${label}</div>
        <div class="stat-bar-horizontal" title="${value}">
          <div class="stat-fill-horizontal bg-success" style="width:${widthPercent}%;"></div>
        </div>
      </div>`;
  }

  async function feedMyPuppy() {
    try {
      if (!g.ethereum) return alert("No wallet");
      const provider = new ethers.providers.Web3Provider(g.ethereum, "any");
      await provider.send("eth_requestAccounts", []);
      await ensureOpBNB(provider);
      const signer = provider.getSigner();
      const user = await signer.getAddress();
      const c = new ethers.Contract(ADDR.puppy, ABI.puppy, signer);

      const pidBN = await c.myPuppyid(user);
      const pid = pidBN.toNumber ? pidBN.toNumber() : Number(pidBN);
      if (!pid) return alert("⚠️ I haven't purchased a puppy yet.");

      const fns = ["boostIntell","boostCourage","boostStrength","boostAgility","boostEndurance","boostFlexibility"];
      const selected = fns[Math.floor(Math.random() * fns.length)];
      setText("status", `⏳ Feeding in progress... (${selected})`);
      const tx = await c[selected](pid);
      await tx.wait();
      setText("status", `✅ ${selected} success!`);
      await loadMyPuppyInfo();
    } catch (err) {
      console.error("Feeding failed:", err);
      alert(shortError(err) || "An error occurred while feeding");
    }
  }

  /* ---------- boot & expose ---------- */
  g.addEventListener("DOMContentLoaded", () => {
    topSync().catch(()=>{});
    renderList().catch(()=>{});
    loadMyPuppyInfo().catch(()=>{});
    $("mintBtn")?.addEventListener("click", mintPuppy);
  });

  g.topSync = topSync;
  g.renderList = renderList;
  g.loadMyPuppyInfo = loadMyPuppyInfo;
  g.mintPuppy = mintPuppy;
  g.feedMyPuppy = feedMyPuppy;

})(window);
