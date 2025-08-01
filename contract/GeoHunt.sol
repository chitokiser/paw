// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

interface Ipupbank {
    function depoup(address _user, uint _depo) external;
    function depodown(address _user, uint _depo) external;
    function getlevel(address user) external view returns (uint);
    function getmento(address user) external view returns (address);
    function g9(address user) external view returns (uint); // gp 조회
}

contract PuppyWar {
    Ipupbank public pupbank;
    address public admin;
    uint256 public tax;
    mapping(address => uint) public staff;

    event Result(address indexed user, uint home, uint away);
    event Reward(address indexed user, uint amount);
    event Loss(address indexed user, uint amount);

    constructor(address _pupbank) {
        pupbank = Ipupbank(_pupbank);
        admin = msg.sender;
        tax = 1e18;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not an admin");
        _;
    }

    modifier onlyMember() {
        require(pupbank.getlevel(msg.sender) >= 1, "Not a member");
        _;
    }

    function staffUp(address _staff, uint8 num) public onlyAdmin {
        staff[_staff] = num;
    }

    function play(uint8 _winnum, uint pay) public onlyMember {
        require(1 <= _winnum && _winnum <= 3, "Invalid choice");
        require(pupbank.g9(msg.sender) >= pay * 10, "Not enough gamepoints");

        uint home = ran1();
        uint away = ran2();
        emit Result(msg.sender, home, away);

        uint _loss = 0;
        uint winnings = 0;

        // 승리 조건
        if (_winnum == 1 && home > away) {
            winnings = pay * (home - away); 
        } else if (_winnum == 2 && home == away) {
            winnings = pay * 950 / 100; // 무승부 9.5배
        } else if (_winnum == 3 && away > home) {
            winnings = pay * (away - home);
        } else {
            // 패배 조건
            if (_winnum == 1 && (home == away || away > home)) {
                _loss = (home == away) ? pay : pay * (away - home);
            } else if (_winnum == 2 && home != away) {
                _loss = pay;
            } else if (_winnum == 3 && (home == away || home > away)) {
                _loss = (home == away) ? pay : pay * (home - away);
            }
        }

        if (winnings > 0) {
            pupbank.depoup(msg.sender, winnings);
            emit Reward(msg.sender, winnings);
            tax -= winnings;
        } else {
            pupbank.depodown(msg.sender, _loss);
            emit Loss(msg.sender, _loss);
            tax += _loss;

            address mento = pupbank.getmento(msg.sender);
            if (mento != address(0)) {
                pupbank.depoup(mento, (pay * 5) / 100);
            }
        }
    }

    function g1() public view returns (uint256) {
        return tax;
    }

    function g9(address user) public view returns (uint) {
        return pupbank.g9(user);
    }

    function ran1() internal view returns (uint) {
        return uint(keccak256(abi.encodePacked(block.timestamp, msg.sender, block.prevrandao))) % 10 + 1;
    }

    function ran2() internal view returns (uint) {
        return uint(keccak256(abi.encodePacked(block.timestamp, msg.sender, blockhash(block.number - 1)))) % 10 + 1;
    }

    receive() external payable {}
}
pragma solidity >=0.7.0 <0.9.0;

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

contract GeoHunt {
    IWithPuppy public puppy;
    IpupBank public pupbank;
    address public admin;
    uint public mid;
 
    mapping(address => mapping(uint => bool)) public myprey;
    mapping(uint256 => monster) public mons;
    mapping(uint256 => uint256) private password;
    mapping(address => uint[]) public mymons;  //유저가 잡은 몬스터 리스트 
    event GameStarted(address indexed user, uint256 pay, uint256 nonce);
    event GameRewarded(address indexed user, uint256 reward);
    event Lost(address indexed user, uint256 enemyPower, uint256 myPower);
    event RewardGiven(address indexed user, uint256 rewardAmount);
    event Bonus(address indexed user, uint256 bonusAmount, uint256 baseStat);

    modifier onlyOwner() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    constructor(address _puppy, address _pupbank) {
        puppy = IWithPuppy(_puppy);
        pupbank = IpupBank(_pupbank);
        admin = msg.sender;
    }

    struct monster {
        string name;
        uint mid;
        uint power;

    }

    function createmon(string memory _name, uint _power,uint pass) external onlyOwner {
        mons[mid].name =_name;
        mons[mid].power =_power;
        mons[mid].mid = mid;
        password[mid] = pass;
        mid += 1;
    }

    function editemon(uint _mid, string memory name, uint power) external onlyOwner {
        mons[_mid].name = name;
        mons[_mid].power = power;
   
    }

     function editpass(uint _mid,uint pass) external onlyOwner {
         password[_mid] = pass;
   
    }

    function hunt(uint _mid,uint pass ) external {
        uint256 enemy = mons[_mid].power;
        require(password[_mid] == pass, "Not an official monster");
        require(puppy.myPuppy(msg.sender) != 0, "No Puppy");
        require(pupbank.g9(msg.sender) >= enemy, "Not enough GP");
        require(myprey[msg.sender][_mid] == false, "Already caught");

        uint256 mypid = puppy.myPuppyid(msg.sender);
        uint256 mypower = getmypower(mypid,msg.sender) + puppy.myPuppy(msg.sender);

        if (enemy > mypower) {
            pupbank.depodown(msg.sender, enemy);
            pupbank.expup(msg.sender, enemy);
            emit Lost(msg.sender, enemy, mypower);
        } else {
            pupbank.depoup(msg.sender, enemy);
            myprey[msg.sender][_mid] = true; // 사냥 성공 기록
            mymons[msg.sender].push(_mid);
            bonus(msg.sender, enemy);
            emit RewardGiven(msg.sender, enemy);
        }
    }

    function bonus(address user, uint _amount) internal {
        uint pid = puppy.myPuppyid(user);
        uint8 rewardType = attack() % 6;
        uint256 reward;
        if (rewardType == 0)      { reward = puppy.geti(pid); }
        else if (rewardType == 1) { reward = puppy.getc(pid); }
        else if (rewardType == 2) { reward = puppy.gets(pid); }
        else if (rewardType == 3) { reward = puppy.geta(pid); }
        else if (rewardType == 4) { reward = puppy.gete(pid); }
        else                      { reward = puppy.getf(pid); }

        uint256 amount = (reward + _amount) / 100;
        pupbank.depoup(user, amount);
        emit Bonus(user, amount, reward);
    }

    function getlevel(address user) public view returns (uint256) {
        return pupbank.getlevel(user);
    }

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
        return uint8(rand % 100);
    }

    function getmypower(uint256 pid, address user) public view returns (uint256) {
        uint256 power1 = uint256(puppy.geti(pid)) + uint256(puppy.getc(pid)) + uint256(puppy.gets(pid))
            + uint256(puppy.geta(pid)) + uint256(puppy.gete(pid)) + uint256(puppy.getf(pid));
        uint256 power2 = uint256(attack());
        uint256 power3 = pupbank.getlevel(user);
        return power3 * (power1 + power2);
    }

    function getPassword(uint256 id) external view onlyOwner returns (uint256) {
    return password[id];
}

       function getbreed(uint256 pid) external view  returns (uint256) {
       return mons[pid].power;
       }

      function getmymon(address user) external view returns (uint256[] memory) {
       return mymons[user];
}

}
