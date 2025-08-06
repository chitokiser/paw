// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

/*───────────────────── Interfaces ─────────────────────*/
// Puppy 컨트랙트 인터페이스
interface Ipuppy {
    function geti(uint _pid) external view returns (uint16);  // 지능
    function getc(uint _pid) external view returns (uint16);  // 용기
    function gets(uint _pid) external view returns (uint16);  // 힘
    function geta(uint _pid) external view returns (uint16);  // 민첩
    function gete(uint _pid) external view returns (uint16);  // 지구력
    function getf(uint _pid) external view returns (uint16);  // 유연성
    function getowner(uint _pid) external view returns (address); // 강아지 소유자
    function myPuppy(address user) external view returns (uint);  // 강아지 품종 ID
    function myPuppyid(address user) external view returns (uint); // 강아지 개체 ID
    function setowner(address _user, uint _pid) external;  // 소유권 변경
    function pupbank() external view returns (address);
    function g9(address user) external view returns (uint256);
}

// PAW 토큰 인터페이스
interface Ipaw {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address user) external view returns (uint256);
}

// Puppy Bank 인터페이스
interface Ipupbank {
    function depoup(address user, uint256 depo) external;
    function depodown(address user, uint256 depo) external;
    function getprice() external view returns (uint256);
    function getlevel(address user) external view returns (uint256); // 레벨 반환
    function g9(address user) external view returns (uint256);
    function getagent(address user) external view returns (address);
    function getmento(address user) external view returns (address);
    function expup(address user, uint256 exp) external;
}

/**
 * @title PuppyMarket
 * @notice 강아지 마켓: 능력치 기반 가격 산정 및 PAW 결제 소유권 이전
 */
contract PuppyMarket {
    /*─────────── 상태 변수 ───────────*/
    Ipupbank public pupbank;
    Ipuppy public puppy;
    Ipaw public paw;
    address public admin;

    uint256 public max; // 최대 등록 개수 (랜덤 슬롯 범위)

    // 판매 목록 구조체
    struct list {
        uint256 bid;    // 강아지 품종 (breed id)
        address owner;  // 판매자 주소
        uint256 price;  // 판매 가격
    }

    mapping(address => bool) public add;  // 유저가 현재 등록 중인지 여부
    mapping(uint => list) public ls;      // 등록된 판매 목록

    /*─────────── 이벤트 ───────────*/
    event PuppyListed(uint256 pid, address seller, uint256 price);
    event PuppySold(uint256 pid, address buyer, uint256 price);
    event PuppyDelisted(uint256 pid);

    /*─────────── 생성자 ───────────*/
    constructor(address _puppy,address _pupbank, address _paw) {
        puppy = Ipuppy(_puppy);
        pupbank = Ipupbank(_pupbank);
        paw = Ipaw(_paw);
        max = 10;  // 초기 슬롯 수 10개
        admin = msg.sender;
    }

    /**
     * @notice 강아지 능력치 × 레벨로 가격 산출
     */
    function calculatePrice(uint256 _pid) public view returns (uint256) {
        uint256 totalStats =
            puppy.geti(_pid) +
            puppy.getc(_pid) +
            puppy.gets(_pid) +
            puppy.geta(_pid) +
            puppy.gete(_pid) +
            puppy.getf(_pid);

        // 가격 산출 시 msg.sender 레벨 사용 (구매자 기준 → 의도 확인 필요)
        uint256 level = pupbank.getlevel(msg.sender);

        return totalStats * level *5e15;
    }
     function myPuppyid() public view returns (uint256) {
      return puppy.myPuppyid(msg.sender);
    }
    /**
   max set
     */

    function maxSet(uint _max)public {
        require(admin == msg.sender,"no admin");
        max = _max;
    }


    function listPuppy() external {
        uint pid = puppy.myPuppyid(msg.sender);
        require(puppy.getowner(pid) == msg.sender, "Not owner");
        require(add[msg.sender] == false, "You've already registered");

        // 자동 가격 계산
        uint256 price = calculatePrice(pid);
        require(price >= 1000*5e15,"Not enough ability points");  //1000포인트 이상 판매가능
        // 랜덤 슬롯 선택
        uint256 ran = ran();
        uint256 ownerPrice = ls[ran].price;
        // 슬롯에 기존 데이터가 있으면 정리 후 덮어쓰기
        if (ownerPrice >= 1e18 && g1() >= ownerPrice) {
         
            paw.transfer(ls[ran].owner, ls[ran].price);

            // 기존 등록자 상태 초기화
            add[ls[ran].owner] = false;

            // 새로운 판매 등록
            ls[ran].bid = puppy.myPuppy(msg.sender);
            ls[ran].price = price;
            ls[ran].owner = msg.sender;
            add[msg.sender] = true;
        } else {
            // 빈 슬롯에 신규 등록
            ls[ran].bid = puppy.myPuppy(msg.sender);
            ls[ran].price = price;
            ls[ran].owner = msg.sender;

            // BUG: add[ls[ran].owner] = false; → 잘못된 초기화
            add[ls[ran].owner] = false; // 불필요, msg.sender 등록 직후 true로 바꿔야 함
            add[msg.sender] = true;
        }

        emit PuppyListed(pid, msg.sender, price);
    }

    /**
     * @notice 강아지 구매
     * @param _mid 판매 슬롯 번호
     */
    function buyPuppy(uint256 _mid) external {
        uint price = ls[_mid].price;
        address seller = ls[_mid].owner;
        add[seller] = false; // 판매자 상태 초기화

        require(price > 1, "No sales");
        require(paw.balanceOf(msg.sender) >= price, "Insufficient PAW");

        // 결제 (구매자 → 판매자)
        require(paw.transferFrom(msg.sender, seller, price), "Payment failed");

        // 강아지 소유권 이전
        puppy.setowner(msg.sender, _mid);  // BUG: _mid는 슬롯 번호인데 강아지 ID로 사용 중

        // 슬롯 초기화
        ls[_mid].bid = 0;
        ls[_mid].price = 0;
        ls[_mid].owner = address(0);

        emit PuppySold(_mid, msg.sender, price);
    }

    /**
     * @notice 랜덤 슬롯 번호 생성
     */
    function ran() public view returns (uint) {
        uint256 rand = uint256(
            keccak256(
                abi.encodePacked(block.timestamp, msg.sender)
            )
        );
        return uint(rand % max + 1); // 1~max 범위
    }

    
function g1() public view virtual returns(uint256) {  
    return paw.balanceOf(address(this));
}
}
