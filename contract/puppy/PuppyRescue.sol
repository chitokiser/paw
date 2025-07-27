// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title Puppy Rescue Jackpot & Play Reward Contract
/// @notice 구조 게임 플레이마다 GP 토큰을 소모하고, 성공/실패에 따라 잭팟 풀에 적립 또는 분배하며, 성공 시 추가 보상을 제공합니다.
interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice GP 토큰 기능 확장 인터페이스 (예: 보유자에게 보상을 지급)
interface IGp {
    function gpup(address user, uint256 amount) external;
}

contract PuppyRescueGame {
    IERC20 public immutable gpToken;      // GP ERC20 토큰 인터페이스
    IGp   public immutable gpRewards;    // GPup 보상 인터페이스
    address public owner;               // 관리자

    uint256 public jackpotRatio;        // 분배 비율 (%)
    uint256 public jackpotPool;         // 플레이 실패 시 적립되는 잭팟 풀
    uint256 public constant PLAY_COST = 1e17; // 0.1 GP (토큰 소수점 18자리 가정)

    bool public rewardClaimed;

    event Played(address indexed player, bool success, uint256 cost);
    event JackpotUpdated(uint256 newPool);
    event JackpotRatioUpdated(uint256 oldRatio, uint256 newRatio);
    event RewardClaimed(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /// @param _gpToken GP ERC20 토큰 주소
    /// @param _gpRewards GPup 기능 제공 컨트랙트 주소
    /// @param _jackpotRatio 초기 분배 비율(0~100)
    constructor(address _gpToken, address _gpRewards, uint256 _jackpotRatio) {
        require(_gpToken != address(0) && _gpRewards != address(0), "Invalid address");
        require(_jackpotRatio <= 100, "Ratio max 100");
        owner = msg.sender;
        gpToken = IERC20(_gpToken);
        gpRewards = IGp(_gpRewards);
        jackpotRatio = _jackpotRatio;
    }

    /// @notice 관리자: 분배 비율 변경 (0~100)
    function setJackpotRatio(uint256 _ratio) external onlyOwner {
        require(_ratio <= 100, "Ratio max 100");
        emit JackpotRatioUpdated(jackpotRatio, _ratio);
        jackpotRatio = _ratio;
    }

    /// @notice 플레이어: 게임 1회 플레이 (성공/실패 결과에 따라 잭팟 풀 조정 및 보상)
    /// @param success 게임 성공 여부 (true=성공, false=실패)
    function playGame(bool success) external {
        // 1) 플레이 비용 지불
        require(gpToken.transferFrom(msg.sender, address(this), PLAY_COST), "Pay failed");
        emit Played(msg.sender, success, PLAY_COST);

        if (!success) {
            // 실패 시 잭팟 풀에 적립
            jackpotPool += PLAY_COST;
            emit JackpotUpdated(jackpotPool);
        } else {
            // 성공 시 잭팟 풀에서 차감 후 GPup 보상
            require(jackpotPool >= PLAY_COST, "Jackpot insufficient");
            jackpotPool -= PLAY_COST;
            emit JackpotUpdated(jackpotPool);
            // GPup 보상: 잭팟 풀의 1/10
            uint256 reward = jackpotPool / 10;
            gpRewards.gpup(msg.sender, reward);
            emit RewardClaimed(msg.sender, reward);
        }
    }

    /// @notice 관리자: 잔여 GP 토큰 인출
    function withdraw(uint256 amount) external onlyOwner {
        require(amount <= gpToken.balanceOf(address(this)), "Insufficient balance");
        require(gpToken.transfer(owner, amount), "Transfer failed");
        emit Withdrawn(owner, amount);
    }
}

/*
Integration:
- playGame(true/false)를 프론트에서 호출하여 결과 전달
- transferFrom을 위해 플레이어는 PLAY_COST(0.1 GP) 만큼 approve 필요
- gpRewards 컨트랙트에서 gpup() 호출로 추가 보상 지급
*/
