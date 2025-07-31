 //history 

 let noticeAddress = {
    noticeAddr: "0xa25859b85fEC1a340D63c7812D37f6A61F238293", // MonReport
  }; 
  
  let noticeAbi = {
    notice: [
       "function g3( ) public view returns(uint)",
      "function postNotice(string memory content) external onlyPostEligible",
      "function addComment(uint256 noticeId, string memory content) external onlyCommentEligible",
      "function vote(uint256 noticeId, bool agree) external",
      "function issueCommentReward(uint256 noticeId,uint256 cId) public",
      "function NoticeReward(uint256 noticeId) public",
      "function getCommentIDs(uint256 noticeId) public view returns (uint256[] memory)",
      "function tax( ) public view returns(uint)", 
      "function fee( ) public view returns(uint)", 
      "function noticeCount( ) public view returns(uint)", 
      "function commentCount( ) public view returns(uint)", 
      "function notices(uint num) public view returns( uint256 id,address author,string content,uint256 timestamp,uint256 agreeVotes,uint256 disagreeVotes,uint256 agreeWeight,uint256 disagreeWeight)",
      "function comments(uint num) public view returns( uint256 id,address commenter,string content,uint256 timestamp)"
    ]
  };

  let Ntopdate = async () => {
    try {
        const provider = new ethers.providers.JsonRpcProvider("https://1rpc.io/opbnb");
        const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, provider);
      
        ntvl = await contract.g3();  //전역변수 선언
        document.getElementById("Ntvl").innerHTML = parseFloat(ntvl);
  
    } catch (error) {
        console.error("Error in Ltopdate:", error);
    }
  };
  Ntopdate();
  
// 지갑 주소를 짧게 줄여서 표시 (예: 0x1234...ABCD)
function truncateAddress(address) {
  if (!address) return "";
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

  
async function fetchNotices() {
  const provider = new ethers.providers.JsonRpcProvider("https://1rpc.io/opbnb");
  const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, provider);
  const noticesContainer = document.getElementById("notices-container");

  try {
    const noticeCount = await contract.noticeCount();

    for (let i = 0; i < noticeCount; i++) {
      try {
        const notice = await contract.notices(i);

        // 인덱스로 데이터 추출
        const id = notice[0];
        const author = notice[1];
        const content = notice[2];
        const timestamp = notice[3];
        const agreeVotes = notice[4];
        const disagreeVotes = notice[5];
        const agreeWeight = notice[6];
        const disagreeWeight = notice[7];

        const noticeDiv = document.createElement("div");
        noticeDiv.classList.add("card", "mb-4", "w-100");
        noticeDiv.style.border = "1px solid #ccc";
        noticeDiv.style.margin = "10px";
        noticeDiv.style.padding = "20px";
        noticeDiv.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.1)";
        noticeDiv.style.borderRadius = "8px";

    noticeDiv.innerHTML = ` 
<div class="row g-3 align-items-center"> 
<div class="col-md-12"> 
<h5 class="card-title">Offer ID: ${id}</h5> 
<p><strong>Author:</strong> ${truncateAddress(author)}</p> 
<p><strong>Suggestion:</strong> ${content}</p> 
<p><strong>Creation time:</strong> ${new Date(timestamp * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Tbilisi' })}</p> 

<p><strong>Voting content:</strong> YES (${agreeWeight}), NO(${disagreeWeight})</p> 
<div class="d-flex justify-content-between my-3"> 
<button class="btn btn-success w-25" onclick="vote(${id}, 1)">YES</button> 
<button class="btn btn-danger w-25" onclick="vote(${id}, 2)">NO</button> 
</div> 
<!-- Comment list --> 
<ul id="comments-${id}" class="list-group mb-2"></ul> 
<input type="text" id="comment-input-${id}" class="form-control mb-2" placeholder="Enter comment"> 
<button class="btn btn-primary btn-sm" onclick="addComment(${id})">Register comment</button> 
</div> 
</div> 
`;

        noticesContainer.appendChild(noticeDiv);

   // load comments 
const commentIds = await contract.getCommentIDs(id); 
const commentsList = document.getElementById(`comments-${id}`); 

for (const commentId of commentIds) { 
try { 
const comment = await contract.comments(id, commentId); // Edit: Pass both arguments 
const commentItem = document.createElement("li"); 
commentItem.classList.add("list-group-item"); 
commentItem.innerHTML = ` 
<strong>${truncateAddress(comment[0])}</strong>: ${comment[1]}<br> 
<small>${new Date(comment[2] * 1000).toLocaleString('en-GB', { timeZone: 'Etc/GMT-3' })}</small> 
`; 
commentsList.appendChild(commentItem);
} catch (err) {
console.warn(`Failed to load comment ${commentId}`, err);
}
}
} catch (e) {
console.warn(`Failed to load notice ${i}`, e);
continue;
}
}
} catch (error) {
console.error("Failed to load all notices:", error);
}
}



  async function addComment(noticeId) {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();
    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, signer);

    const inputField = document.getElementById(`comment-input-${noticeId}`);
    const commentContent = inputField.value;

    if (!commentContent) {
      alert("Comment cannot be empty.");
      return;
    }

    try {
      const tx = await contract.addComment(noticeId, commentContent);
      await tx.wait();

      // Append the comment to the UI
      const commentsList = document.getElementById(`comments-${noticeId}`);
      const newCommentItem = document.createElement("li");
      newCommentItem.classList.add("list-group-item");
      newCommentItem.innerHTML = `
        <strong>${await signer.getAddress()}</strong>: ${commentContent} <br>
        <small>${new Date().toLocaleString()}</small>
      `;
      commentsList.appendChild(newCommentItem);

      // Clear the input field
      inputField.value = "";
      alert("Comment added successfully!");
    } catch (error) {
      console.error("Error adding comment:", error);
      alert("Failed to add comment. Please try again.");
    }
  }

async function vote(noticeId, option) {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = provider.getSigner();
  const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, signer);

  try {
    const agree = option === 1 ? true : false; // ✔️ bool 타입으로 변환
    await contract.vote(noticeId, agree);
    alert(agree ? "Voted Agree!" : "Voted Disagree!");
    location.reload(); // Reload to update the vote count
  } catch (error) {
    console.error("Error voting:", error);
    alert("Failed to cast your vote:\n" + (error?.data?.message || error.message));
  }
}




async function postNotice() {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = provider.getSigner();
  const userAddress = await signer.getAddress();

  const contract = new ethers.Contract(
    noticeAddress.noticeAddr,
    noticeAbi.notice,
    signer
  );




  const content = document.getElementById("post-content").value;
if (!content.trim()) {
alert("Please enter content.");
return;
}

try {

// Step 2: Write a post
const tx = await contract.postNotice(content);
alert("Writing a post...");
await tx.wait();

alert("The post was successfully posted!");
location.reload();
} catch (err) {
console.error("Error posting notice:", err);
alert("Post posting failed:\n" + (err?.data?.message || err.message));
}
}





  function togglePostForm() {
    const form = document.getElementById("post-notice-form");
    form.style.display = form.style.display === "none" ? "block" : "none";
}

async function claimNoticeReward(noticeId) {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = provider.getSigner();
    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, signer);
  
    try {
      const tx = await contract.NoticeReward(noticeId);
      alert("Claiming notice reward...");
      await tx.wait();
      alert("Notice reward claimed successfully!");
      location.reload(); // 페이지 새로고침
    } catch (error) {
      console.error("Error claiming notice reward:", error);
      alert("Failed to claim notice reward. Please try again.");
    }
  }
  

  async function claimCommentReward(noticeId) {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = provider.getSigner();
    const contract = new ethers.Contract(noticeAddress.noticeAddr, noticeAbi.notice, signer);
  
    // cId를 가져오는 논리를 추가해야 함
    const commentId = prompt("Enter the comment ID to claim the reward:");
  
    if (!commentId) {
      alert("Comment ID is required!");
      return;
    }
  
    try {
      const tx = await contract.issueCommentReward(noticeId, commentId);
      alert("Claiming comment reward...");
      await tx.wait();
      alert("Comment reward claimed successfully!");
      location.reload(); // 페이지 새로고침
    } catch (e) {
        alert(e.data?.message.replace('execution reverted: ', '') || e.message);
    }
  }
  
  window.onload = async () => {
    if (typeof window.ethereum === "undefined") {
      alert("MetaMask가 설치되어 있지 않습니다. MetaMask 설치 후 이용하세요.");
    }
    
    // MetaMask가 설치된 경우 공지사항을 불러옴
    fetchNotices();
  };
  