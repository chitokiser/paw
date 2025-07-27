/* globals Chart:false, ather:false */

(async () => {
  'use strict';

  await feather.replace({ 'aria-hidden': 'true' });

  // ====== Contract 설정 ======
  const contractAddress = {
    pubbankAddr: "0x535E13885fCAAAeF61aD1A5c7b70d9a97C151F4D" // PUPbank
  };
  const contractAbi = {
    pubbank: [
      "function g5(uint256 _num) public view returns(uint256)"
    ]
  };
  const provider = new ethers.providers.JsonRpcProvider(
    'https://opbnb-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3'
  );
  const pubbankContract = new ethers.Contract(
    contractAddress.pubbankAddr,
    contractAbi.pubbank,
    provider
  );

  // ====== 데이터 수집 및 OHLC 계산 ======
  let i = 0;      // g5() 호출 index
  let j = 4;      // 4틱마다 1캔들 생성
  let k = 0;      // 캔들 index
  let chartData = [];

  while (true) {
    try {
      // g5 값 가져오기
      const rawValue = await pubbankContract.g5(i);
      const close = parseFloat(ethers.utils.formatUnits(rawValue, 18)); // 숫자 변환

      // 새 캔들 시작 (open/high/low/close 초기화)
      if (j === 4) {
        j = 0;
        k++;

        chartData.push({
          x: k,
          y: [close, close, close, close] // [open, high, low, close]
        });

      } else {
        // 현재 캔들 갱신
        const candle = chartData[k - 1];

        // high 갱신
        if (close > candle.y[1]) candle.y[1] = close;

        // low 갱신
        if (close < candle.y[2]) candle.y[2] = close;

        // 마지막 값(close) 갱신 (마지막 틱일 때)
        if (j === 3) candle.y[3] = close;
      }

      i++;
      j++;
    } catch (e) {
      // 데이터 끝 (revert 발생)
      document.getElementById("calD").innerHTML = i;
      break;
    }
  }

  console.log("Final OHLC Data:", chartData);

  // ====== ApexCharts 옵션 ======
  const options = {
    series: [{
      data: chartData
    }],
    chart: {
      type: 'candlestick',
      height: 380,
      width: '100%'
    },
    xaxis: {
      type: 'numeric'
    },
    yaxis: {
      tooltip: {
        enabled: true
      }
    }
  };

  const chart = new ApexCharts(document.getElementById("myChart"), options);
  chart.render();

})();
