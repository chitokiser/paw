// PawVote.js — no-modifier ABI + StaticJsonRpcProvider fallback + network switch

/* ---------- Address ---------- */
const noticeAddress = {
  noticeAddr: "0xD8A0A2cc7D415C6EB7ef52b9471630b03feCA766",
};

/* ---------- ABI (modifier 제거) ---------- */
const noticeAbi = {
  notice: [
    "function g3() view returns(uint)",
    "function postNotice(string content) external",
    "function addComment(uint256 noticeId, string content) external",
    "function vote(uint256 noticeId, bool agree) external",
    "function issueCommentReward(uint256 noticeId,uint256 cId) external",
    "function NoticeReward(uint256 noticeId) external",
    "function getCommentIDs(uint256 noticeId) view returns (uint256[] memory)",
    "function tax() view returns(uint)",
    "function fee() view returns(uint)",
    "function noticeCount() view returns(uint)",
    "function commentCount() view returns(uint)",
    "function notices(uint num) view returns( uint256 id,address author,string content,uint256 timestamp,uint256 agreeVotes,uint256 disagreeVotes,uint256 agreeWeight,uint256 disagreeWeight)",
    "function comments(uint num) view returns( uint256 id,address commenter,string content,uint256 timestamp)"
  ]
};

/* ---------- Utils ---------- */
function shortError(e) {
  let msg = e?.data?.message || e?.error?.message || e?.message || "Unknown error";
  if (typeof msg === "string" && msg.includes("execution reverted:")) {
    msg = msg.split("execution reverted:")[1].trim();
  }
  try { return msg.split("(")[0].trim(); } catch { return msg; }
}
function truncateAddress(a){ return a ? `${a.slice(0,6)}...${a.slice(-4)}` : ""; }

/* ---------- Read-only provider (fallback) ---------- */
const OPBNB_RPCS = [
  "https://opbnb-mainnet-rpc.bnbchain.org",
  "https://opbnb-rpc.publicnode.com",
  "https://opbnb.blockpi.network/v1/rpc/public",
  "https://1rpc.io/opbnb"
];

async function pickHealthyRpc(timeoutMs = 4000) {
  for (const url of OPBNB_RPCS) {
    try {
      const p = new ethers.providers.StaticJsonRpcProvider(
        { url, timeout: timeoutMs },
        { chainId: 204, name: "opbnb" }
      );
      await Promise.race([
        p.getBlockNumber(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))
      ]);
      return p;
    } catch {}
  }
  throw new Error("No healthy opBNB RPC found");
}
let __readProvider = null;
async function getReadProvider() {
  if (__readProvider) return __readProvider;
  __readProvider = await pickHealthyRpc();
  return __readProvider;
}

/* ---------- Wallet provider (tx) ---------- */
async function ensureOpBNB(userProvider) {
  const net = await userProvider.getNetwork();
  if (Number(net.chainId) === 204) return;
  try {
    await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{ chainId:"0xCC" }] });
  } catch {
    await window.ethereum.request({
      method:"wallet_addEthereumChain",
      params:[{
        chainId:"0xCC",
        rpcUrls:["https://opbnb-mainnet-rpc.bnbchain.org"],
        chainName:"opBNB",
        nativeCurrency:{ name:"BNB", symbol:"BNB", decimals:18 },
        blockExplorerUrls:["https://opbnbscan.com"]
      }]
    });
  }
}

/* ---------- Top numbers ---------- */
async function Ntopdate() {
  try {
    const provider = await getReadProvider();
    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, provider);
    const ntvl = await contract.g3();
    const elA = document.getElementById("Ntvl");
    const elB = document.getElementById("Tvl");
    if (elA) elA.textContent = String(ntvl);
    if (elB) elB.textContent = String(ntvl);
  } catch (e) {
    console.error("Error in Ltopdate:", e);
  }
}
Ntopdate();

/* ---------- Load notices ---------- */
async function fetchNotices() {
  try {
    const provider = await getReadProvider();
    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, provider);
    const noticesContainer = document.getElementById("notices-container");
    if (!noticesContainer) return;

    const noticeCount = Number(await contract.noticeCount());
    for (let i = 0; i < noticeCount; i++) {
      try {
        const n = await contract.notices(i);
        const id = n[0], author = n[1], content = n[2], ts = Number(n[3]);
        const agreeWeight = n[6], disagreeWeight = n[7];

        const wrap = document.createElement("div");
        wrap.className = "card mb-4 w-100";
        wrap.style.cssText = "border:1px solid #ccc;margin:10px;padding:20px;box-shadow:0 4px 8px rgba(0,0,0,.1);border-radius:8px;";
        wrap.innerHTML = `
<div class="row g-3 align-items-center">
  <div class="col-md-12">
    <h5 class="card-title">Offer ID: ${id}</h5>
    <p><strong>Author:</strong> ${truncateAddress(author)}</p>
    <p><strong>Suggestion:</strong> ${content}</p>
    <p><strong>Creation time:</strong> ${new Date(ts * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Tbilisi' })}</p>
    <p><strong>Voting content:</strong> YES (${agreeWeight}), NO (${disagreeWeight})</p>

    <div class="d-flex justify-content-between my-3">
      <button class="btn btn-success w-25" onclick="vote(${id}, 1)">YES</button>
      <button class="btn btn-danger w-25" onclick="vote(${id}, 2)">NO</button>
    </div>

    <ul id="comments-${id}" class="list-group mb-2"></ul>
    <input type="text" id="comment-input-${id}" class="form-control mb-2" placeholder="Enter comment">
    <button class="btn btn-primary btn-sm" onclick="addComment(${id})">Register comment</button>
  </div>
</div>`;
        noticesContainer.appendChild(wrap);

        // comments (단일 인자 시그니처)
        const commentIds = await contract.getCommentIDs(id);
        const list = document.getElementById(`comments-${id}`);
        for (const cId of commentIds) {
          try {
            const c = await contract.comments(cId);
            const cItem = document.createElement("li");
            cItem.className = "list-group-item";
            cItem.innerHTML = `
<strong>${truncateAddress(c[1])}</strong>: ${c[2]}<br>
<small>${new Date(Number(c[3]) * 1000).toLocaleString('en-GB', { timeZone: 'Etc/GMT-3' })} · cID=${c[0]}</small>`;
            list.appendChild(cItem);
          } catch (err) { console.warn(`Failed to load comment ${cId}`, err); }
        }
      } catch (e) {
        console.warn(`Failed to load notice ${i}`, e);
      }
    }
  } catch (error) {
    console.error("Failed to load all notices:", error);
  }
}

/* ---------- Actions ---------- */
async function addComment(noticeId) {
  try {
    if (!window.ethereum) return alert("Please install MetaMask/Rabby.");
    const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    await ensureOpBNB(provider);
    const signer = provider.getSigner();

    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, signer);
    const input = document.getElementById(`comment-input-${noticeId}`);
    const content = (input?.value || "").trim();
    if (!content) return alert("Comment cannot be empty.");

    const tx = await contract.addComment(noticeId, content);
    await tx.wait();

    const list = document.getElementById(`comments-${noticeId}`);
    const li = document.createElement("li");
    li.className = "list-group-item";
    li.innerHTML = `<strong>${truncateAddress(await signer.getAddress())}</strong>: ${content}<br><small>${new Date().toLocaleString()}</small>`;
    list.appendChild(li);
    input.value = "";
    alert("Comment added successfully!");
  } catch (e) {
    console.error("Error adding comment:", e);
    alert("Failed to add comment. " + shortError(e));
  }
}

async function vote(noticeId, option) {
  try {
    if (!window.ethereum) return alert("Please install MetaMask/Rabby.");
    const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    await ensureOpBNB(provider);
    const signer = provider.getSigner();

    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, signer);
    const tx = await contract.vote(noticeId, option === 1);
    await tx.wait();
    alert(option === 1 ? "Voted Agree!" : "Voted Disagree!");
    location.reload();
  } catch (e) {
    console.error("Error voting:", e);
    alert("Failed to cast your vote: " + shortError(e));
  }
}

async function postNotice() {
  try {
    if (!window.ethereum) return alert("Please install MetaMask/Rabby.");
    const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    await ensureOpBNB(provider);
    const signer = provider.getSigner();

    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, signer);
    const content = document.getElementById("post-content").value.trim();
    if (!content) return alert("Please enter content.");

    const tx = await contract.postNotice(content);
    alert("Writing a post...");
    await tx.wait();
    alert("The post was successfully posted!");
    location.reload();
  } catch (e) {
    console.error("Error posting notice:", e);
    alert("Post failed: " + shortError(e));
  }
}

async function claimNoticeReward(noticeId) {
  try {
    if (!window.ethereum) return alert("Please install MetaMask/Rabby.");
    const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    await ensureOpBNB(provider);
    const signer = provider.getSigner();

    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, signer);
    const tx = await contract.NoticeReward(noticeId);
    alert("Claiming notice reward...");
    await tx.wait();
    alert("Notice reward claimed successfully!");
    location.reload();
  } catch (e) {
    alert("Failed to claim notice reward. " + shortError(e));
  }
}

async function claimCommentReward(noticeId) {
  try {
    if (!window.ethereum) return alert("Please install MetaMask/Rabby.");
    const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    await ensureOpBNB(provider);
    const signer = provider.getSigner();

    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, signer);
    const commentId = prompt("Enter the comment ID to claim the reward:");
    if (!commentId) return alert("Comment ID is required!");

    const tx = await contract.issueCommentReward(noticeId, commentId);
    alert("Claiming comment reward...");
    await tx.wait();
    alert("Comment reward claimed successfully!");
    location.reload();
  } catch (e) {
    alert(shortError(e));
  }
}

/* ---------- boot ---------- */
window.onload = () => { fetchNotices(); };
window.fetchNotices = fetchNotices;
window.addComment = addComment;
window.vote = vote;
window.postNotice = postNotice;
window.claimNoticeReward = claimNoticeReward;
window.claimCommentReward = claimCommentReward;
