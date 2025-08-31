// /geolocation/js/chain/ch_config.js
export const ch_CFG = {
  chain: {
    rpc: "https://opbnb-mainnet-rpc.bnbchain.org", // 실제 RPC로 교체
    geoHunt: "0x1Af8EFFD3CA2CADd0C57F043C7c37e6684C97b28"                 // 실제 GeoHunt 주소로 교체
  },
  ui: { preferInjected: true }
};

// (선택) default도 함께 내보내 두면 다른 import 스타일도 호환됨
export default ch_CFG;
