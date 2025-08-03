// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

interface IWithPuppy {
    function geti(uint _pid) external view returns (uint16);
    function getc(uint _pid) external view returns (uint16);
    function gets(uint _pid) external view returns (uint16);
    function geta(uint _pid) external view returns (uint16);
    function gete(uint _pid) external view returns (uint16);
    function getf(uint _pid) external view returns (uint16);
    function getowner(uint _pid) external view returns (address);
    function setowner(address _user, uint _pid) external;
    function pupbank() external view returns (address);
    function g9(address user) external view returns (uint256);
}

interface IPAW {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address user) external view returns (uint256);
}

/**
 * @title PuppyMarket
 * @notice 강아지 마켓: 능력치 기반 가격 자동 산정 및 PAW 결제 소유권 이전
 */
contract PuppyMarket {
    IWithPuppy public withPuppy;
    IPAW public paw;

    uint256 public constant MAX_LISTINGS = 10;

    struct Listing {
        uint256 pid;
        address seller;
        uint256 price;
        uint256 timestamp;
    }

    Listing[] public listings; // 등록된 강아지 목록
    mapping(uint256 => bool) public isListed; // pid -> 등록 여부

    event PuppyListed(uint256 pid, address seller, uint256 price);
    event PuppySold(uint256 pid, address buyer, uint256 price);
    event PuppyDelisted(uint256 pid);

    constructor(address _withPuppy, address _paw) {
        withPuppy = IWithPuppy(_withPuppy);
        paw = IPAW(_paw);
    }

    /**
     * @dev 가격 산정 로직
     * 능력치(6개) 합 + battleExp + 레벨 기반
     * 단순 예시: (능력치합 * 10) + battleExp * 5 + level * 100
     */
    function calculatePrice(uint256 _pid) public view returns (uint256) {
        uint256 totalStats =
            withPuppy.geti(_pid) +
            withPuppy.getc(_pid) +
            withPuppy.gets(_pid) +
            withPuppy.geta(_pid) +
            withPuppy.gete(_pid) +
            withPuppy.getf(_pid);

        // battleExp와 level은 WithPuppy의 battleExp와 pupbank.getlevel(user)로 가정
        uint256 battleExp = 0; // 필요시 WithPuppy에 battleExp getter 추가
        uint256 level = withPuppy.g9(withPuppy.getowner(_pid)) / 1000; // 예: GP/1000 = level 추정

        return totalStats * 10 + battleExp * 5 + level * 100;
    }

    /**
     * @notice 강아지 등록
     */
    function listPuppy(uint256 _pid) external {
        require(!isListed[_pid], "Already listed");
        require(withPuppy.getowner(_pid) == msg.sender, "Not owner");

        // 자동 가격 계산
        uint256 price = calculatePrice(_pid);

        // 10개 초과 시 오래된 것 제거
        if (listings.length >= MAX_LISTINGS) {
            _delistOldest();
        }

        listings.push(Listing({
            pid: _pid,
            seller: msg.sender,
            price: price,
            timestamp: block.timestamp
        }));

        isListed[_pid] = true;
        emit PuppyListed(_pid, msg.sender, price);
    }

    /**
     * @notice 강아지 구매 (PAW 결제)
     */
    function buyPuppy(uint256 _pid) external {
        (uint index, Listing memory lst) = _findListing(_pid);
        require(lst.seller != address(0), "Not listed");
        require(paw.balanceOf(msg.sender) >= lst.price, "Insufficient PAW");

        // 결제
        require(paw.transferFrom(msg.sender, lst.seller, lst.price), "Payment failed");

        // 소유권 이전
        withPuppy.setowner(msg.sender, _pid);

        // 목록에서 제거
        _removeListing(index);

        emit PuppySold(_pid, msg.sender, lst.price);
    }

    /**
     * @notice 강아지 등록 해제
     */
    function delistPuppy(uint256 _pid) external {
        (uint index, Listing memory lst) = _findListing(_pid);
        require(lst.seller == msg.sender, "Not seller");

        _removeListing(index);

        emit PuppyDelisted(_pid);
    }

    /* ------------------- 내부 유틸 ------------------- */

    function _findListing(uint256 _pid) internal view returns (uint, Listing memory) {
        for (uint i = 0; i < listings.length; i++) {
            if (listings[i].pid == _pid) {
                return (i, listings[i]);
            }
        }
        return (0, Listing(0, address(0), 0, 0));
    }

    function _removeListing(uint index) internal {
        isListed[listings[index].pid] = false;

        // 마지막 항목과 교체 후 pop
        if (index < listings.length - 1) {
            listings[index] = listings[listings.length - 1];
        }
        listings.pop();
    }

    function _delistOldest() internal {
        uint oldestIndex = 0;
        uint oldestTime = listings[0].timestamp;

        for (uint i = 1; i < listings.length; i++) {
            if (listings[i].timestamp < oldestTime) {
                oldestTime = listings[i].timestamp;
                oldestIndex = i;
            }
        }

        _removeListing(oldestIndex);
    }

    /**
     * @notice 전체 등록 목록 조회
     */
    function getListings() external view returns (Listing[] memory) {
        return listings;
    }
}
