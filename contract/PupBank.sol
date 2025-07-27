// SPDX-License-Identifier: MIT  
// ver1.0
pragma solidity >=0.7.0 <0.9.0;

interface Ipaw {     
  function balanceOf(address account) external view returns (uint256);
  function allowance(address owner, address spender) external view returns (uint256);
  function transfer(address recipient, uint256 amount) external returns (bool);
  function approve(address spender, uint256 amount) external returns (bool);
  function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface Ipup {      
  function balanceOf(address account) external view returns (uint256);
  function allowance(address owner, address spender) external view returns (uint256);
  function transfer(address recipient, uint256 amount) external returns (bool);
  function approve(address spender, uint256 amount) external returns (bool);
  function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
  function g1() external view returns(uint256);
  function getdepot(address user) external view returns(uint256);
}

contract pupbank {
  Ipaw paw;
  Ipup pup;
  uint256 public totaltax; 
  uint256 public pupAmount;
  uint256 public tax;  
  uint8 public act;  
  uint256 public allow;
  address public bank; 
  address public admin;
  uint256 public sum;   
  uint256 public sold;  
  uint8 public commission; 
  uint256 public fix;  
  address public owner; 
  uint256[] public chart; 
  uint256 public price;  
  mapping (address => my) public myinfo;
  mapping (address => address[]) public mymenty;
  mapping (address => uint) public staff;
  mapping (address => uint) public fa;
  mapping (address => uint) public allowt; 
  mapping (address => bool) public buffcheck;
  event getpaw(uint amount);

     
  constructor(address _paw, address _pup, address _pupb) {
    fix = 1e16;  
    paw = Ipaw(_paw);
    pup = Ipup(_pup);
    bank = _pupb;  
    price = 1e16;
    sold = 1000;
    act =3 ;
    admin = msg.sender;
    staff[msg.sender] = 10;
    myinfo[msg.sender].level = 10;
    commission = 30;
    pupAmount = 500;
  }
    
  struct my {
    uint256 totalpup; 
    uint256 depo;  //게임 포인트
    uint256 level;
    address mento; 
    uint256 exp;
  }
    


  function actup(uint8 _num) public {  
    require(admin == msg.sender, "no admin"); 
    act = _num;
  }
  function staffup(address _staff, uint8 num) public {  
    require(admin == msg.sender, "no admin"); 
    staff[_staff] = num;
  }   

  function faup(address _fa) public {  
    require(admin == msg.sender, "no admin"); 
    fa[_fa] = 5;
  }   
  
  function depoup(address _user, uint _depo) public {  
    require(fa[msg.sender] >= 5, "no family");
    myinfo[_user].depo += _depo;
  }

  function expup(address _user, uint _exp) public {  
    require(fa[msg.sender] >= 5, "no family");
    myinfo[_user].exp += _exp;
  }

  function depodown(address _user, uint _depo) public {  
    require(fa[msg.sender] >= 5, "no family");
    myinfo[_user].depo -= _depo;
  }



  function memberjoin(address _mento) public {  
    require(myinfo[msg.sender].level == 0, "already member"); 
    require(myinfo[_mento].level >= 2, "no mento"); 
    myinfo[msg.sender].level = 1;
    myinfo[msg.sender].mento = _mento;
    mymenty[_mento].push(msg.sender);
    sum += 1;
  }

  function ownerup(address _owner) public {  
    require(staff[msg.sender] >= 5, "no staff");
    owner = _owner;
  }

  function bankup(address _bank) public {  
    require(staff[msg.sender] >= 5, "no staff");
    bank = _bank;  
  }

  function buypup(uint _num) public returns(bool) {  
    uint pay = _num * price;
    require(act >= 1, "Not for sale");  
    require(g3() >= _num, "Cut sold out");  
    require(1 <= _num, "1 or more");
    require(1 <= myinfo[msg.sender].level, "no member");
    require(paw.balanceOf(msg.sender) >= pay, "no cya"); 
    paw.approve(msg.sender, pay); 
    uint256 allowance = paw.allowance(msg.sender, address(this));
    require(allowance >= pay, "Check the token allowance");
    paw.transferFrom(msg.sender, address(this), pay);  
    pup.transfer(msg.sender, _num);
    myinfo[msg.sender].exp += _num / 10;
    myinfo[myinfo[msg.sender].mento].depo += pay * commission / 100;
    allowt[msg.sender] = block.timestamp;
    priceup();
    tax += pay * 5 / 100;
    return true;     
}

function levelup() public {
    uint256 mylev = myinfo[msg.sender].level;
    uint256 myexp = myinfo[msg.sender].exp;
    require(mylev >= 1  && myexp >= 2**mylev * 10000, "Insufficient requirements");
    myinfo[msg.sender].exp -= 2**mylev * 10000;
    myinfo[msg.sender].level += 1;
    myinfo[myinfo[msg.sender].mento].exp += mylev*5555;
}

function sellpup(uint num) public returns(bool) {      
    uint256 pay = num * price;  
    require(act >= 3, "Can't sell"); 
    require(1 <= num, "1 or more");
    require(6 <= getlevel(msg.sender), "Level 6 or higher"); 
    require(g8(msg.sender) >= num, "no paw");
    require(g1() >= pay, "Contract paw balance insufficient");
    pup.approve(msg.sender, num);
    uint256 allowance = pup.allowance(msg.sender, address(this));
    require(allowance >= num, "Check the allowance");
    pup.transferFrom(msg.sender, address(this), num); 
    paw.transfer(msg.sender, pay);
    myinfo[msg.sender].level -= 1; 
    priceup();
    return true;
}

function allowcation() public returns(bool) {   
    require(act >= 2, "No dividend");  
    require(getlevel(msg.sender) >= 1, "no member");  
    require(g8(msg.sender) >= 5000, "More than 5000SUT"); 
    require(allowt[msg.sender] + 7 days < block.timestamp, "not time"); 
    require(pup.getdepot(msg.sender) + 7 days < block.timestamp, "pup not time"); 
    allowt[msg.sender] = block.timestamp;
    uint256 pay = getpay(msg.sender); 
    paw.transfer(msg.sender,pay);
    myinfo[msg.sender].exp += 5000;
    emit getpaw(pay);
    return true;
}
  
function withdraw() public {    //gp1000점당 레벨만큼 
    uint  mypoint = myinfo[msg.sender].depo;
    require(mypoint >= 10000, "Requires 10,000 or more game points"); 
    uint pupamount = mypoint*getlevel(msg.sender)/1000;
    require(pupamount <= g3(), "Not enough pup for contract");  
    myinfo[msg.sender].depo = 0;
    myinfo[myinfo[msg.sender].mento].depo += mypoint * commission/60; 
    myinfo[msg.sender].totalpup += pupamount;
    pup.transfer(msg.sender,pupamount);
}

 function buffing() public {  
    require(pup.balanceOf(msg.sender) >= pupAmount, "pup is not enough"); 
    require(pupbank.getlevel(msg.sender)>= 1, "Must be level 1 or higher"); 
    require(buffcheck[msg.sender] == false, "Already got the buff"); 
    
    buffcheck[msg.sender] = true;
    myinfo[msg.sender].level = 2;
  }


function fixup(uint256 _fix) public { 
    require(admin == msg.sender, "no admin");
    fix = _fix;  
}  


function commissionup(uint8 _commission) public {  
    require(admin == msg.sender, "no admin");
    commission = _commission;  
}  

function priceup() public {
    sold = g11();
    allow = g1() / (sold); 
    price = allow + fix;
    chart.push(price);   
}


function g1() public view virtual returns(uint256) {  
    return paw.balanceOf(address(this));
}

function g3() public view returns(uint) { 
    return pup.balanceOf(address(this));
}  

  function g4() public view virtual returns(uint){  
  return chart.length;
  }
    function g5(uint _num) public view virtual returns(uint256){  
  return chart[_num];
  }
function g6() public view virtual returns(uint256){  
  return pup.balanceOf(address(this));
  }
function g8(address user) public view returns(uint) {  
    return pup.balanceOf(user);
}  

function g9(address user) public view returns(uint) {  
    return myinfo[user].depo;
}  

function getlevel(address user) public view returns(uint) {  
    return myinfo[user].level;
}  


    
function getmento(address user) public view returns(address) {  
    return myinfo[user].mento;
}  

function g10() public view virtual returns(uint256) {  
    return pup.g1();  
}

function g11() public view virtual returns(uint256) {  
    return g10() - g3();  
}
  

function getpay(address user) public view returns (uint256) { 
    return g8(user) * allow * getlevel(user) / 2000;
}
  
function gettime() public view returns (uint256) {  
    return (allowt[msg.sender] + 604800) - block.timestamp;
}

function getprice() public view returns (uint256) {  
    return price;
}

function getmymenty(address user) public view returns (address[]memory) {  
    return mymenty[user];
}

function deposit() external payable {}
}
