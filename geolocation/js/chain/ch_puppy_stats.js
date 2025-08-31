// 0~1000 원본값 → 파생값 (곱셈 스케일링 배제, 선형 변환)
export function ch_deriveGameStats(raw){
  const I = raw?.I ?? 0;
  const C = raw?.C ?? 0;
  const S = raw?.S ?? 0;
  const A = raw?.A ?? 0;
  const E = raw?.E ?? 0;
  const F = raw?.F ?? 0;

  return {
    moveSpeed:   3.5 + A / 200,           // 3.5 ~ 8.5 m/s
    meleeDamage: 20  + S * 0.5,           // 20 ~ 520
    critChance:  (C / 40) / 100,          // 0.00 ~ 0.25
    dodge:       Math.min(0.20, A/1000 * 0.20),
    dashCD:      Math.max(1.0, 6 - A/250),// 6.0 ~ 2.0
    energyMax:   100 + E,                 // 100 ~ 1100
    energyRegen: 2 + E / 200,             // 2 ~ 7 /10s
    ailResist:   (F / 40) / 100,          // 0.00 ~ 0.25
    skillCDR:    (I / 50) / 100           // 0.00 ~ 0.20
  };
}

// (선택) default도 함께 내보내면 import 스타일 혼동을 줄일 수 있습니다.
export default ch_deriveGameStats;
