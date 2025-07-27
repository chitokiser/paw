// SPDX-License-Identifier: MIT  
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
    function myPuppy(address user) external view returns (uint8);
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

contract HiPuppy {
    IWithPuppy public puppy;
    IpupBank public pupbank;
    address public admin;
    uint16 public denominator;
    uint16 public rate ;

    constructor(address _puppy, address _pupbank) {
        puppy = IWithPuppy(_puppy);
        pupbank = IpupBank(_pupbank);
        denominator = 1000;
        admin = msg.sender;
        rate = 250;
    }

    event lost(uint amount);
    event Bonus(address indexed user,uint amount,uint256 reward);
    event RewardGiven(address indexed user, uint amount, uint reward);
    event DebugBreed(uint8 myPuppy, uint8 matchCount, uint8[9] slotValues);

    modifier onlyOwner() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    function setDenominator(uint16 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        denominator = _value;
    }
    
        function setRate(uint8 _value) external onlyOwner {
        require(_value > 0, "Value must be positive");
        rate = _value;
    }

    function playSlot(uint _pay) external {
   
        require(puppy.myPuppy(msg.sender) != 0, "No Puppy");
        require(g9(msg.sender) >= _pay, "GP<pay");

        uint8 breed = puppy.myPuppy(msg.sender);
        uint8 bt = puppy.bt();
        uint pid = puppy.myPuppyid(msg.sender);
        uint8[9] memory slots;
        uint8 matchCount;
        for (uint8 i = 0; i < 9; i++) {
            slots[i] = _randBreed(i, msg.sender, bt);
            if (slots[i] == breed)
             matchCount ++ ;
        }
        emit DebugBreed(breed, matchCount, slots);

        if (matchCount == 0) {
            pupbank.depodown(msg.sender, _pay);
            pupbank.expup(msg.sender, _pay);
            emit lost(_pay);
          
        }
        else{
        uint amount = matchCount * _pay * rate/100;
        pupbank.depoup(msg.sender, amount);
        bonus(msg.sender,_pay); 
        puppy.setBattleExp(pid);
        emit RewardGiven(msg.sender, amount,matchCount); 
        }
    }

    // 보상 타입&값 반환 함수
    function bonus(address user,uint _pay) internal {
         uint pid = puppy.myPuppyid(user);
        uint8 rewardType = ran();
        uint256 reward;
        if (rewardType == 0)      {reward = puppy.geti(pid);}
        else if (rewardType == 1) {reward = puppy.getc(pid);}
        else if (rewardType == 2) {reward = puppy.gets(pid);}
        else if (rewardType == 3) {reward = puppy.geta(pid);}
        else if (rewardType == 4) {reward = puppy.gete(pid);}
        else {                     reward = puppy.getf(pid);}
       uint amount = reward * _pay /denominator;
       pupbank.depoup(user, amount);
       emit Bonus(msg.sender, amount, reward);

    } 


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
        return uint8(rand % 6); // 0~5
    }

    function _randBreed(uint8 slotIndex, address user, uint8 btMax) public view returns (uint8) {
        uint256 rand = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    block.timestamp,
                    user,
                    slotIndex,
                    block.number,
                    gasleft()
                )
            )
        );
        return uint8(rand % btMax + 1); // 1 ~ btMax
    }

    function getbt() external view returns (uint8) {
        return puppy.bt();
    }

    function getmypuppy(address user) external view returns (uint8) {
        return puppy.myPuppy(user);
    }
    
    function g9(address user) public view virtual returns(uint256){  
    return pupbank.g9(user);
  }
}