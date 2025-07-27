// SPDX-License-Identifier: MIT  
pragma solidity >=0.7.0 <0.9.0;

// 외부 컨트랙트 인터페이스 선언 (수정 없음)
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



interface IWithPuppy {
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

// 메인 배틀 컨트랙트
contract PuppyBattle {
 

    IWithPuppy public puppy;
    IpupBank public pupbank;
    address public admin;
    uint8 public bpid;           // 등록 가능한 총 챔피언 마리 수(예: 10)
    uint16 public denominator;   //보너스 계산 분모
    uint256 public pay;          // 한 번 도전시 소모하는 GP
    uint256 public jack;         // 총 잭팟 상금
    mapping(uint8 => bp) public bps; // 챔피언 강아지 슬롯(최대 bpid)

    // 이벤트 선언
    event lost(uint256 amount,uint256 myPower);
    event Bonus(address indexed user, uint256 amount, uint256 reward);
    event RewardGiven(address indexed user, uint256 amount, uint256 myPower);
    event getdepo(uint256 pay);

    // 컨트랙트 생성자
    constructor(address _puppy, address _pupbank) {
        puppy = IWithPuppy(_puppy);
        pupbank = IpupBank(_pupbank);
        denominator = 1000;
        admin = msg.sender;
        pay = 100;
        bpid = 10;
        
    }
   // 배틀 강아지 구조체 (Battle Puppy)
    struct bp {
        uint256 mybreed;          // 품종
        uint256 depo;        // 누적 상금(분배용)
        uint256 power;       // 강아지 파워 (챔피언에 등록된 값)
        address owner;       // 오너(도전자 승리시 등록됨)
        uint8 defense;       // 방어성공
    }

    // 어드민 한정 modifier
    modifier onlyOwner() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    // 배율/상금/등록 마리수 설정 함수들 (어드민)
    function setDenominator(uint16 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        denominator = _value;
    }
        function setbpid(uint8 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        bpid = _value;
    }


    function setpay(uint16 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        pay = uint256(_value);
    }

    function setjack(uint16 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        jack = uint256(_value) ;
    }


    // === 메인 배틀 로직 ===
    function Battle(uint8 _pid) external {
        require(_pid < bpid, "Out of range"); // 0~9번 슬롯
         require(bps[_pid].owner != msg.sender, "You can't challenge yourself"); 
        require(puppy.myPuppy(msg.sender) != 0, "No Puppy");
        require(g9(msg.sender) >= pay, "GP < pay");

      
        uint mypid = puppy.myPuppyid(msg.sender);
        uint256 mypower = getmypower(mypid); // 나의 강아지 파워 계산(랜덤 가미)
        uint256 enemy = bps[_pid].power;     // 챔피언의 파워
       
        if (enemy > mypower) {
            // 패배: 도전비 소모, 경험치 지급, 잭팟에 적립
            pupbank.depodown(msg.sender, pay);
            pupbank.expup(msg.sender, pay);
            jack += pay;
            bps[_pid].defense += 1;
            emit lost(pay,mypower);
        } else {
            // 승리: GP 보상, 잭팟 차감, 보너스 지급, 챔피언 교체
            uint256 amount = getreward();
            pupbank.depoup(msg.sender, amount);
            jack -= amount;
            bonus(msg.sender);

            // 챔피언 교체(슬롯 갱신)
            uint breed = puppy.myPuppy(msg.sender);
            bps[_pid].mybreed = breed;
            bps[_pid].depo = amount;
            bps[_pid].power = mypower;
            bps[_pid].owner = msg.sender;
            puppy.setBattleExp(mypid);
            emit RewardGiven(msg.sender, amount, mypower);
        }
    }

    // 보너스 보상 처리(능력치별, 랜덤)
    function bonus(address user) internal {
        uint pid = puppy.myPuppyid(user);
        uint8 rewardType = ran();
        uint256 reward;
        if (rewardType == 0)      { reward = puppy.geti(pid); }
        else if (rewardType == 1) { reward = puppy.getc(pid); }
        else if (rewardType == 2) { reward = puppy.gets(pid); }
        else if (rewardType == 3) { reward = puppy.geta(pid); }
        else if (rewardType == 4) { reward = puppy.gete(pid); }
        else                     { reward = puppy.getf(pid); }
        uint256 amount = reward * pay / denominator;
        pupbank.depoup(user, amount);
        jack -= amount;
        emit Bonus(user, amount, reward);
    }

    // 상금 인출(24시간 제한)
    function allowcation(uint8 _pid) public returns (bool) {
        require(bps[_pid].owner == msg.sender, "You are not the owner of a battle dog.");
        require(bps[_pid].defense >=10, "Defensive battle records are lacking"); 
        uint256 allow = getreward() ; 
        bps[_pid].defense = 0;
        pupbank.depoup(msg.sender,allow);
        bps[_pid].depo += allow;
        jack -= allow;
        emit getdepo(allow);
        return true;
    }

    // 랜덤값 생성(6종)
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
        return uint8(rand % 6);
    }

    // Puppy 컨트랙트 래퍼
    function getbt() external view returns (uint8) {
        return puppy.bt();
    }

    function getmypuppy(address user) external view returns (uint256) {
        return puppy.myPuppy(user);
    }

    // 위너 상금 계산
    function getreward() public view returns (uint256) {
        // 예시 계산식: 전체 잭팟의 1/10 (실제 상황에 맞게 수정 가능)
        if (jack == 0) return 0;
        uint256 prize = jack / 100;
        return prize;
    }

    // 내 버프파워 (레벨* 능력치+랜덤 )
    function getmypower(uint256 pid) public view returns (uint256) {
        uint256 power1 = uint256(puppy.geti(pid)) + uint256(puppy.getc(pid)) + uint256(puppy.gets(pid))
            + uint256(puppy.geta(pid)) + uint256(puppy.gete(pid)) + uint256(puppy.getf(pid));
        uint256 power2 = uint256(attack());
        uint256 power3 = pupbank.getlevel(msg.sender);
        uint256 total = power3 * (power1 + power2);
        return total;
    }
   // 내 파워 계산 (레벨* 능력치+랜덤 )
    function orginpower(uint256 pid) public view returns (uint256) {
        uint256 power1 = uint256(puppy.geti(pid)) + uint256(puppy.getc(pid)) + uint256(puppy.gets(pid))
            + uint256(puppy.geta(pid)) + uint256(puppy.gete(pid)) + uint256(puppy.getf(pid));
        uint256 power3 = pupbank.getlevel(msg.sender);
        uint256 total = power3 * power1;
        return total;
    }
    // 0~9 중 하나 반환(작은 랜덤)
    function attack() public view returns (uint8) {
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
        return uint8(rand % 1000);
    }

       function getmypuppy() public view returns (uint256) { //나의 견종
        return puppy.myPuppy(msg.sender);
    }

     function g9(address user) public view virtual returns(uint256){  
    return pupbank.g9(user);
  }
}
