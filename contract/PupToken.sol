// SPDX-License-Identifier: MIT
// ver1.2
pragma solidity >=0.7.0 <0.9.0;
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
   }

contract PupToken is IERC20 {
    string public constant name = "PupppyUtilityProtocol";
    string public constant symbol = "PUP";
    uint8 public constant decimals = 0;
    uint public totalSupply;
    address admin;
    mapping(address => uint256) balances;
    mapping(address => mapping (address => uint256)) allowed;
    mapping(address =>uint256)depot;


    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
   

   constructor() {
    admin=msg.sender;  
    totalSupply = 1e9;
    balances[msg.sender] = 1e9;
    }

   
   
   function balanceOf(address tokenOwner) public override view returns (uint256) {
        return balances[tokenOwner];
    }

    function transfer(address receiver, uint256 numTokens) public override returns (bool) {
        require(numTokens <= balances[msg.sender]);
        balances[msg.sender] = balances[msg.sender]-numTokens;
        balances[receiver] = balances[receiver]+numTokens;
        depot[receiver] = block.timestamp;
        emit Transfer(msg.sender, receiver, numTokens);
        return true;
    }

    function approve(address owner, uint256 numTokens) public override returns (bool) {
        allowed[owner][msg.sender] = numTokens;
        emit Approval(owner, msg.sender, numTokens);
        return true;
    }

    function allowance(address owner, address delegate) public override view returns (uint) {
        return allowed[owner][delegate];
    }

    function transferFrom(address owner, address buyer, uint256 numTokens) public override returns (bool) {
        require(numTokens <= balances[owner]);
        require(numTokens <= allowed[owner][msg.sender]);

        balances[owner] = balances[owner]-numTokens;
        allowed[owner][msg.sender] = allowed[owner][msg.sender]+numTokens;
        balances[buyer] = balances[buyer]+numTokens;
        emit Transfer(owner, buyer, numTokens);
        return true;
    }

        function g1()public view returns(uint256){ 
        return totalSupply;
  }
    function getdepot(address user)public view returns(uint256){ 
        return depot[user];
  }

    function mycctbalances() public view returns(uint256) {
        return balanceOf(msg.sender);
}
}