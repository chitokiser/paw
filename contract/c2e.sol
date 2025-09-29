// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

interface Ipaw {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface IpupBank {
    function depoup(address user, uint256 depo) external;
    function depodown(address user, uint256 depo) external;
    function getprice() external view returns (uint256);
    function getlevel(address user) external view returns (uint256);
    function g9(address user) external view returns (uint256);
    function getagent(address user) external view returns (address);
    function getmento(address user) external view returns (address);
    function expup(address user, uint256 exp) external;
}


contract c2e {
    Ipaw public paw;
    IpupBank public pupbank;
    address public admin;
    address public pbank;

    // C2E 멤버가 되기 위한 요구 레벨 (pupbank.getlevel(user)와 비교)
    uint256 public level;

    // 누적 인출 금액(PAW 단위, 18 decimals)
    uint256 public totalwithdraw;

    // 전체 C2E 멤버 수 및 인덱스 → 주소 매핑
    uint256 public mid; // 다음에 배정될 member index
    uint256 public cid; // 3~나머지 미션 수당요구 인덱스
    mapping(uint256 => address) public memberid;
    mapping(address => uint256) public ranking;

    // 마지막 인출 시각(쿨다운 체크)
    mapping(address => uint256) public allowt;

    // ---------- 광고(가격/구매내역) ----------
    // 광고 상품별 가격(18d)
    mapping(uint256 => uint256) public adprice;
    // 유저별 특정 광고상품에 대해 지불한 금액(누계)
    mapping(address => mapping(uint256 => uint256)) public adPaid;
    // 유저별 광고상품 마지막 결제 시각
    mapping(address => mapping(uint256 => uint256)) public adPurchasedAt;

    // 유저 상태
    struct my {
        uint256 mypay;     // 미션/검증을 통해 적립한 인출 가능 포인트(PAW 단위, 18d)
        uint256 totalpay;  // 누적 인출 완료 합계
        uint256 allow;     // 추천/멘토 수당(포인트, PAW 단위, 18d)
        uint256 rating;    // 신용 점수: 0~100 (초기 100 권장)
        bool white;        // 화이트 멤버(미션1 완료)
        bool blacklisted;  // 블랙리스트
    }

    mapping(address => my) public myinfo;

    // 운영/스태프 권한 (>=5면 스태프)
    mapping(address => uint8) public staff;

    
     //패일리 스마트계약인가 여부 판단
       mapping(address => uint8) public fa;

    // 유저의 미션별 페이 요구 현황
    mapping(address => mapping(uint256 => bool)) public claim2;
    mapping(address => mapping(uint256 => bool)) public claim3;
    mapping(address => mapping(uint256 => bool)) public claim4; //요구 처리 현황
    mapping(uint256 => mapping(address =>uint256))public claim44; //cid를 키값으로 해서 주소 및 미션번호
 
    // ---------- 이벤트 ----------
    event PaySet(uint256 indexed missionId, uint256 amount);
    event Mission1Joined(address indexed user, uint256 indexed memberIndex);
    event ClaimRequested(address indexed user, uint256 indexed missionId, uint8 kind);
    event ClaimResolved(address indexed user, uint256 indexed missionId, uint8 grade, uint256 reward);
    event Withdrawn(address indexed user, uint256 netAmount);
    event StaffUpdated(address indexed account, uint8 level);
    event LevelUpdated(uint256 newRequiredLevel);
    event BlacklistUpdated(address indexed user, bool blacklisted);
    event Funded(address indexed from, uint256 amount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event AdPriceSet(uint256 indexed adId, uint256 price);
    event AdPurchased(address indexed user, uint256 indexed adId, uint256 price, uint256 paidNow);

    // ---------- 모디파이어 ----------
    modifier onlyOwner() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyStaff() {
        require(staff[msg.sender] >= 5, "Not staff");
        _;
    }

    // 간단한 재진입 방지 락
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "Reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    // 인출 쿨다운(기본 1일)
    uint256 public withdrawCooldown = 1 days;

    constructor(address _pupbank, address _paw) {
        paw = Ipaw(_paw);
        pupbank = IpupBank(_pupbank);
        admin = msg.sender;
        staff[msg.sender] = 10; // 배포자 최고 권한
        level = 1;              // 기본 요구 레벨 = 1
        pbank = _pupbank;
    }

    // ---------- 운영 함수 ----------

   
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero addr");
        emit OwnershipTransferred(admin, newOwner);
        admin = newOwner;
    }

    function setStaff(address account, uint8 lvl) external onlyOwner {
        staff[account] = lvl;
        emit StaffUpdated(account, lvl);
    }

    function setRequiredLevel(uint256 newLevel) external onlyOwner {
        level = newLevel;
        emit LevelUpdated(newLevel);
    }

    function setBlacklist(address user, bool b) external onlyOwner {
        myinfo[user].blacklisted = b;
        emit BlacklistUpdated(user, b);
    }

    function setWithdrawCooldown(uint256 seconds_) external onlyOwner {
        withdrawCooldown = seconds_;
    }

    // 컨트랙트에 PAW 재원 적립(운영자 지갑에서 pull)
    function fund(uint256 amount) external onlyOwner {
        require(paw.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Funded(msg.sender, amount);
    }
    // 컨트랙트에 PAW 재원 적립(운영자 지갑에서 pull)
    function PawTransfer(uint256 amount) external onlyOwner {
    paw.transfer(pbank, amount);
     
    }


    // 광고 가격 설정(단건/배치)
    function setAdPrice(uint256 adId, uint256 price) external onlyStaff {
        adprice[adId] = price;
        emit AdPriceSet(adId, price);
    }
   
    // 패밀리 여부
    function setfa(address _fa) external onlyStaff {
        fa[_fa] = 5;
     
    }

    function batchSetAdPrice(uint256[] calldata adIds, uint256[] calldata prices) external onlyStaff {
        require(adIds.length == prices.length, "len mismatch");
        for (uint256 i = 0; i < adIds.length; i++) {
            adprice[adIds[i]] = prices[i];
            emit AdPriceSet(adIds[i], prices[i]);
        }
    }

    // 뱅크에게 매출 10% 이체 
  
    function SetAdprice(uint256 _id, uint256 _pay) external onlyStaff {
        adprice[_id] = _pay; // 18 decimals 그대로 받음
    }

    //notice 미션1: 레벨 검증 후 화이트 멤버 등록

    function m1(address _user) public onlyStaff {
        require(pupbank.getlevel(_user) >= level, "Level not enough");
        require(myinfo[_user].white == false, "Already a white member");

        myinfo[_user].white = true;
        if (myinfo[_user].rating == 0) {
            // 초기 진입 시 신용점수 100 부여
            myinfo[_user].rating = 100;
        }

        memberid[mid] = _user;
        emit Mission1Joined(_user, mid);
        mid += 1;
    }

   
  
    function claimpay2(uint256 missionId) external {   //미션2 블로그 등록 보상
        require(myinfo[msg.sender].white, "Join first");
        require(!myinfo[msg.sender].blacklisted, "Blacklisted");
        require(myinfo[msg.sender].rating >= 10, "Low rating");
        require(claim2[msg.sender][missionId] == false, "Already requested");

        claim2[msg.sender][missionId] = true;
        emit ClaimRequested(msg.sender, missionId, 2);
    }

   
    function claimpay3(uint256 missionId) external {  //미션3 SNS등록 보상
        require(myinfo[msg.sender].white, "Join first");
        require(!myinfo[msg.sender].blacklisted, "Blacklisted");
        require(myinfo[msg.sender].rating >= 10, "Low rating");
        require(claim3[msg.sender][missionId] == false, "Already requested");

        claim3[msg.sender][missionId] = true;
        emit ClaimRequested(msg.sender, missionId, 3);
    }
    

    
    function claimpay4(uint256 missionId) external { //매일보상 
        require(!myinfo[msg.sender].blacklisted, "Blacklisted");
        require(myinfo[msg.sender].rating >= 10, "Low rating");
        require(claim4[msg.sender][missionId] == false , "Already requested");

        claim4[msg.sender][missionId] = true;
        claim44[cid][msg.sender] = missionId;
        cid += 1;
        emit ClaimRequested(msg.sender, missionId, 4);
    }

    function resolveClaim2(address user, uint256 missionId, uint8 grade) external onlyStaff {
        require(claim2[user][missionId] == true, "No pending claim");
        require(grade <= 100, "grade>100");
        uint256 base = adprice[missionId];
        require(base > 0, "No pay set");

        // 등급에 따른 보상(예: 80점 => 80%)
        uint256 reward = (base * grade) / 100;

        // 적립(인출 가능 포인트)
        myinfo[user].mypay += reward;

        // 클레임 완료 처리
        claim2[user][missionId] = false;

        // 신용 점수 보정: 50 미만 감점, 50 초과 가점 (0~100 클램프)
        uint256 r = myinfo[user].rating;
        if (grade < 50) {
            uint256 penalty = 50 - grade;
            r = (r > penalty) ? (r - penalty) : 0;
        } else if (grade > 50) {
            uint256 bonus = grade - 50;
            r = r + bonus;
            if (r > 100) r = 100;
        }
        myinfo[user].rating = r;
        emit ClaimResolved(user, missionId, grade, reward);
    }


        function resolveClaim3(address user, uint256 missionId, uint8 grade) external onlyStaff {
        require(claim3[user][missionId] == true, "No pending claim");
        require(grade <= 100, "grade>100");
        uint256 base = adprice[missionId];
        require(base > 0, "No pay set");

        // 등급에 따른 보상(예: 80점 => 80%)
        uint256 reward = (base * grade) / 100;

        // 적립(인출 가능 포인트)
        myinfo[user].mypay += reward;

        // 클레임 완료 처리
        claim3[user][missionId] = false;

        // 신용 점수 보정: 50 미만 감점, 50 초과 가점 (0~100 클램프)
        uint256 r = myinfo[user].rating;
        if (grade < 50) {
            uint256 penalty = 50 - grade;
            r = (r > penalty) ? (r - penalty) : 0;
        } else if (grade > 50) {
            uint256 bonus = grade - 50;
            r = r + bonus;
            if (r > 100) r = 100;
        }
        myinfo[user].rating = r;
        emit ClaimResolved(user, missionId, grade, reward);
    }
   

       function resolveClaim4(address user, uint256 missionId, uint8 grade) external onlyStaff {
        require(claim4[user][missionId] == true, "No pending claim");  //타
        require(grade <= 100, "grade>100");
        uint256 base = adprice[missionId];
        require(base > 0, "No pay set");

        // 등급에 따른 보상(예: 80점 => 80%)
        uint256 reward = (base * grade) / 100;

        // 적립(인출 가능 포인트)
        myinfo[user].mypay += reward;

        // 클레임 완료 처리
        claim4[user][missionId] = false;

        // 신용 점수 보정: 50 미만 감점, 50 초과 가점 (0~100 클램프)
        uint256 r = myinfo[user].rating;
        if (grade < 50) {
            uint256 penalty = 50 - grade;
            r = (r > penalty) ? (r - penalty) : 0;
        } else if (grade > 50) {
            uint256 bonus = grade - 50;
            r = r + bonus;
            if (r > 100) r = 100;
        }
        myinfo[user].rating = r;
        emit ClaimResolved(user, missionId, grade, reward);
    }


    function withdraw() external nonReentrant {
        require(!myinfo[msg.sender].blacklisted, "Blacklisted");

        // 쿨다운 체크
        uint256 last = allowt[msg.sender];
        require(block.timestamp >= last + withdrawCooldown, "Cooldown");

        // 최소 인출 한도(10 토큰)
        uint256 threshold = 10 * 1e18;

        uint256 mypay_ = myinfo[msg.sender].mypay;
        uint256 allow_ = myinfo[msg.sender].allow;
        uint256 amount = mypay_ + allow_;
        require(amount >= threshold, "Collect more");

        // 컨트랙트 보유 토큰 확인
        require(paw.balanceOf(address(this)) >= amount, "Insufficient PAW pool");

        // 내부 장부 정리(재진입 대비)
        myinfo[msg.sender].totalpay += amount;
        myinfo[msg.sender].mypay = 0;
        myinfo[msg.sender].allow = 0;
        totalwithdraw += amount;
        allowt[msg.sender] = block.timestamp;
        ranking[msg.sender] += amount;

        // 멘토 추천 수당(10%)은 "멘토의 allow 포인트"로 적립 (즉시 전송 X)
        address mentor = pupbank.getmento(msg.sender);
        if (mentor != address(0)) {
            uint256 mentorCut = (amount * 10) / 100;
            myinfo[mentor].allow += mentorCut;
        }

        // 실제 토큰 송금
        require(paw.transfer(msg.sender, amount), "PAW transfer failed");
        emit Withdrawn(msg.sender, amount);
    }
     
     //외부호출에 의한 mypoint up 
    function mypayup(address user,uint _pay)public {
    require(fa[msg.sender] >=5, "no family");
    myinfo[user].mypay += _pay;

    }
    // ---------- 뷰/헬퍼 ----------
    function getlevel(address user) external view returns (uint256) {
        return pupbank.getlevel(user);
    }

    function g1() public view returns (uint256) {
        return paw.balanceOf(address(this));
    }

    function g2(address user) public view returns (uint256) {
        return paw.balanceOf(user);
    }

    function availableToWithdraw(address user) external view returns (uint256) {
        return myinfo[user].mypay + myinfo[user].allow;
    }

       function isClaimPending2(address user, uint256 missionId) external view returns (bool) {
        return claim2[user][missionId];
    }
        function isClaimPending3(address user, uint256 missionId) external view returns (bool) {
        return claim3[user][missionId];
    }

        function isClaimPending4(address user, uint256 missionId) external view returns (bool) {
        return claim4[user][missionId];
    }

    function adInfo(address user, uint256 adId) external view returns (uint256 paid, uint256 lastTs, uint256 price) {
        return (adPaid[user][adId], adPurchasedAt[user][adId], adprice[adId]);
    }
}
