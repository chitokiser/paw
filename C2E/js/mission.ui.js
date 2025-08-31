// mission.ui.js — UI helpers & renderers
import { CHAIN_ID_HEX, C2E_ADDR } from "./mission.api.js";

export function toast(msg, ok=true){
  const el = document.createElement("div");
  el.className = "position-fixed top-0 start-50 translate-middle-x p-3";
  el.style.zIndex = 2000;
  el.innerHTML = `<div class="toast align-items-center text-white ${ok?'bg-success':'bg-danger'} border-0 show" role="alert"><div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div></div>`;
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 3500);
}

export const $ = (s, el=document)=> el.querySelector(s);
export const $$ = (s, el=document)=> [...el.querySelectorAll(s)];
export const fmtPAW = (n)=> `${Number(n).toLocaleString(undefined,{maximumFractionDigits:4})} PAW`;
export const short = (a)=> a ? a.slice(0,6)+"…"+a.slice(-4) : "-";
export const ts2date = (t)=> { if(!t) return "-"; const d = new Date(Number(t)*1000); return isFinite(d)? d.toLocaleString() : "-"; };

export function showChain(cidHex){ $("#chainBadge").textContent = `Network: ${cidHex} (opBNB)`; $("#chainInfo").textContent = `opBNB (chainId ${parseInt(cidHex,16)})`; }
export function showMe(me){ $("#btnConnect").textContent = short(me); $("#meAddr").textContent = me; $("#noteAddr").textContent = me; $("#btnWithdraw").disabled = false; }
export function showContractShort(){ $("#caddr").textContent = short(C2E_ADDR); }

export function renderTop10(rows){
  const tbody = $("#topRankBody");
  if(!tbody) return;
  tbody.innerHTML = rows.length ? "" : `<tr><td colspan="3" class="text-center text-muted">데이터 없음</td></tr>`;
  rows.forEach((it, i)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i+1}</td><td class="addr">${short(it.addr)}</td><td class="text-end">${fmtPAW(Number(it.val)/1e18)}</td>`;
    tbody.appendChild(tr);
  });
}
