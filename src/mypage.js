// mypage.js — PUPBank + GP integration (mobile-friendly)
(function (g) {
  const { ethers } = g;

  const ADDR = {
    pupbank: "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D",
    puptoken: "0x147ce247Ec2B134713fB6De28e8Bf4cAA5B4300C",
    pawtoken: "0xCC1ce312b7A7C4A78ffBf51F8fc0e087C1D4c72f",
    gp:       "0x35f7cfD9D3aE6Fdf1c080C3dd725EC68EB017caE"
  };

  const ABI = {
    pupbank: [
      "function g1() view returns(uint256)",
      "function g3() view returns(uint)",
      "function g6() view returns(uint256)",
      "function g8(address) view returns(uint)",
      "function g9(address) view returns(uint)",
      "function g10() view returns(uint256)",
      "function g11() view returns(uint256)",
      "function allow() view returns(uint256)",
      "function allowt(address) view returns(uint256)",
      "function getprice() view returns(uint256)",
      "function gettime() view returns(uint256)",
      "function withdraw()",
      "function buypup(uint) returns(bool)",
      "function sellpup(uint) returns(bool)",
      "function getpay(address) view returns(uint256)",
      "function allowcation() returns(bool)",
      "function getlevel(address) view returns(uint)",
      "function getmento(address) view returns(address)",
      "function memberjoin(address)",
      "function myinfo(address) view returns(uint256,uint256,uint256,address,uint256)",
      "function levelup()",
      "function buffing()",
      "function getmymenty(address) view returns(address[])"
    ],
    erc20: ["function balanceOf(address) view returns (uint256)"],
    gp:    ["function charge(uint _pay) public"]
  };

  let provider, signer, pupbank, paw, pup, gp;

  function extractRevertReason(error) {
    if (error?.error?.data?.message) return error.error.data.message.replace("execution reverted: ", "");
    if (error?.data?.message) return error.data.message.replace("execution reverted: ", "");
    if (error?.message?.includes("execution reverted:")) return error.message.split("execution reverted:")[1].trim();
    return "An unknown error occurred.";
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
          rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
          chainName: "opBNB",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          blockExplorerUrls: ["https://opbnbscan.com"]
        }]
      });
    }
  }

  async function initialize() {
    if (signer) return;
    if (!g.ethereum) { alert("Wallet is not installed. Please install MetaMask/Rabby."); return; }

    provider = new ethers.providers.Web3Provider(g.ethereum, "any");
    try { await provider.send("eth_requestAccounts", []); }
    catch (e) {
      alert("Wallet permission denied.");
      throw e;
    }
    await ensureOpBNB(provider);
    signer = provider.getSigner();

    pupbank = new ethers.Contract(ADDR.pupbank, ABI.pupbank, signer);
    paw     = new ethers.Contract(ADDR.pawtoken, ABI.erc20,   signer);
    pup     = new ethers.Contract(ADDR.puptoken, ABI.erc20,   signer);
    gp      = new ethers.Contract(ADDR.gp,       ABI.gp,      signer);
  }

  async function MemberLogin() {
    await initialize();
    const user = await signer.getAddress();

    const [totaldepo, mybonus, mylev, mymento, myexp] = await pupbank.myinfo(user);
    const levelexp = (2 ** mylev) * 10000;

    const pupBal = await pup.balanceOf(user);
    const pawBal = await paw.balanceOf(user);

    const el = (id) => document.getElementById(id);

    el("Mypaw").innerText     = (Number(pawBal) / 1e18).toFixed(2);
    el("Mypup").innerText     = String(pupBal);
    el("Mymento").innerText   = String(mymento);
    el("Mylev").innerText     = String(mylev);
    el("Mylev2").innerText    = String(mylev);
    el("Exp").innerText       = String(myexp);
    el("Expneeded").innerText = String(levelexp);
    el("Mypoint").innerText   = String(mybonus);

    const pct = Math.max(0, Math.min(100, (Number(myexp) / Math.max(1, Number(levelexp))) * 100));
    el("LevelBar").style.width = `${pct}%`;
  }

  async function Levelup() {
    try {
      await initialize();
      const tx = await pupbank.levelup();
      await tx.wait();
      alert("Level up success!");
      location.reload();
    } catch (e) {
      alert("Level up failed: " + extractRevertReason(e));
    }
  }

  async function Bonuswithdraw() {
    try {
      await initialize();
      const tx = await pupbank.withdraw();
      await tx.wait();
      alert("Bonus withdrawal completed");
      location.reload();
    } catch (e) {
      alert(extractRevertReason(e));
    }
  }

  async function Buff() {
    try {
      await initialize();
      const tx = await pupbank.buffing();
      await tx.wait();
      alert("Buff success!");
    } catch (e) {
      alert(extractRevertReason(e));
    }
  }

  async function fetchAddresses() {
    try {
      await initialize();
      const user = await signer.getAddress();
      const addresses = await pupbank.getmymenty(user);
      const list = document.getElementById("addressList");
      list.innerHTML = "";

      if (!addresses || !addresses.length) {
        const li = document.createElement("li");
        li.textContent = "No mentees found.";
        li.className = "list-group-item";
        list.appendChild(li);
        return;
      }
      addresses.forEach(addr => {
        const li = document.createElement("li");
        li.textContent = addr;
        li.className = "list-group-item";
        list.appendChild(li);
      });
    } catch (e) {
      alert(extractRevertReason(e));
    }
  }

  async function BuyPup() {
    try {
      await initialize();
      const amount = parseInt(document.getElementById("buyAmount")?.value ?? "0", 10);
      if (!Number.isFinite(amount) || amount <= 0) { alert("Enter a valid amount."); return; }
      const tx = await pupbank.buypup(amount);
      await tx.wait();
      alert("PUP purchase success!");
      location.reload();
    } catch (e) {
      alert(extractRevertReason(e));
    }
  }

  async function SellPup() {
    try {
      await initialize();
      const amount = parseInt(document.getElementById("sellAmount")?.value ?? "0", 10);
      if (!Number.isFinite(amount) || amount <= 0) { alert("Enter a valid amount."); return; }
      const tx = await pupbank.sellpup(amount);
      await tx.wait();
      alert("PUP sale success!");
      location.reload();
    } catch (e) {
      alert(extractRevertReason(e));
    }
  }

  async function chargeGP(amount) {
    try {
      await initialize();
      const tx = await gp.charge(amount);
      await tx.wait();
      alert(`Successfully charged ${amount * 1000} GP!`);
      location.reload();
    } catch (e) {
      console.error("Charge error:", e);
      alert(`Error: ${e?.message || 'charge failed'}`);
    }
  }

  function bindButtons() {
    document.getElementById("fetchAddresses")?.addEventListener("click", fetchAddresses);
    document.getElementById("chargeButton")?.addEventListener("click", () => {
      const v = parseInt(document.getElementById("Amount")?.value ?? "0", 10);
      if (!Number.isFinite(v) || v <= 0) { alert("Enter a valid amount"); return; }
      chargeGP(v);
    });
  }

  // Retry binding once after load (in case header/footer injected later)
  let _bindTried = false;
  function ensureBindings() {
    if (_bindTried) return;
    _bindTried = true;
    try { bindButtons(); } catch {}
  }

  g.addEventListener("DOMContentLoaded", ensureBindings);
  g.addEventListener("load", async () => {
    ensureBindings();
    try { await initialize(); await MemberLogin(); }
    catch (e) { console.warn("init/login failed", e); }
  });

  // Expose for inline onclicks
  g.MemberLogin    = MemberLogin;
  g.Levelup        = Levelup;
  g.Bonuswithdraw  = Bonuswithdraw;
  g.Buff           = Buff;
  g.fetchAddresses = fetchAddresses;
  g.BuyPup         = BuyPup;
  g.SellPup        = SellPup;
  g.chargeGP       = chargeGP;

  g.onerror = function (message, source, lineno, colno, error) {
    console.error("Global error:", message, error);
  };
})(window);
