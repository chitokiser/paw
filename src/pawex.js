
   
      const contractAddress = {
        cyadexAddr: "0xa100276E165895d09A58f7ea27321943F50e7E61", //pawex  
        cyabankAddr:"0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D", //pupbank
        erc20: "0xCC1ce312b7A7C4A78ffBf51F8fc0e087C1D4c72f" //paw
      };
      const contractAbi = {
        cyadex: [
          "function getprice() public view returns(uint256)",
          "function balance() public view returns(uint256)",
          "function pawbalances() public view returns(uint256)",
          "function pawbuy() external payable",
          "function bnbsell(uint256 num) external",
          "function priceup(uint256 newPrice) external",
        ],
        cyamem: [
          "function sum() public view returns(uint256)",
          "function catbal() public view returns(uint256)"
        ],

        cyabank: [
          "function g1() public view virtual returns(uint256)",
          "function price() public view returns(uint256)",
          "function g6() public view virtual returns",
          "function g7() public view virtual returns(uint256)",
          "function g10() public view virtual returns(uint256)",
          "function allow() public view returns(uint256)",
          "function g11() public view virtual returns(uint256)"
        ],
        erc20: [
          "function approve(address spender, uint256 amount) external returns (bool)",
          "function allowance(address owner, address spender) external view returns (uint256)"
        ]
      };
      const topDataSync = async () => {
    
      

       // ethers setup
       let provider = new ethers.providers.JsonRpcProvider('https://opbnb-mainnet-rpc.bnbchain.org');
       let cyadexContract = new ethers.Contract(contractAddress.cyadexAddr, contractAbi.cyadex, provider);
       let price = await cyadexContract.getprice();  //bnb설정가격
        let pawbal = await cyadexContract.pawbalances();  //잔고
       document.getElementById("currentPrice").innerHTML= (price/1e18).toFixed(2);;
       document.getElementById("PAWbalan").innerHTML = (pawbal / 1e18).toFixed(2);
        };
     
        
     
     

        const buyCya = async () => {
          const userProvider = new ethers.providers.Web3Provider(window.ethereum, "any");
          await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{
                  chainId: "0xCC",
                  rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
                  chainName: "opBNB",
                  nativeCurrency: {
                      name: "BNB",
                      symbol: "BNB",
                      decimals: 18
                  },
                  blockExplorerUrls: ["https://opbnbscan.com"]
              }]
          });
          await userProvider.send("eth_requestAccounts", []);
          const signer = userProvider.getSigner();
  
          const cyadexContract = new ethers.Contract(contractAddress.cyadexAddr, contractAbi.cyadex, signer);
          await cyadexContract.zembuy({ value: ethers.utils.parseUnits(document.getElementById('bnbInput').value, 'ether') });
        };
  
        const sellCya = async () => {
          const userProvider = new ethers.providers.Web3Provider(window.ethereum, "any");
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
                chainId: "0xCC",
                rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
                chainName: "opBNB",
                nativeCurrency: {
                    name: "BNB",
                    symbol: "BNB",
                    decimals: 18
                },
                blockExplorerUrls: ["https://opbnbscan.com"]
            }]
        });
          await userProvider.send("eth_requestAccounts", []);
          const signer = userProvider.getSigner();
  
          const quantity = ethers.utils.parseUnits(document.getElementById('cyaInput').value, 18);
  
          // Approve
          const erc20 = new ethers.Contract(contractAddress.erc20, contractAbi.erc20, signer);
          if (await erc20.allowance(await signer.getAddress(), contractAddress.cyadexAddr) < quantity) {
            await erc20.approve(contractAddress.cyadexAddr, 2^256-1);
          }
          // Sell
          const cyadexContract = new ethers.Contract(contractAddress.cyadexAddr, contractAbi.cyadex, signer);
          await cyadexContract.bnbsell(quantity);
        };
  


const Priceup = async () => {
  const userProvider = new ethers.providers.Web3Provider(window.ethereum, "any");
  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: "0xCC",
      rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
      chainName: "opBNB",
      nativeCurrency: {
        name: "BNB",
        symbol: "BNB",
        decimals: 18
      },
      blockExplorerUrls: ["https://opbnbscan.com"]
    }]
  });

  await userProvider.send("eth_requestAccounts", []);
  const signer = userProvider.getSigner();
  const cyadexContract = new ethers.Contract(contractAddress.cyadexAddr, contractAbi.cyadex, signer);

  const newPriceInput = document.getElementById("newPriceInput").value;

  if (!newPriceInput || isNaN(newPriceInput)) {
    alert("정확한 가격(예: 0.001)을 입력하세요.");
    return;
  }

  const newPrice = ethers.utils.parseUnits(newPriceInput, 18);  // 여기 다시 필요함

  try {
    const tx = await cyadexContract.priceup(newPrice);
    console.log("트랜잭션 전송됨:", tx.hash);
    await tx.wait();
    alert("가격이 성공적으로 업데이트되었습니다.");
  } catch (err) {
    console.error("priceup 실패:", err);
    alert("트랜잭션 실패: " + err.message);
  }
};





     (async () => {
          topDataSync();
          let userProvider = new ethers.providers.Web3Provider(window.ethereum, "any");
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
                chainId: "0xCC",
                rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
                chainName: "opBNB",
                nativeCurrency: {
                    name: "BNB",
                    symbol: "BNB",
                    decimals: 18
                },
                blockExplorerUrls: ["https://opbnbscan.com"]
            }]
        });
          await userProvider.send("eth_requestAccounts", []);
          
          let cyadexContract = new ethers.Contract(contractAddress.cyadexAddr, contractAbi.cyadex, userProvider);
          let selectElement = document.getElementById('bnbInput');
          let selectElement2 = document.getElementById('cyaInput');
          
          selectElement.addEventListener('change', async (event) => {
            if (event.target.value < 0.001) {
              alert("now enough value");
            } else {
             const price = await cyadexContract.getprice(); // 예: 750000000000000000000
      const priceFloat = parseFloat(ethers.utils.formatUnits(price, 18)); // 750.0
      document.getElementById('bnbOutput').value = priceFloat;
            }
          });
          selectElement2.addEventListener('change', async (event) => {
            document.getElementById('cyaOutput').value=event.target.value/parseFloat(await cyadexContract.getprice())*1e18*990/1000
          })
          })();