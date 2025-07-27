// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface Ipupbank {
    function depoup(address _user, uint256 _depo) external;
    function depodown(address _user, uint256 _depo) external;
    function g9(address user) external view returns (uint256);
    function getmento(address user) external view returns(address);
}

contract PuppyLotto {
    uint8 public constant NUMBERS = 5;
    uint8 public constant MAX_TRIES = 6;
    uint8 public constant RATE = 10;

    Ipupbank public pupbank;
    address public admin;
    uint256 public wid;
    uint256 public jack;
    uint256 public fee;
    mapping(address => uint8) public staff;
    mapping(uint256 => Game) private games; // ✅ 정답 숨김 (private)
    mapping(address => mapping(uint256 => uint8)) public tries;

    struct Game {
        uint256[5] answer;
        bool solved;
        address winner;
    }

    event GameCreated(uint256 indexed gameId);
    event GuessMade(uint256 indexed gameId, address indexed user, uint256 matched);
    event GameEnded(uint256 indexed gameId, address indexed winner, uint256 reward);

    constructor(address _pupbank) {
        pupbank = Ipupbank(_pupbank);
        admin = msg.sender;
        staff[msg.sender] = 10;
        fee = 100;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "ADMIN");
        _;
    }

    modifier onlyStaff(uint8 lev) {
        require(staff[msg.sender] >= lev, "STAFF");
        _;
    }

    function setStaff(address who, uint8 lev) external onlyAdmin {
        staff[who] = lev;
    }

    function jackup(uint _jack) external onlyStaff(5) {
        jack = _jack;
    }

    function feeup(uint _fee) external onlyStaff(5) {
        fee = _fee;
    }

    function createGame(uint256[] calldata _answer) external onlyStaff(10) {
        require(_answer.length == NUMBERS, "LEN!=5");
        require(validNums(_answer), "1~45 uniq");

        Game storage g = games[wid];
        for (uint i = 0; i < NUMBERS; i++) {
            g.answer[i] = _answer[i];
        }
        emit GameCreated(wid);
        wid += 1;
    }

    function guess(uint256 id, uint256[] calldata g) external {
        Game storage game = games[id];
        require(!game.solved, "SOLVED");
        require(g.length == NUMBERS, "LEN");
        require(validNums(g), "BAD NUMS");
        require(g9(msg.sender) >= fee, "GP<1");
        require(tries[msg.sender][id] < MAX_TRIES, "MAX 6");

        pupbank.depodown(msg.sender, fee);
        jack += fee;
        tries[msg.sender][id] += 1;

        uint matched = countMatch(game.answer, g);

        if (matched == NUMBERS) {
            uint256 reward = jack / RATE;
            address mento = pupbank.getmento(msg.sender);

            pupbank.depoup(msg.sender, reward );
            if (mento != address(0)) {
                pupbank.depoup(mento, reward * 10 / 1000);
            }

            jack -= reward;
            game.solved = true;
            game.winner = msg.sender;

            emit GameEnded(id, msg.sender, reward);
        } else {
            emit GuessMade(id, msg.sender, matched);
        }
    }

    function getGameInfo(uint256 id) external view returns (bool solved, address winner) {
        Game storage g = games[id];
        return (g.solved, g.winner);
    }

    function validNums(uint256[] calldata a) internal pure returns (bool) {
        bool[46] memory seen;
        for (uint i = 0; i < a.length; ++i) {
            uint n = a[i];
            if (n == 0 || n > 45 || seen[n]) return false;
            seen[n] = true;
        }
        return true;
    }

function countMatch(uint256[5] storage ans, uint256[] calldata g) internal view returns (uint matched) {
    bool[46] memory answerMap;
    for (uint i = 0; i < NUMBERS; ++i) {
        answerMap[ans[i]] = true;
    }

    for (uint i = 0; i < NUMBERS; ++i) {
        if (g[i] >= 1 && g[i] <= 45 && answerMap[g[i]]) {
            matched++;
            answerMap[g[i]] = false; // 중복 방지
        }
    }
}
   function g9(address user) public view returns (uint) {
        return pupbank.g9(user);
    }
     
    function getmento(address user) external view returns (address) {
        return pupbank.getmento(user);
    }
}
