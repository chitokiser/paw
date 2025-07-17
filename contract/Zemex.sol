// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

interface Izem {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface Izumbank {
    function levelcheck(address user) external view returns (uint8);
    function expup(address user, uint256 pay) external returns (bool);
}

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundID,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract zemex {
    uint256 public price; // ZEM per BNB (scaled by 1000)
    uint256 public tax;
    address public allow;
    address public admin;

    mapping(address => uint8) public black;
    mapping(address => uint8) public staff;

    Izem public zem;
    Izumbank public zumbank;
    AggregatorV3Interface public priceFeed;

    uint256 public bnbUsdPrice;       // 8 decimals (ex: 250.00 = 25000000000)
    uint256 public lastPriceFetchTime;

    event ZemPurchased(address indexed buyer, uint256 bnbSent, uint256 zemReceived);
    event ZemSold(address indexed seller, uint256 zemSent, uint256 bnbReceived);
    event PriceUpdated(uint256 newPrice, uint256 bnbUsdPrice);

    constructor(address _zem, address _zumbank, address _allow) {
        zem = Izem(_zem);
        zumbank = Izumbank(_zumbank);
        allow = _allow;
        admin = msg.sender;
        staff[msg.sender] = 10;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyStaff(uint8 level) {
        require(staff[msg.sender] >= level, "Insufficient staff level");
        _;
    }

    // 관리자 설정
    function setPriceFeed(address _feed) external onlyAdmin {
        priceFeed = AggregatorV3Interface(_feed);
    }

    function alloweup(address _allow) external onlyAdmin {
        allow = _allow;
    }

    function staffup(uint8 level, address _staff) external onlyAdmin {
        staff[_staff] = level;
    }

    function blackup(address _black) external onlyStaff(5) {
        black[_black] = 5;
    }

    // ZEM 구매 (BNB → ZEM)
    function zembuy() external payable {
        uint256 pay = msg.value*price/1000;
        require(pay <= zembalances(), "Not enough tokens");
        zem.transfer(msg.sender,pay); 
        emit ZemPurchased(msg.sender, msg.value, pay);
    }

    // ZEM 판매 (ZEM → BNB)
    function bnbsell(uint256 num) external {
        require(black[msg.sender] == 0, "You are blacklisted");

        uint256 pay = (num / price) * g1(msg.sender);
        uint256 ttax = (num / price) * 1000;

        require(zem.balanceOf(msg.sender) >= num, "Not enough ZEM tokens");
        require(address(this).balance >= pay, "Contract has insufficient BNB");

        uint256 allowanceAmt = zem.allowance(msg.sender, address(this));
        require(allowanceAmt >= num, "Insufficient allowance. Approve first.");

        require(zem.transferFrom(msg.sender, address(this), num), "ZEM transferFrom failed");
        payable(msg.sender).transfer(pay);

        tax += ttax - pay;
        emit ZemSold(msg.sender, num, pay);
    }

    // 수동 가격 설정
    function priceup(uint256 newPrice) external onlyStaff(1) {
        price = newPrice;
        if (tax >= 1e18) {
            require(zem.transfer(allow, tax), "Tax transfer failed");
            tax = 0;
        }
    }

    // 오라클에서 BNB/USD 시세 가져와 내부 price 업데이트
    function fetchBnbPrice() external {
        require(block.timestamp >= lastPriceFetchTime + 12 hours, "Wait 1 hour between updates");

        (, int256 answer,,,) = priceFeed.latestRoundData();
        require(answer > 0, "Invalid price from oracle");

        bnbUsdPrice = uint256(answer); // 8 decimals
        lastPriceFetchTime = block.timestamp;

        // price = ZEM per BNB (1 ZEM = 1 USD 기준)
        // 보정: price = (bnbUsdPrice * 1000) / 1e8
        price = (bnbUsdPrice * 1000) / 1e8;

        emit PriceUpdated(price, bnbUsdPrice);
    }

    // 기본 정보 조회
    function getprice() external view returns (uint256) {
        return price;
    }

    function getBnbPrice() external view returns (uint256) {
        return bnbUsdPrice;
    }

    function lastPriceFetchedAt() external view returns (uint256) {
        return lastPriceFetchTime;
    }

    function balance() public view returns (uint256) {
        return address(this).balance;
    }

    function zembalances() public view returns (uint256) {
        return zem.balanceOf(address(this));
    }

    function g1(address user) public view returns (uint256) {
        return 900 + zumbank.levelcheck(user);
    }

    function g2(address user) public view returns (uint256) {
        return zem.balanceOf(user);
    }

    function deposit() external payable {}
}
