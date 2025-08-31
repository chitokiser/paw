// /geolocation/js/chain.js
import { CFG } from "../js/config.js";
import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";

const GeoHuntABI = [
  "function getlevel(address) view returns(uint256)",
  "function getmydogi(address) view returns(uint256)",
  "function getmydogc(address) view returns(uint256)",
  "function getmydogs(address) view returns(uint256)",
  "function getmydoga(address) view returns(uint256)",
  "function getmydoge(address) view returns(uint256)",
  "function getmydogf(address) view returns(uint256)",
  "function getmydogall(address) view returns(uint256)"
];

let _provider, _geoHunt;
const _cache = new Map(); // addr -> {ts, data}

export function getProvider() {
  if (_provider) return _provider;

  // 1) 지갑 주입 우선
  if (CFG.ui.preferInjected && typeof window !== "undefined" && window.ethereum) {
    _provider = new ethers.providers.Web3Provider(window.ethereum);
    return _provider;
  }
  // 2) 읽기 전용 RPC
  _provider = new ethers.providers.JsonRpcProvider(CFG.chain.rpc);
  return _provider;
}

export function getGeoHunt() {
  if (_geoHunt) return _geoHunt;
  _geoHunt = new ethers.Contract(CFG.chain.geoHunt, GeoHuntABI, getProvider());
  return _geoHunt;
}

export async function requestAccountsIfNeeded(){
  const prov = getProvider();
  if (prov.send) {
    try { await prov.send("eth_requestAccounts", []); } catch {}
  }
  const signer = prov.getSigner?.();
  const addr = signer && (await signer.getAddress?.().catch(()=>null));
  return addr || null;
}

export async function loadPuppyStats(addr){
  if (!addr) throw new Error("no address");
  const now = Date.now();
  const c = _cache.get(addr);
  if (c && now - c.ts < 5*60*1000) return c.data; // 5분 캐시

  const gh = getGeoHunt();
  const [tier, I, C, S, A, E, F, ALL] = await Promise.all([
    gh.getlevel(addr),
    gh.getmydogi(addr),
    gh.getmydogc(addr),
    gh.getmydogs(addr),
    gh.getmydoga(addr),
    gh.getmydoge(addr),
    gh.getmydogf(addr),
    gh.getmydogall(addr),
  ]);

  const data = {
    addr,
    tier: Number(tier),
    raw: {
      I: Number(I), C: Number(C), S: Number(S),
      A: Number(A), E: Number(E), F: Number(F), ALL: Number(ALL)
    }
  };
  _cache.set(addr, { ts: now, data });
  return data;
}
