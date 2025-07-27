

// SPDX-License-Identifier: MIT  
// ver1.0
pragma solidity >=0.7.0 <0.9.0;


interface Ipaw {     
  function balanceOf(address account) external view returns (uint256);
  function allowance(address owner, address spender) external view returns (uint256);
  function transfer(address recipient, uint256 happy) external returns (bool);
  function approve(address spender, uint256 happy) external returns (bool);
  function transferFrom(address sender, address recipient, uint256 happy) external returns (bool);
  }

    interface Ipupbank{      
    function depoup(address _user, uint _depo) external;
    function getprice() external view returns (uint256);
    function getlevel(address user) external view returns (uint);
    function g9(address user) external view returns (uint);  // 각 depo현황
    function getagent(address user) external view returns (address);
    function getmento(address user) external view returns (address);
    function expup(address _user,uint _exp) external;
  
  }  
    

    contract PawGP {
    Ipaw paw;
    Ipupbank pupbank;
     uint tax;
     address public admin;
     address public tbank;
     mapping (address => uint)public staff;
  
   
  

     constructor(address _paw,address _pupbank) public { 
    
      paw = Ipaw(_paw);
      pupbank = Ipupbank(_pupbank);
      tbank = _pupbank;
      admin =msg.sender;
      staff[msg.sender] = 10;
      
      }
    


  function staffup(address _staff,uint8 num)public {  
        require( admin == msg.sender,"no admin"); 
        staff[_staff] = num;
        }   



  function charge (uint _pay)public {
    uint pay = _pay*1e18;
    require(g3(msg.sender) >= pay,"no paw");
    paw.approve(msg.sender,pay);
    uint256 allowance = paw.allowance(msg.sender, address(this));
    require(allowance >= pay, "Check the  allowance");
    paw.transferFrom(msg.sender, address(this),pay);
    address _mento =  pupbank.getmento(msg.sender);
    pupbank.depoup(_mento,_pay*1000*1/100);  //멘토 수당
    pupbank.depoup(msg.sender,_pay*1000);  //게임 포인트 충전
    pupbank.expup(msg.sender,pay*1/1E16);  //경험치
    taxout();
  }

   function taxout( )public{
    paw.transfer(tbank, g1()*50/100);

   } 



 function g1() public view virtual returns(uint256){  
  return paw.balanceOf(address(this));
  }
  


   function  g3(address user) public view returns(uint) {  
  return paw.balanceOf(user);
  }  

  



  function deposit()external payable{
  }
 
}
  