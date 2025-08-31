import { ch_CFG } from "./ch_config.js";
import { ch_ABI_GEOHUNT } from "./ch_abi_geohunt.js";
import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";

let _prov, _geoHunt;
const _cache = new Map(); // addr -> {ts, data}

export function ch_getProvider(){
  if (_prov) return _prov;
  if (ch_CFG.ui.preferInjected && window.ethereum){
    _prov = new ethers.providers.Web3Provider(window.ethereum);
  } else {
    _prov = new ethers.providers.JsonRpcProvider(ch_CFG.chain.rpc);
  }
  return _prov;
}

export function ch_getGeoHunt(){
  if (_geoHunt) return _geoHunt;
  _geoHunt = new ethers.Contract(ch_CFG.chain.geoHunt, ch_ABI_GEOHUNT, ch_getProvider());
  return _geoHunt;
}

export async function ch_loadPuppyStats(addr){
  if (!addr) throw new Error("no address");
  const now = Date.now();
  const c = _cache.get(addr);
  if (c && now - c.ts < 5*60*1000) return c.data;

  const gh = ch_getGeoHunt();
  const [tier, I, C, S, A, E, F, ALL] = await Promise.all([
    gh.getlevel(addr), gh.getmydogi(addr), gh.getmydogc(addr),
    gh.getmydogs(addr), gh.getmydoga(addr), gh.getmydoge(addr),
    gh.getmydogf(addr), gh.getmydogall(addr),
  ]);

  const data = {
    addr,
    tier: Number(tier),
    raw: { I:+I, C:+C, S:+S, A:+A, E:+E, F:+F, ALL:+ALL }
  };
  _cache.set(addr, { ts: now, data });
  return data;
}
