// ================================
//  주소 및 ABI 설정
// ================================
let address2 = {
    soccerAddr: "0x961a9569B9EB9296238154d0DC7a30203A133dCD" // PuppyWar 컨트랙트 주소
};

let abi2 = {
    soccer: [
        "function play(uint8 _winnum,uint pay) public",
        "event Result(address indexed user, uint home, uint away)",
        "event Reward(address indexed user, uint amount)", // indexed 추가
        "event Loss(address indexed user, uint amount)"     // indexed 추가
    ]
};

// ================================
//  에러 처리 함수
// ================================
function handleContractError(e, fallback = "Something went wrong. Please try again.") {
    let msg = fallback;

    if (e?.error?.data?.message) {
        msg = e.error.data.message.replace("execution reverted: ", "");
    } else if (e?.data?.message) {
        msg = e.data.message.replace("execution reverted: ", "");
    } else if (e?.message?.includes("execution reverted:")) {
        msg = e.message.split("execution reverted:")[1].trim();
    } else if (e?.message) {
        msg = e.message;
    }

    msg = msg.split("(")[0].trim();
    if (msg.length > 30) msg = msg.slice(0, 30) + "...";

    console.error("📛 Smart contract error:", e);
    alert(msg);
}

// ================================
//  유저 상태 표시
// ================================
let updateUserState = (() => {
    let totalReward = 0;
    let totalLoss = 0;

    return (amount, type) => {
        let amountFormatted = parseInt(amount);
        let stateElement = document.getElementById("userState");

        if (type === "reward") {
            totalReward += amountFormatted;
        } else if (type === "loss") {
            totalLoss += amountFormatted;
        }

        stateElement.innerText = `Your Reward: ${totalReward} GP | Your Loss: ${totalLoss} GP`;
    };
})();

// ================================
//  강아지 생성
// ================================
function createDog(team, index) {
    const dogWrapper = document.createElement('div');
    dogWrapper.className = 'dog-wrapper';

    const hpBar = document.createElement('div');
    hpBar.className = 'hp-bar';
    hpBar.style.width = '100%';

    const dogImg = document.createElement('img');
    dogImg.className = 'dog';
    dogImg.src = `/images/puppy/${index + 1}.png`;  // 1~10.png

    dogWrapper.appendChild(hpBar);
    dogWrapper.appendChild(dogImg);

    document.getElementById(team).appendChild(dogWrapper);
}

// 강아지 초기화
function initDogs() {
    document.getElementById('homeTeam').innerHTML = "";
    document.getElementById('awayTeam').innerHTML = "";

    for (let i = 0; i < 10; i++) {
        createDog('homeTeam', i);
        createDog('awayTeam', i);
    }
}
initDogs();

// ================================
// 전투 애니메이션
// ================================
function battleAnimation(homeScore, awayScore) {
    const homeDogs = document.querySelectorAll('#homeTeam .dog');
    const awayDogs = document.querySelectorAll('#awayTeam .dog');

     // 사운드 재생 (충돌)
    try {
        collisionSound.currentTime = 0;
        collisionSound.play();
    } catch (e) {
        console.warn("Collision sound error:", e.message);
    }

    // 양 팀 동시에 돌진 + 격돌 효과
    homeDogs.forEach(dog => {
        dog.classList.add('attack', 'home', 'collide');
        setTimeout(() => dog.classList.remove('attack', 'home', 'collide'), 1200);
    });

    awayDogs.forEach(dog => {
        dog.classList.add('attack', 'away', 'collide');
        setTimeout(() => dog.classList.remove('attack', 'away', 'collide'), 1200);
    });

    // HP 게이지 연출 (반대편 점수 기준)
    homeDogs.forEach(dog => dog.previousSibling.style.width = `${awayScore * 10}%`);
    awayDogs.forEach(dog => dog.previousSibling.style.width = `${homeScore * 10}%`);
}

// ================================
// 전투 결과 반영
// ================================
function battleResult(homeScore, awayScore) {
    const homeDogs = document.querySelectorAll('#homeTeam .dog-wrapper');
    const awayDogs = document.querySelectorAll('#awayTeam .dog-wrapper');

    // 홈팀: 점수만큼 생존, 나머지 쓰러짐
    updateFallenDogs(homeDogs, homeScore);

    // 어웨이팀: 점수만큼 생존, 나머지 쓰러짐
    updateFallenDogs(awayDogs, awayScore);

    // 2초 후 리셋
    setTimeout(() => {
        initDogs();
    }, 5000);
}

function updateFallenDogs(dogs, score) {
    // 점수만큼만 살리고 나머지는 회색 처리
    for (let i = 0; i < dogs.length; i++) {
        if (i < score) {
            dogs[i].classList.remove('fallen'); // 생존
        } else {
            dogs[i].classList.add('fallen');    // 쓰러짐
        }
    }
}




// ================================
//  play() 함수 실행
// ================================
let executePlayFunction = async (argument) => {
    try {
        let userProvider = new ethers.providers.Web3Provider(window.ethereum, "any");

        await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
                chainId: "0xCC",
                rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
                chainName: "opBNB",
                nativeCurrency: {
                    name: "BNB",
                    symbol: "BNB",
                    decimals: 18
                },
                blockExplorerUrls: ["https://opbnbscan.com"]
            }]
        });

        await userProvider.send("eth_requestAccounts", []);
        let signer = userProvider.getSigner();
        let soccerContract = new ethers.Contract(address2.soccerAddr, abi2.soccer, signer);

        const selectedValue = parseInt(document.getElementById('bettingAmount').value, 10);
        if (isNaN(selectedValue) || selectedValue <= 0) {
            alert("Please enter a valid betting amount!");
            return;
        }

        await soccerContract.play(argument, selectedValue);
    } catch (e) {
        handleContractError(e, "Unable to retrieve user information. Please check your connection.");
    }
};

// ================================
//  이벤트 리스너
// ================================
let userAddressGlobal = null;

async function initUser() {
    let userProvider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await userProvider.send("eth_requestAccounts", []);
    let signer = userProvider.getSigner();
    userAddressGlobal = (await signer.getAddress()).toLowerCase();
    return signer;
}
async function initEventListeners() {
    const signer = await initUser();
    const soccerContract = new ethers.Contract(address2.soccerAddr, abi2.soccer, signer);

    soccerContract.removeAllListeners();

    // 경기 결과 이벤트
    soccerContract.on("Result", (user, home, away) => {
        if (!userAddressGlobal || user.toLowerCase() !== userAddressGlobal) return;

        document.getElementById("eventS2").innerHTML = `
            <div class="result-box highlight">
                <span class="green">Home: ${home}</span> vs 
                <span class="red">Away: ${away}</span>
            </div>`;

        battleAnimation(home, away);

        setTimeout(() => battleResult(home, away), 1000);
    });

    // Reward 이벤트
    soccerContract.on("Reward", (user, amount) => {
        if (!userAddressGlobal || user.toLowerCase() !== userAddressGlobal) return;

        updateUserState(amount, "reward");

        const statusEl = document.getElementById("statusMessage");
        if (statusEl) {
            statusEl.innerHTML = `<span class="win">🎉 You Won! +${parseInt(amount)} GP</span>`;
        }
    });

    // Loss 이벤트
    soccerContract.on("Loss", (user, amount) => {
        if (!userAddressGlobal || user.toLowerCase() !== userAddressGlobal) return;

        updateUserState(amount, "loss");

        const statusEl = document.getElementById("statusMessage");
        if (statusEl) {
            statusEl.innerHTML = `<span class="lose">💔 You Lost! -${parseInt(amount)} GP</span>`;
        }
    });
}

// 상태 메시지 엘리먼트 없으면 자동 생성
function createStatusMessageEl() {
    const el = document.createElement("div");
    el.id = "statusMessage";
    document.body.appendChild(el);
    return el;
}



initEventListeners();

// ================================
//  버튼 연결
// ================================
document.getElementById("winButton").addEventListener("click", () => executePlayFunction(1));
document.getElementById("drawButton").addEventListener("click", () => executePlayFunction(2));
document.getElementById("loseButton").addEventListener("click", () => executePlayFunction(3));

// ================================
//  사운드 객체
// ================================
const collisionSound = new Audio('/sounds/bark.mp3'); // 충돌 소리
collisionSound.volume = 0.7;

