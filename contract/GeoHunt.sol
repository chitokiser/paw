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
