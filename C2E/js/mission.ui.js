// mission.ui.js — UI helpers & renderers (하드닝 버전)
// ES 모듈 전제: <script type="module" src="./mission.ui.js"></script>
// mission.api.js도 ES 모듈로 CHAIN_ID_HEX, C2E_ADDR를 export 해야 합니다.

import { CHAIN_ID_HEX, C2E_ADDR } from "./mission.api.js";

export function toast(msg, ok = true) {
  // 중복 토스트가 겹치지 않도록 컨테이너 1개만 유지
  let host = document.getElementById("__toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "__toastHost";
    host.className = "position-fixed top-0 start-50 translate-middle-x p-3";
    host.style.zIndex = 2000;
    document.body.appendChild(host);
  }
  const wrap = document.createElement("div");
  wrap.innerHTML =
    `<div class="toast align-items-center text-white ${ok ? "bg-success" : "bg-danger"} border-0 show" role="alert" aria-live="assertive" aria-atomic="true">
       <div class="d-flex">
         <div class="toast-body">${msg}</div>
         <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
       </div>
     </div>`;
  host.appendChild(wrap);
  // 버튼 닫기 동작 보장
  wrap.querySelector("button")?.addEventListener("click", () => wrap.remove());
  // 자동 제거
  setTimeout(() => wrap.remove(), 3500);
}

export const $  = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
const setDisabled = (sel, flag) => { const el = $(sel); if (el) el.disabled = !!flag; };

export const fmtPAW = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return "-";
  return `${num.toLocaleString(undefined, { maximumFractionDigits: 4 })} PAW`;
};

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "-");

// ⛏️ 버그 수정: 기존 isFinite(d)는 Date 객체로 항상 false.
// → getTime()이 유효한지 검사해야 함.
export const ts2date = (t) => {
  const sec = Number(t);
  if (!Number.isFinite(sec)) return "-";
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
};

export function showChain(cidHex) {
  const hex = String(cidHex || CHAIN_ID_HEX || "").trim();
  let dec = NaN;
  try { dec = Number.parseInt(hex, 16); } catch {}
  setText("#chainBadge", `Network: ${hex || "unknown"} (opBNB)`);
  setText("#chainInfo", `opBNB (chainId ${Number.isFinite(dec) ? dec : "?"})`);
}

export function showMe(me) {
  const addr = String(me || "-");
  setText("#btnConnect", short(addr));
  setText("#meAddr", addr);
  setText("#noteAddr", addr);
  setDisabled("#btnWithdraw", false);
}

export function showContractShort() {
  setText("#caddr", short(C2E_ADDR));
}

// wei → PAW(18dec) 안전 포맷 (BigInt 우선, 실패 시 Number 폴백)
function formatWeiToPaw(val) {
  try {
    const bi = typeof val === "bigint" ? val : BigInt(val);
    const INT = bi / 10n ** 18n;
    const FR  = bi % 10n ** 18n;
    const frac4 = String(FR).padStart(18, "0").slice(0, 4);
    return `${INT.toString()}.${frac4} PAW`;
  } catch {
    // 값이 string/number지만 BigInt 불가일 때 폴백
    const num = Number(val) / 1e18;
    return fmtPAW(num);
  }
}

export function renderTop10(rows = []) {
  const tbody = $("#topRankBody");
  if (!tbody) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">데이터 없음</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  rows.forEach((it, i) => {
    const addr = it?.addr || "-";
    const val  = it?.val ?? 0;
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${i + 1}</td>
       <td class="addr" title="${addr}">${short(addr)}</td>
       <td class="text-end">${formatWeiToPaw(val)}</td>`;
    tbody.appendChild(tr);
  });
}
