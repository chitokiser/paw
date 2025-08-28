document.addEventListener("DOMContentLoaded", async function () {
   
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  
  const signer = provider.getSigner();
  
  
  
  const metaddr = {
      metmarket: "0xec2d1835f77Fc92FDBA3EcA531c1482C970D1B07" //football
  };

  const metabi = {
      metmarket: [
          "function beting(uint _pid, uint _betmoney, uint8 _betcase) public",
          "function withdraw(uint _pid) public",
          "function pid() public view returns(uint256)",
          "function bid() public view returns(uint256)",
          "function bets(address user,uint _pid) public view returns(uint256)",
          "function getCurrentTime() public view returns (uint)",
          "function getmybet(address user, uint _pid) public view returns (uint)",
          "function ms(uint _num) public view returns (string,uint,uint8,uint,uint)",
          "function getmybet(address user, uint _pid) public view returns (uint)",
          "function getOdds(uint _pid) public view returns (uint[3] memory) ",
          "function getTotal(uint _pid) public view returns (uint[3] memory)",
          "function resultup(uint _pid,uint8 _result,uint _hs,uint _as)", 
      ]
  };  

  const meta5Contract = new ethers.Contract(metaddr.metmarket, metabi.metmarket, provider);
  const metaContract = new ethers.Contract(metaddr.metmarket, metabi.metmarket, signer);
  async function ftopSync() {
      try {
        
          const ipid = (await meta5Contract.pid()).toString();

          const ibid = (await meta5Contract.bid()).toString();

          document.getElementById("Pid").innerHTML = ipid;
          document.getElementById("Bid").innerHTML = ibid;
      } catch (error) {
     
          document.getElementById("Pid").innerHTML = "Error loading PID";
          document.getElementById("Bid").innerHTML = "Error loading BID";
      }
  }

  async function getMetaInfoByNum(contract, _num) {
      try {
          console.log(`Fetching ms data for _num: ${_num}`);
          const metaInfo = await contract.ms(_num);

          return {
              name: metaInfo[0],        // string: 이름 (
              endtime: metaInfo[1],     // uint256: 종료 시간 (타임스탬프)
              result: metaInfo[2],      // uint8: 결과 (0)
              homescore: metaInfo[3],   // uint256: 홈팀 점수
              awayscore: metaInfo[4]    // uint256: 원정팀 점수
          };
      } catch (error) {
          console.error(`Error fetching data for _num ${_num}:`, error);
          return null;
      }
  }

  async function displayMetaInfo() {
      try {
      
          const ipid = await meta5Contract.pid();  // PID 값 얻기
          console.log(`Total PIDs: ${ipid}`);
          const infoContainer = document.getElementById("metaInfoContainer");

          // PID가 0부터 ipid-1까지 데이터가 있다고 가정하고 순차적으로 가져오기
          for (let i = 0; i < ipid; i++) {
              const metaInfo = await getMetaInfoByNum(meta5Contract, i);
              if (!metaInfo) continue;  // 메타 정보가 없으면 건너뜁니다.
              const odds = await meta5Contract.getOdds(i);
              const totalBets = await meta5Contract.getTotal(i);

              const infoHtml = `
  <div class="card mb-3" id="productCard${i}">
      <div class="card-body">
          <h5 class="card-title">${metaInfo.name}</h5>
         <p class="card-text"><strong>경기시작(GMT기준):</strong> ${new Date(metaInfo.endtime * 1000).toLocaleString("en-US", { timeZone: "GMT" })}</p>
          <p class="card-text"><strong>결과:</strong> 
              ${metaInfo.result === 0 ? "진행 중" : 
                metaInfo.result === 1 ? "홈팀 승" : 
                metaInfo.result === 2 ? "무승부" : "원정팀 승"}
          </p>
          <p class="card-text"><strong>홈팀 점수:</strong> ${metaInfo.homescore}</p>
          <p class="card-text"><strong>원정팀 점수:</strong> ${metaInfo.awayscore}</p>
             <!-- Display Odds and Total Bets -->
                      <p class="card-text"><strong>배당률:</strong> 홈팀(${odds[0]/10}), 무승부(${odds[2]/10}), 원정팀(${odds[1]/10})</p>
                      <p class="card-text"><strong>누적 배팅금:</strong> 홈팀(${totalBets[0]/1E18} GP), 무승부(${totalBets[2]/1E18} GP), 원정팀(${totalBets[1]}GP)</p>
          <!-- 배팅하기 버튼과 배팅 폼 -->
          <button type="button" onclick="openBetForm(${i})">배팅하기</button>
          <div id="betFormContainer${i}" style="display: none;">
              <form id="betForm${i}">
                  <label for="betMoney${i}">배팅 금액:</label>
                  <input type="number" id="betMoney${i}" min="1" required>
                  <label for="betCase${i}">배팅 옵션 (0: 홈팀승, 1: 원정팀승, 2: 무승부):</label>
                  <select id="betCase${i}">
                      <option value="0">홈팀</option>
                      <option value="1">원정팀</option>
                      <option value="2">무승부</option>
                  </select>
                  <button type="button" onclick="submitBetForm(${i})">배팅 완료</button>
                  <button type="button" onclick="closeBetForm(${i})">취소</button>
              </form>
          </div>

           <button type="button" onclick="viewMyPayout(${i})">배팅금액 보기</button>
                      <button type="button" onclick="withdrawPayout(${i})">배당금 인출하기</button>
      </div>

         <button type="button" onclick="openResultForm(${i})" style="background-color: red; color: white; padding: 5px 10px; font-size: 12px;">결과 입력</button>
          <div id="resultFormContainer${i}" style="display: none;">
              <form id="resultForm${i}">
                  <label for="result${i}">경기 결과 (0: 홈팀승, 1: 원정팀승, 2: 무승부):</label>
                  <select id="result${i}">
                      <option value="1">경기결과 홈팀 승</option>
                      <option value="2">경기결과 원정팀 승</option>
                      <option value="0">경기결과 무승부</option>
                  </select>
                  <label for="homeScore${i}">홈팀 점수:</label>
                  <input type="number" id="homeScore${i}" required>
                  <label for="awayScore${i}">원정팀 점수:</label>
                  <input type="number" id="awayScore${i}" required>
                  <button type="button" onclick="submitResultForm(${i})">결과 제출</button>
                  <button type="button" onclick="closeResultForm(${i})">취소</button>
              </form>
</div>
      </div>
  </div>`;

              // HTML을 하나씩 추가
              infoContainer.innerHTML += infoHtml;

              // 각 데이터를 순차적으로 표시 후 일정 시간 지연
              await new Promise(resolve => setTimeout(resolve, 300));  // 300ms 지연 후 다음 항목 추가
          }
      } catch (error) {
          console.error("메타 정보 표시 중 오류 발생:", error);
      }
  }

  // 배팅 폼 열기
  window.openBetForm = function(i) {
      document.getElementById(`betFormContainer${i}`).style.display = 'block';
  };

  // 배팅 폼 닫기
  window.closeBetForm = function(i) {
      document.getElementById(`betFormContainer${i}`).style.display = 'none';
  };

  // 배팅 완료 제출
  window.submitBetForm = async function(i) {
      const betMoney = document.getElementById(`betMoney${i}`).value;
      const betCase = document.getElementById(`betCase${i}`).value;

      try {
          const tx = await metaContract.beting(i, betMoney, betCase, { gasLimit: 500000 });

          console.log(`배팅 완료! 트랜잭션 해시: ${tx.hash}`);
          // 트랜잭션 완료 후 처리 로직
      } catch (e) {
          alert(e.message.replace('execution reverted: ',''));
      }
  };

  // Function to view the user's payout amount
window.viewMyPayout = async function(pid) {
  try {
      const userAddress = await signer.getAddress();
      const payoutAmount = await meta5Contract.bets(userAddress, pid);
      alert(`나의배팅금액: ${payoutAmount/1e18}GP`);
  } catch (error) {
      console.error("Error fetching my payout:", error);
      alert("배팅금액이 없습니다");
  }
};

// Function to withdraw the payout amount for the specified PID
window.withdrawPayout = async function(pid) {
  try {
      const tx = await metaContract.withdraw(pid);
      console.log(`배당금 인출 요청 성공! 트랜잭션 해시: ${tx.hash}`);
      alert(`배당금 인출 요청이 성공했습니다! 트랜잭션 해시: ${tx.hash}`);
  } catch (error) {
      console.error("Error withdrawing payout:", error);
      alert("배당금이 없습니다");
  }
};


// 결과 입력 폼 열기
window.openResultForm = function(i) {
  document.getElementById(`resultFormContainer${i}`).style.display = 'block';
};

// 결과 입력 폼 닫기
window.closeResultForm = function(i) {
  document.getElementById(`resultFormContainer${i}`).style.display = 'none';
};

// 결과 입력 완료 제출
window.submitResultForm = async function(i) {
  const result = document.getElementById(`result${i}`).value;
  const homeScore = document.getElementById(`homeScore${i}`).value;
  const awayScore = document.getElementById(`awayScore${i}`).value;

  try {
      const tx = await metaContract.resultup(i, result, homeScore, awayScore);
      console.log(`결과 입력 완료! 트랜잭션 해시: ${tx.hash}`);
      // 트랜잭션 완료 후 처리 로직
  } catch (e) {
      alert(e.message.replace('execution reverted: ',''));
  }
};


  // 데이터 로딩 함수 호출
  await ftopSync();
  await displayMetaInfo();
});
