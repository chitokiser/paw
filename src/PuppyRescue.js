const RESCUE_ADDR = "0x2b146a659883474fa651022222A5dBF523b7bcFA"; // 컨트랙트 주소
const RESCUE_ABI = [
  "function play() external",
  "function claimReward(uint256 nonce, bytes signature) external",
  "function nonces(address) view returns(uint256)",
  "event GameStarted(address indexed user, uint256 pay, uint256 nonce)",
  "event GameRewarded(address indexed user, uint256 reward)"
];

let provider, signer, rescueRead, rescueWrite;
let currentNonce = null;

// 게임 전역 변수
let score = 0;
let snake = [];
let direction = null;
let food = {};
let watchers = [];
let gameInterval = null; // 초기화
const MISSION_TARGET = 10;

// ---------------- 지갑 연결 ----------------
async function connectWallet() {
  if (!window.ethereum) {
    alert("메타마스크 설치 필요!");
    return;
  }
  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  rescueRead = new ethers.Contract(RESCUE_ADDR, RESCUE_ABI, provider);
  rescueWrite = new ethers.Contract(RESCUE_ADDR, RESCUE_ABI, signer);
  console.log("지갑 연결됨:", await signer.getAddress());
}

// ---------------- 게임 시작 ----------------
async function startRescueGame() {
  await connectWallet();

  try {
    const tx = await rescueWrite.play();
    console.log("TX 전송:", tx.hash);
    const receipt = await tx.wait();

    // 이벤트 파싱 → nonce 추출
    const iface = new ethers.utils.Interface(RESCUE_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === "GameStarted") {
          currentNonce = parsed.args.nonce.toString();
          console.log("Nonce 확보:", currentNonce);
        }
      } catch {}
    }

    // nonce 확보 후 게임 시작
    loadImages(startGame);

  } catch (err) {
    alert("게임 시작 실패: " + err.message);
  }
}

// ---------------- 보상 요청 ----------------
async function requestReward() {
  if (!currentNonce) {
    alert("게임 세션이 유효하지 않습니다.");
    return;
  }

  const user = await signer.getAddress();

  // 서버 API 요청 → 서명 가져오기
  const response = await fetch("/api/signReward", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, nonce: currentNonce, contract: RESCUE_ADDR })
  });

  const { signature } = await response.json();

  try {
    const tx = await rescueWrite.claimReward(currentNonce, signature);
    console.log("보상 TX:", tx.hash);
    await tx.wait();
    alert("보상 지급 완료!");
  } catch (err) {
    alert("보상 요청 실패: " + err.message);
  }
}

// ---------------- 게임 종료 ----------------
function endGame(msg) {
  clearInterval(gameInterval);
  alert(msg);

  // 미션 성공 시 보상 요청
  if (msg.includes("Mission success")) {
    requestReward();
  }

  document.getElementById("restartBtn").style.display = "block";
}

// ---------------- 게임 로직 (Snake) ----------------
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
let box = 20;

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function resizeCanvas() {
  const size = Math.min(window.innerWidth * 0.9, 400);
  canvas.width = size;
  canvas.height = size;
  box = size / 20;
}

// 초기화
let selectedSkin = localStorage.getItem("dogSkin") || "1";
document.getElementById("skinSelect").value = selectedSkin;

const dogHead = new Image();
const rescueDog = new Image();
const watcherImg = new Image();
const dogBodies = [];

function loadHeadImage() {
  dogHead.src = `/images/dogs/${selectedSkin}.png`;
}

function loadImages(callback) {
  loadHeadImage();
  rescueDog.src = `/images/dogs/rescue.png`;
  watcherImg.src = `/images/dogs/watcher.png`;
  dogBodies.length = 0;
  for (let i = 1; i <= 10; i++) {
    const img = new Image();
    img.src = `/images/dogs/body_${i}.png`;
    dogBodies.push(img);
  }
  setTimeout(callback, 200);
}

document.getElementById("skinSelect").addEventListener("change", e => {
  selectedSkin = e.target.value;
  localStorage.setItem("dogSkin", selectedSkin);
  loadHeadImage();
});

// 방향키 이벤트
document.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft" && direction !== "RIGHT") direction = "LEFT";
  else if (e.key === "ArrowUp" && direction !== "DOWN") direction = "UP";
  else if (e.key === "ArrowRight" && direction !== "LEFT") direction = "RIGHT";
  else if (e.key === "ArrowDown" && direction !== "UP") direction = "DOWN";
});

// 터치 이벤트
let touchStartX = 0, touchStartY = 0;
canvas.addEventListener("touchstart", e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
});
canvas.addEventListener("touchend", e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0 && direction !== "LEFT") direction = "RIGHT";
    else if (dx < 0 && direction !== "RIGHT") direction = "LEFT";
  } else {
    if (dy > 0 && direction !== "UP") direction = "DOWN";
    else if (dy < 0 && direction !== "DOWN") direction = "UP";
  }
});

// 방향 버튼 클릭
function setDirection(dir) {
  if (dir === "LEFT" && direction !== "RIGHT") direction = "LEFT";
  else if (dir === "UP" && direction !== "DOWN") direction = "UP";
  else if (dir === "RIGHT" && direction !== "LEFT") direction = "RIGHT";
  else if (dir === "DOWN" && direction !== "UP") direction = "DOWN";
}

// 게임 시작
function startGame() {
  score = 0;
  snake = [{ x: 9 * box, y: 9 * box }];
  direction = null;
  watchers = [];
  placeFood();
  document.getElementById("scoreboard").textContent = `Number of puppies saved: 0`;
  document.getElementById("restartBtn").style.display = "none";
  clearInterval(gameInterval);
  gameInterval = setInterval(draw, 120);
  draw();
}

// 먹이 배치
function placeFood() {
  let valid = false;
  while (!valid) {
    const pos = { x: Math.floor(Math.random() * 20) * box, y: Math.floor(Math.random() * 20) * box };
    if (!snake.some(s => s.x === pos.x && s.y === pos.y) && !watchers.some(w => w.x === pos.x && w.y === pos.y)) {
      food = pos;
      valid = true;
    }
  }
}

// 감시자 추가
function addWatcher() {
  let valid = false;
  while (!valid) {
    const pos = { x: Math.floor(Math.random() * 20) * box, y: Math.floor(Math.random() * 20) * box };
    if (!snake.some(s => s.x === pos.x && s.y === pos.y) && !(pos.x === food.x && pos.y === food.y) && !watchers.some(w => w.x === pos.x && w.y === pos.y)) {
      watchers.push(pos);
      valid = true;
    }
  }
}

// 그리기
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(dogHead, snake[0].x, snake[0].y, box, box);
  for (let i = 1; i < snake.length; i++) {
    ctx.drawImage(dogBodies[i % dogBodies.length], snake[i].x, snake[i].y, box, box);
  }
  ctx.drawImage(rescueDog, food.x, food.y, box, box);
  watchers.forEach(w => ctx.drawImage(watcherImg, w.x, w.y, box, box));

  if (!direction) return;

  const nx = snake[0].x + (direction === "LEFT" ? -box : direction === "RIGHT" ? box : 0);
  const ny = snake[0].y + (direction === "UP" ? -box : direction === "DOWN" ? box : 0);

  if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height || snake.some(s => s.x === nx && s.y === ny)) {
    endGame(`벽이나 몸에 부딪힘! 총 ${score}마리 구조`);
    return;
  }

  if (watchers.some(w => w.x === nx && w.y === ny)) {
    endGame('Caught by the watcher! Game over');
    return;
  }

  if (nx === food.x && ny === food.y) {
    score++;
    document.getElementById("scoreboard").textContent = `Number of puppies saved: ${score}`;
    playBarkSound();
    flashEffect();
    addWatcher();
    if (score >= MISSION_TARGET) {
      endGame(`Mission success! ${MISSION_TARGET} rescue completed!`);
      return;
    }
    placeFood();
  } else {
    snake.pop();
  }
  snake.unshift({ x: nx, y: ny });
}

// 사운드
function playBarkSound() {
  const bark = new Audio('/sounds/bark.mp3');
  bark.play();
}

// 플래시 효과
function flashEffect() {
  const flash = document.getElementById('flashOverlay');
  flash.style.display = 'block';
  flash.style.opacity = 0.8;
  setTimeout(() => {
    flash.style.opacity = 0;
    setTimeout(() => { flash.style.display = 'none'; }, 200);
  }, 100);
}

// 버튼 이벤트
document.getElementById("startBtn").addEventListener("click", startRescueGame);
document.getElementById("restartBtn").addEventListener("click", () => loadImages(startGame));

// 초기 이미지 로드
loadImages(() => {});
