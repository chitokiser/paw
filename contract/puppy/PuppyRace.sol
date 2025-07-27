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
    function myPuppy(address user) external view returns (uint8);
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

// ====== 강아지 레이스 메인 컨트랙트 ======
contract PuppyRace {

    // 외부 컨트랙트 참조(초기 세팅 필요)
    IPuppypup public puppy;
    IpupBank public pupbank;

    address public admin;          // 관리자 주소
    uint16 public denominator;     // 보너스 계산용 분모(기본 1000)
    uint256 public jack;           // 전체 잭팟 상금(GP)
    address[] public winner;

    // ====== 주요 게임 이벤트 ======
    event lost(uint256 amount, uint256 myPower);                           // 패배 시(GP 소멸, 등수 전달)
    event Bonus(address indexed user, uint256 amount, uint256 reward);     // 보너스 지급(누구, 액수, 능력치값)
    event RewardGiven(address indexed user, uint256 amount, uint256 myPower); // 승리 시(누구, GP, 등수)
    event getdepo(uint256 pay);                                            // (예비용, 사용안함)

    // ====== 생성자 ======
    constructor(address _puppy, address _pupbank) {
        puppy = IPuppypup(_puppy);
 
        pupbank = IpupBank(_pupbank);
        denominator = 1000;    // 보너스 분모 초기값
        admin = msg.sender;
        jack = 1000000;
    }

    // ====== 관리자만 실행 가능한 modifier ======
    modifier onlyOwner() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    // ====== 관리자용 관리 함수들 ======

    // 보너스 계산 분모 변경(기본: 1000)
    function setDenominator(uint16 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        denominator = _value;
    }

    // 잭팟 상금 직접 세팅(관리자만, 단위: GP)
    function setjack(uint256 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        jack = uint256(_value) ;
    }

    // ====== 메인 레이스(참여 및 결산) ======
function Race(uint pay) external {
    uint pid = puppy.myPuppyid(msg.sender);
    require(puppy.myPuppy(msg.sender) != 0, "No Puppy");              // 강아지 없으면 참여 불가
    require(getreward() >= pay, "The amount is too large");           // 잭팟이 적으면 불가
    require(pupbank.g9(msg.sender) >= pay, "Not enough game points");      // GP 부족

    uint256 myrank = ran(); // 1~bt 중 하나(등수 랜덤)
    // 2) 민첩성 기반 보정
    uint256 agility = puppy.geta(pid);       // 민첩성 값
    uint256 reduction = agility / 100;       // 100 민첩당 1등 보정
    if (reduction > 5) reduction = 5;        // 최대 보정치 5등
    if (myrank > reduction) {
        myrank -= reduction;                 // 순위 상승
    } else {
        myrank = 1;                          // 최소 1등
    }
    if (myrank > 8) {
        // 8등 이하 (패배)
        pupbank.depodown(msg.sender, pay);
        pupbank.expup(msg.sender, pay);
        jack += pay;
        emit lost(pay, myrank);
        
    } else if (myrank == 1) {
        // 1등 (winner 등록)
        uint256 amount = getreward() / myrank;
       
        pupbank.depoup(msg.sender, amount);
        jack -= amount;
        bonus(msg.sender, pay);
        winner.push(msg.sender); // 1등 명단 저장
        puppy.setBattleExp(pid) ;
        emit RewardGiven(msg.sender, amount, myrank);
    } else if (myrank >= 2 && myrank <= 8) {
        // 2~8등 (일반 승리)
        uint256 amount2 = getreward() / myrank;
         pupbank.depoup(msg.sender, amount2);
        jack -= amount2;
        bonus(msg.sender, pay);
        emit RewardGiven(msg.sender, amount2, myrank);
    }
}


    function bonus(address user, uint256 pay) internal {
        uint pid = puppy.myPuppyid(user);
        uint8 rewardType = ran2(); // 능력치 종류 랜덤(0~5)
        uint256 reward;
        if (rewardType == 0)      { reward = puppy.geti(pid); }
        else if (rewardType == 1) { reward = puppy.getc(pid); }
        else if (rewardType == 2) { reward = puppy.gets(pid); }
        else if (rewardType == 3) { reward = puppy.geta(pid); }
        else if (rewardType == 4) { reward = puppy.gete(pid); }
        else                      { reward = puppy.getf(pid); }
        uint256 amount = getlevel(user)*reward * pay / denominator; 
        pupbank.depoup(user, amount);    // GP 지급
        jack -= amount;           // 잭팟 차감
        emit Bonus(user, amount, reward);
    }

    // ====== 1~bt 중 하나 랜덤(등수 산출용) ======
    function ran() public view returns (uint8) {
        uint256 rand = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,  // 랜덤소스
                    block.timestamp,
                    block.number,
                    gasleft()
                )
            )
        );
        uint8 bt = puppy.bt(); // 전체 경주마 수(예: 60)
        return uint8(rand % bt + 1); // 1~bt (0불가)
    }

    // ====== 0~5 중 하나 랜덤(보너스 능력치 종류) ======
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
        return uint8(rand % 6);
    }

    // ====== Puppy 컨트랙트 래퍼(외부 데이터 조회) ======
    function getbt() external view returns (uint8) {
        return puppy.bt();
    }
    function getmypuppy(address user) external view returns (uint8) {
        return puppy.myPuppy(user);
    }
    function getmyPuppyid(address user) external view returns (uint) {
        return puppy.myPuppyid(user);
    }
    // ====== 레이스 승리 상금(기본: 잭팟 1/100, 없으면 0) ======
    function getreward() public view returns (uint256) {
        if (jack == 0) return 0;
        uint256 prize = (jack / 100);
        return prize;
    }
    
     function getlevel(address user) public view returns (uint256) {
        return pupbank.getlevel(user);
    }
}
