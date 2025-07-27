
//SPDX-License-Identifier: MIT  
//ver1.2
pragma solidity >=0.7.0 <0.9.0;

/*─────────────────── External Interfaces ───────────────────*/
interface Ipup {
    function balanceOf(address) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256) external returns (bool);
}

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



/*────────────────────── Main Contract ──────────────────────*/
contract WithPuppy {
    /* ───────────── State ───────────── */

    Ipup      public immutable pup;
    IpupBank  public immutable pupbank;
    address public immutable tbank;
    address public immutable admin;
    uint256 public fee   = 1000;   // 기본 생성비용(GP) 
    uint8   public bt   ;         // 품종 수(1-60)

    uint256 public pid;                // 강아지 전역 ID

    mapping(address => uint8)  public staff;    // 권한 등급
    mapping(address => uint8)  public myPuppy;  // 유저->소유 품종(0이면 없음)
    mapping(address => uint)  public myPuppyid;  // 유저->breed
    mapping(uint256 => Puppy)  public puppys;   // Puppy breed
    mapping(uint256 => my)  public myinfo;   // 나의 강아지 스킬
    mapping(address => uint8)  public fa;   // 나의 강아지 스킬
    /* ───────────── Struct ───────────── */
        struct my {
   uint16 intell;
    uint16 courage;
    uint16 strength;
    uint16 agility;
    uint16 endurance;
    uint16 flexibility;
    }
    
    
    struct Puppy {
        uint256  breed;      // 1-60
        string name;
        uint256 battleExp;
        address owner;
    }

  

    /* ───────────── Constructor ───────────── */
    constructor(address _pup, address _pupbank) {
        pup     = Ipup(_pup);
        pupbank = IpupBank(_pupbank);
        tbank   = _pupbank;
        admin = msg.sender;
        staff[msg.sender] = 10; // 최고등급
        fee =1000;
        bt = 60;
    }

    /*────────────────────── Core Logic ──────────────────────*/
/** @notice 강아지 최초 구매(생성) */
function buyPuppy(string calldata _name) external {
    require(bytes(_name).length != 0, "name empty");
    require(myPuppy[msg.sender] == 0,  "already owns");
    require(g9(msg.sender)  >= fee, "insufficient GP");

    
    uint8 breed = ran1();
    puppys[pid] = Puppy({
        breed:       breed,
        name:        _name,
        battleExp:  0,
        owner:       msg.sender
    });
       
    
    PurchaseReward(msg.sender,breed);
}

  function PurchaseReward(address user,uint8 _breed)internal{
    pupbank.depodown(user, fee);
    myPuppy[user] = _breed;
    myPuppyid[user] = pid;
    /*────────── 6. 멘토 보상 & 경험치 ──────────*/
    address mentor = pupbank.getmento(msg.sender);
    if (mentor != address(0)) {
        pupbank.depoup(mentor, (fee * 10) / 100);   // 10 % 멘토 보상
    }
    pupbank.expup(msg.sender, fee );          // 경험치 기여
     pid += 1; 

  }
     
    function faup(address _fa) public {  
    require(admin == msg.sender, "no admin"); 
    fa[_fa] = 5;
  }   
     
  function setowner(address _user,uint _pid) public {  
    require(fa[msg.sender] >= 5, "no puppy family");
    puppys[_pid].owner = _user;
  }

    function setBattleExp(uint _pid) public {  
    require(fa[msg.sender] >= 5, "no puppy family");
    puppys[_pid].battleExp += 1;
    }

     function setBreed(uint _pid,uint256 _breed ) public {  
    require(fa[msg.sender] >= 5, "no puppy family");
    puppys[_pid].breed = _breed;
    }  


    function rename(uint256 _pid, string calldata _newName) external {
        require(bytes(_newName).length > 0, "name empty");
        require(puppys[_pid].owner == msg.sender, "not owner");
        require(g9(msg.sender) >= 1, "GP<fee");
        pupbank.depodown(msg.sender,100);
        puppys[_pid].name = _newName;
    }


    function boostIntell(uint256 _pid) external {
        require(puppys[_pid].owner == msg.sender, "not owner");
        require(g9(msg.sender) >= 500, "GP not enough");
        pupbank.depodown(msg.sender,500);
        myinfo[_pid].intell += ran2();
    }


    function boostCourage(uint256 _pid) external {
      require(puppys[_pid].owner == msg.sender, "not owner");
        require(g9(msg.sender) >= 500, "GP not enough");
        pupbank.depodown(msg.sender,500);
        myinfo[_pid].courage += ran2();
    }

 

    function boostStrength(uint256 _pid) external {
        require(puppys[_pid].owner == msg.sender, "not owner");
        require(g9(msg.sender) >= 500, "GP not enough");
        pupbank.depodown(msg.sender,500);
        myinfo[_pid].strength += ran2();
                      
    }

    function boostAgility(uint256 _pid) external {
        require(puppys[_pid].owner == msg.sender, "not owner");
        require(g9(msg.sender) >= 500, "GP not enough");
        pupbank.depodown(msg.sender,500);
        myinfo[_pid].agility += ran2();
    }

    function boostEndurance(uint256 _pid) external {
        require(puppys[_pid].owner == msg.sender, "not owner");
        require(g9(msg.sender) >= 500, "GP not enough");
        pupbank.depodown(msg.sender,500);
        myinfo[_pid].endurance += ran2();
    }

    function boostFlexibility(uint256 _pid) external {
       require(puppys[_pid].owner == msg.sender, "not owner");
        require(g9(msg.sender) >= 500, "GP not enough");
        pupbank.depodown(msg.sender,500);
        myinfo[_pid].flexibility += ran2();
    }

    /*──────────────── Admin ────────────────*/
       
    function setStaff(address _staff,uint8 level) external {
        require(staff[msg.sender] >= 10, "staff only");
        staff[_staff] = level;
    }
    function setFee(uint256 newFee) external {
        require(staff[msg.sender] >= 5, "staff only");
        fee = newFee;
    }
   
    
    function setBt(uint8 newBt) external {
        require(staff[msg.sender] >= 5, "staff only");
        bt = newBt;
    }

     function transpup(uint _amount) external {
        require(staff[msg.sender] >= 5, "staff only");
        require(g1() >= _amount, "pup is not enough");
        pup.transfer(tbank,_amount);
    }

    function ran1() internal view returns (uint8) {
    uint256 rand = uint256(
        keccak256(
            abi.encodePacked(block.prevrandao, block.timestamp, msg.sender)
        )
    );
    return uint8(rand % bt + 1); // 1-bt
}


    function ran2() internal view returns (uint16) {
    uint256 rand = uint256(
        keccak256(
            abi.encodePacked(block.prevrandao, block.timestamp, msg.sender)
        )
    );
    return uint8(rand % 100 + 1); // 1-100
}

    function geti(uint _pid)public view returns (uint16){
    
    return myinfo[_pid].intell;
    }

      function getc(uint _pid)public view returns (uint16){

    return myinfo[_pid].courage;
    }

     function gets(uint _pid)public view returns (uint16){
    
    return myinfo[_pid].strength;
    }

      function geta(uint _pid)public view returns (uint16){
    
    return myinfo[_pid].agility;
    }

       function gete(uint _pid)public view returns (uint16){
    
    return myinfo[_pid].endurance;
    }

        function getf(uint _pid)public view returns (uint16){
    
    return myinfo[_pid].flexibility;
    }
    
    function g1() public view virtual returns(uint256){  
    return pup.balanceOf(address(this));
  }
     function g9(address user) public view virtual returns(uint256){  
    return pupbank.g9(user);
  }
  function getowner(uint _pid)public view returns (address){
    
    return puppys[_pid].owner;
    }
}
