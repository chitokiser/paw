// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// pup 토큰 인터페이스 (ERC-20 유사)
interface Ipup {
    function balanceOf(address) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256) external returns (bool);
}

// pupBank 인터페이스 (입금/출금 및 잔고조회)
interface Ipupbank {
    function depoup(address _user, uint256 _depo) external;
    function depodown(address _user, uint256 _depo) external;
    function g9(address user) external view returns (uint256);
}

// 제안 게시판 컨트랙트
contract MonReport {
    // 댓글 구조체
    struct Comment {
        address commenter;
        string content;
        uint256 timestamp;
    }

    // 제안 구조체
    struct Notice {
        uint256 id;
        address author;
        string content;
        uint256 timestamp;
        uint256 agreeVotes;
        uint256 disagreeVotes;
        uint256 agreeWeight;
        uint256 disagreeWeight;
        Comment[] comments; // in-memory용, allComments에서 영구저장
    }

    // 외부 컨트랙트 연동
    Ipup public pup;
    Ipupbank public pupbank;

    // 관리자
    address public admin;

    // 게시물/댓글 참여 조건
    uint256 public postThreshold = 500;      // 게시 최소 pup 잔고
    uint256 public commentThreshold = 1;     // 댓글 최소 pup 잔고

    // 게시물 수, 세금 풀, 게시 수수료
    uint256 public noticeCount;
    uint256 public tax;
    uint256 public fee = 10;                // 게시 시 100 pup 수수료
    uint256 public support = 3;              // 보상받기 위한 찬성 최소 수

    // 스태프 권한 레벨, 게시물 및 댓글 저장소
    mapping(address => uint256) public staff;
    mapping(uint256 => Notice) public notices;
    mapping(uint256 => Comment[]) public allComments;

    // 리워드 수령 여부, 투표 여부
    mapping(address => mapping(uint256 => bool)) public rewards;
    mapping(address => mapping(uint256 => bool)) public hasVoted;

    // 이벤트 로그
    event NoticePosted(uint256 indexed noticeId, address indexed author, string content, uint256 timestamp);
    event CommentAdded(uint256 indexed noticeId, address indexed commenter, string content, uint256 timestamp);
    event Voted(uint256 indexed noticeId, address indexed voter, bool agree, uint256 weight);
    event RewardIssued(address indexed recipient, uint256 amount, string rewardType);

    // 생성자: pup, pupBank 주소 등록 + deploy자 staff 등록
    constructor(address _pup, address _pupbank) {
        pup = Ipup(_pup);
        pupbank = Ipupbank(_pupbank);
        admin = msg.sender;
        staff[msg.sender] = 10;
    }

    // 관리자 전용
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    // 스태프(레벨 5 이상) 전용
    modifier onlyStaff() {
        require(staff[msg.sender] >= 5, "Only staff");
        _;
    }

    // 게시 가능 조건
    modifier onlyPostEligible() {
        require(pup.balanceOf(msg.sender) >= postThreshold, "Not enough pup");
        _;
    }

    // 댓글 가능 조건
    modifier onlyCommentEligible() {
        require(pup.balanceOf(msg.sender) >= commentThreshold, "Not enough pup");
        _;
    }

    // 게시물 작성 조건 설정
    function updatePostThreshold(uint256 newThreshold) external onlyAdmin {
        postThreshold = newThreshold;
    }

    // 댓글 작성 조건 설정
    function updateCommentThreshold(uint256 newThreshold) external onlyAdmin {
        commentThreshold = newThreshold;
    }

    // 게시 수수료 변경
    function updateFee(uint256 newFee) external onlyAdmin {
        fee = newFee;
    }

    // 스태프 등급 조정
    function staffUp(address _user, uint256 _level) external onlyAdmin {
        staff[_user] = _level;
    }

    // 찬성 기준치 조정
    function supportUp(uint256 newSupport) external onlyStaff {
        support = newSupport;
    }

    // 게시물 작성 함수
    function postNotice(string memory content) external onlyPostEligible {
        require(bytes(content).length > 0, "Empty content");
        require(g4(msg.sender) >= fee, "Not enough pup");

        // 컨트랙트에 pup 사용 승인 (비표준적 동작 — 실질적 효과 없음)
        pup.approve(msg.sender, fee);

        // 사용자가 컨트랙트에 허용한 수량 확인
        uint256 allowance = pup.allowance(msg.sender, address(this));
        require(allowance >= fee, "Check the allowance");

        // 수수료 만큼 컨트랙트로 전송
        pup.transferFrom(msg.sender, address(this), fee);
        tax += fee; // 수수료 풀 적립

        // 새 게시물 저장
        Notice storage newNotice = notices[noticeCount];
        newNotice.id = noticeCount;
        newNotice.author = msg.sender;
        newNotice.content = content;
        newNotice.timestamp = block.timestamp;

        emit NoticePosted(noticeCount, msg.sender, content, block.timestamp);
        noticeCount++;
    }

    // 게시물 수정 (스태프 전용)
    function editNotice(uint256 _nid, string memory content) external onlyStaff {
        require(_nid < noticeCount, "Invalid ID");
        Notice storage n = notices[_nid];
        n.content = content;
        n.timestamp = block.timestamp;
        emit NoticePosted(_nid, msg.sender, content, block.timestamp);
    }

    // 댓글 작성
    function addComment(uint256 noticeId, string memory content) external onlyCommentEligible {
        require(noticeId < noticeCount, "Invalid ID");
        require(bytes(content).length > 0, "Empty comment");

        Comment memory c = Comment(msg.sender, content, block.timestamp);
        notices[noticeId].comments.push(c);
        allComments[noticeId].push(c);

        emit CommentAdded(noticeId, msg.sender, content, block.timestamp);
    }

    // 투표 기능
    function vote(uint256 noticeId, bool agree) external {
        require(noticeId < noticeCount, "Invalid ID");
        require(!hasVoted[msg.sender][noticeId], "Already voted");

        uint256 bal = pup.balanceOf(msg.sender);
        require(bal > 0, "No pup");

        hasVoted[msg.sender][noticeId] = true;
        Notice storage n = notices[noticeId];

        if (agree) {
            n.agreeVotes++;
            n.agreeWeight += bal;
        } else {
            n.disagreeVotes++;
            n.disagreeWeight += bal;
        }

        emit Voted(noticeId, msg.sender, agree, bal);
    }

    // 게시자 보상 요청
    function issueNoticeReward(uint256 noticeId) public {
        Notice storage n = notices[noticeId];
        require(n.author == msg.sender, "Not author");
        require(n.agreeVotes >= support, "Not enough support");
        require(!rewards[msg.sender][noticeId], "Already claimed");

        uint256 amount = tax / 100; // 전체의 1%
        require(tax >= amount, "Insufficient pool");

        pup.transfer(msg.sender, amount);
        tax -= amount;
        rewards[msg.sender][noticeId] = true;

        emit RewardIssued(msg.sender, amount, "Notice Reward");
    }

    // 댓글자 보상 요청
    function issueCommentReward(uint256 noticeId) public {
        require(!rewards[msg.sender][noticeId], "Already claimed");
        uint256 amount = tax / 1000; // 전체의 0.1%
        require(tax >= amount, "Insufficient pool");

        pup.transfer(msg.sender, amount);
        tax -= amount;
        rewards[msg.sender][noticeId] = true;

        emit RewardIssued(msg.sender, amount, "Comment Reward");
    }

    // 댓글 ID 배열 반환 (프론트엔드용)
    function getCommentIDs(uint256 noticeId) public view returns (uint256[] memory) {
        uint256 len = allComments[noticeId].length;
        uint256[] memory ids = new uint256[](len);
        for (uint i = 0; i < len; i++) {
            ids[i] = i;
        }
        return ids;
    }

    // 특정 댓글 정보 반환
    function comments(uint256 noticeId, uint256 index) public view returns (address, string memory, uint256) {
        Comment memory c = allComments[noticeId][index];
        return (c.commenter, c.content, c.timestamp);
    }

    // 컨트랙트 내 잔액 보기
    function g3() public view returns (uint) {
        return pup.balanceOf(address(this));
    }

    // 사용자 잔액 보기
    function g4(address user) public view returns (uint) {
        return pup.balanceOf(user);
    }
}
