// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

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

    uint private pass;     // 서버가 보관하는 간단 패스워드
    uint256 public jack;   // 누적 적립
    uint256 public pay;    // 1일 적립 한도(GP), 기본 5000

    mapping(address => uint256) public allowt; // 유저별 마지막 적립 시각

    event ScoreClaimed(address indexed user, uint256 gpAdded, uint256 expAdded, uint256 when);
    event PassUpdated(address indexed admin, uint256 when);
    event PayUpdated(uint256 newPay, uint256 when);

    modifier onlyOwner() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    constructor(address _puppy, address _pupbank, uint _pass) {
        puppy = IWithPuppy(_puppy);
        pupbank = IpupBank(_pupbank);
        admin = msg.sender;
        pass = _pass;
        pay = 5000;
    }

    function passup(uint _pass) external onlyOwner {
        pass = _pass;
        emit PassUpdated(msg.sender, block.timestamp);
    }

    // ✅ 버그 수정: pay 변경
    function setPay(uint256 _pay) external onlyOwner {
        pay = _pay;
        emit PayUpdated(_pay, block.timestamp);
    }

    // 기존: 유저가 직접 호출(패스워드 노출 위험 有)
    function claimScore(uint _pass) external {
        require(pass == _pass, "bad pass");
        _claimFor(msg.sender);
    }

    // ✅ 신규: 서버가 대신 호출 (패스워드 프론트 미노출)
    function claimOnBehalf(address user, uint _pass) external onlyOwner {
        require(pass == _pass, "bad pass");
        _claimFor(user);
    }

    function _claimFor(address user) internal {
        require(pupbank.getlevel(user) >= 1, "no member");

        uint256 last = allowt[user];
        require(block.timestamp >= last + 1 days, "once per day");

        allowt[user] = block.timestamp;
        pupbank.depoup(user, pay);
        pupbank.expup(user, 1000);

        jack += pay;
        emit ScoreClaimed(user, pay, 1000, block.timestamp);
    }

    function getlevel(address user) external view returns (uint256) {
        return pupbank.getlevel(user);
    }

    function getpass() external view onlyOwner returns (uint256) {
        return pass;
    }

    function getmydefense(address user) external view returns (uint256) {
        uint pid = puppy.myPuppyid(user);
        uint256 power = uint256(puppy.geti(pid)) + uint256(puppy.getc(pid)) + uint256(puppy.gets(pid))
            + uint256(puppy.geta(pid)) + uint256(puppy.gete(pid)) + uint256(puppy.getf(pid));
        return power;
    }
}
