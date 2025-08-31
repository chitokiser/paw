import { ch_getProvider, ch_loadPuppyStats } from "./ch_client_geohunt.js";

export async function ch_requestAccounts(){
  const prov = ch_getProvider();
  if (prov?.send) {
    try { await prov.send("eth_requestAccounts", []); } catch {}
  }
  const signer = prov.getSigner?.();
  const addr = signer && (await signer.getAddress?.().catch(()=>null));
  return addr || null;
}

export async function ch_connectAndLoad(){
  const addr = await ch_requestAccounts();
  if (!addr) throw new Error("Wallet not connected");
  const data = await ch_loadPuppyStats(addr);
  return data; // {addr, tier, raw}
}
