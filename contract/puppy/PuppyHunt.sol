// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

// ====== 외부 컨트랙트 인터페이스 ======
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


interface IPuppypup {
  function bt() external view returns (uint8);
    function myPuppyid(address user) external view returns (uint);
    function myPuppy(address user) external view returns (uint);
    function geti(uint pid) external view returns (uint16);
    function getc(uint pid) external view returns (uint16);
    function gets(uint pid) external view returns (uint16);
    function geta(uint pid) external view returns (uint16);
    function gete(uint pid) external view returns (uint16);
    function getf(uint pid) external view returns (uint16);
    function setowner(address _user,uint _pid) external;
    function setBattleExp(uint _pid) external;
    function setBreed(uint _pid,uint256 _breed ) external;
}

// ====== 강아지 헌터(PuppyHunter) 메인 컨트랙트 ======
contract PuppyHunter {

    // 외부 컨트랙트 참조(초기 세팅 필요)
    IPuppypup public puppy;
    IpupBank public pupbank;

    address public admin;          // 관리자 주소
    uint16 public denominator;     // 보너스 계산용 분모(기본 1000)
    uint256 public jack;           // 전체 잭팟 상금(GP)
    uint256 public pay;            // 1회 사냥 참가비 (예: 1e18)
    mapping(address => MyHunter) public myprey; // 유저별 사냥 데이터

    // ====== 주요 게임 이벤트 ======
    event Bonus(address indexed user, uint256 amount, uint256 reward);      // 보너스 지급(누구, 액수, 능력치값)
    event RewardGiven(address indexed user, uint8 amount, uint8 kind); // 사냥 결과(누구, 마릿수, 사냥종, 
    event getdepo(uint256 pay);                                             // 사냥감 일괄 판매(잭팟 등)
    event Sp(uint256 pay);                          //스페샬
    // ====== 사냥 정보 구조체 ======                                       
    struct MyHunter {
        uint[5] prey;   // 5종류 사냥감 개수 (누적)
        uint8 sp;       // 스페셜 아이템 개수
        address owner;  // (옵션, 실제 사용X)
    }

    // ====== 생성자 ======
    constructor(address _puppy, address _pupbank) {
        puppy = IPuppypup(_puppy);
        pupbank = IpupBank(_pupbank);
        denominator = 1000;    // 보너스 분모 초기값
        pay = 100;            // 1회 사냥 참가비(GP) 기본값
        admin = msg.sender;
        jack = 500000;
    }

    // ====== 관리자만 실행 가능한 modifier ======
    modifier onlyOwner() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    // ====== 관리자용 관리 함수들 ======
    function setDenominator(uint16 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        denominator = _value;
    }

    function setPay(uint256 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        pay = _value ;
    }

    function setjack(uint16 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        jack = uint256(_value) ;
    }

    // ====== 사냥 메인 함수 ======
    function Hunting() external {
        require(puppy.myPuppy(msg.sender) != 0, "No Puppy");         // 강아지 없으면 불가
        require(g9(msg.sender) >= pay, "Not enough game points"); // GP 부족

        uint8 kind = ran();          // 0~4 사냥감 종류
        uint8 amount = ran2();       // 0~9 마릿수
        uint mypid = puppy.myPuppyid(msg.sender);
        pupbank.depodown(msg.sender, pay);                      // GP 차감
        pupbank.expup(msg.sender, pay);           // 소량 경험치
        jack += pay;                                     // 참가비는 잭팟 누적
         emit RewardGiven(msg.sender, amount, kind);
        myprey[msg.sender].prey[kind] += amount;         // 누적
        // 스페셜 조건: 종류==마릿수(랜덤이 같으면)
        if(kind == amount){  //곰을 잡으면
            myprey[msg.sender].sp += kind;
            puppy.setBattleExp(mypid);  //배틀경험치 상스
        }
        emit Sp(kind);
    }

    // ====== 사냥감 일괄 판매(5종 모두 10개 이상 보유 필요) ======
    function sellprey() public {
        uint[5] storage preyArr = myprey[msg.sender].prey;
        for (uint8 i = 0; i < 5; i++) {
            require(preyArr[i] >= 10, "Requires 10 or more of each prey");
        }
        // 보상 지급 & 사냥감 차감
        for (uint8 i = 0; i < 5; i++) {
            preyArr[i] -= 10;
        }
        uint256 reward = getreward();
        pupbank.depoup(msg.sender,reward); 
        jack -= reward;
        bonus(msg.sender, reward);
        emit getdepo(reward);
    }

    // ====== 곰 보상 인출(10개 이상) ======
    function spWithdraw() public {
        require(myprey[msg.sender].sp >= 10, "Special items are lacking");
        myprey[msg.sender].sp -= 10;
        uint256 reward = getjack(msg.sender);
        pupbank.depoup(msg.sender,reward); 
        jack -= reward;
        emit getdepo(reward);
    }

    // ====== 강아지 능력치 중 하나로 추가 GP 지급 ======
    function bonus(address user, uint256 rewardInput) internal {
        uint pid = puppy.myPuppyid(user);
        uint8 rewardType = ran2(); // 0~5
        uint256 statReward;
        if (rewardType == 0)      { statReward = puppy.geti(pid); }
        else if (rewardType == 1) { statReward = puppy.getc(pid); }
        else if (rewardType == 2) { statReward = puppy.gets(pid); }
        else if (rewardType == 3) { statReward = puppy.geta(pid); }
        else if (rewardType == 4) { statReward = puppy.gete(pid); }
        else                      { statReward = puppy.getf(pid); }
        uint256 amount = statReward * rewardInput / denominator;
       pupbank.depoup(msg.sender,amount); 
        jack -= amount;
        emit Bonus(user, amount, statReward);
    }

    // ====== 사냥감 종류 랜덤(0~4) ======
    function ran() public view returns (uint8) {
        uint256 rand = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    block.timestamp,
                    block.number,
                    gasleft()
                )
            )
        );
        return uint8(rand % 5); // 0~4
    }

    // ====== 사냥 마릿수 랜덤(0~9) ======
    function ran2() public view returns (uint8) {
        uint256 rand = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    block.timestamp,
                    block.number,
                    gasleft()
                )
            )
        );
        return uint8(rand % 10);
    }
   
    // ====== 잭팟/사냥 보상 관련 ======
    function getprey1() public view returns (uint256) { return jack / 5000; }
    function getprey2() public view returns (uint256) { return jack / 4000; }
    function getprey3() public view returns (uint256) { return jack / 3000; }
    function getprey4() public view returns (uint256) { return jack / 2000; }
    function getprey5() public view returns (uint256) { return jack / 1000; }

    // ====== 외부 참조용 (강아지/보상) ======
    function getmypuppy(address user) external view returns (uint) {
        return puppy.myPuppy(user);
    }

  function getjack(address user) public view returns (uint256) {
    if (jack == 0) return 0;
    uint256 level = pupbank.getlevel(user);
    uint256 prize = (jack * level / 100);
    return prize;
}

    function getreward() public view returns (uint256) {
        if (jack == 0) return 0;
        uint256 prize = getprey1() + getprey2() + getprey3() + getprey4() + getprey5();
        return prize;
    }

     // ====== myprey 구조체 내부 값 각각 반환용 public 함수 ======

    // 1. 사냥감 배열 전체 반환 (uint[5])
    function getPreyArr(address user) public view returns (uint[5] memory) {
        return myprey[user].prey;
    }

    // 2. 스페셜 아이템 개수 반환 (uint8)
    function getSp(address user) public view returns (uint8) {
        return myprey[user].sp;
    }

    // 3. owner 주소 반환 (address)
    function getMyPreyOwner(address user) public view returns (address) {
        return myprey[user].owner;
    }

    // 4. 특정 인덱스 사냥감 개수(토끼/너구리/...) 단일 반환 (선택사항)
    function getPreyAt(address user, uint8 idx) public view returns (uint) {
        require(idx < 5, "invalid index");
        return myprey[user].prey[idx];
    }

         function getmypuppy() public view returns (uint256) { //나의 견종
        return puppy.myPuppy(msg.sender);
    }

     function g9(address user) public view virtual returns(uint256){  
    return pupbank.g9(user);
  }
}
