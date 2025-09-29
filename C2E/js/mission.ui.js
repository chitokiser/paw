// mission.ui.js — UI helpers (ESM exports)

const ethers = globalThis.ethers;

// ───────────────────────────────────────
// DOM helpers
// ───────────────────────────────────────
export function $(sel, root = document) { return root.querySelector(sel); }

export function toast(msg, ok = true, ms = 2500) {
  let box = document.getElementById("__toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "__toasts";
    box.style.position = "fixed";
    box.style.right = "16px";
    box.style.bottom = "16px";
    box.style.zIndex = "9999";
    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.gap = "8px";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.textContent = String(msg);
  el.style.padding = "10px 12px";
  el.style.borderRadius = "10px";
  el.style.border = "1px solid rgba(255,255,255,.15)";
  el.style.background = ok ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.15)";
  el.style.color = "#e9eefc";
  el.style.backdropFilter = "blur(6px)";
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ───────────────────────────────────────
// Formatting
// ───────────────────────────────────────
/** format 18-decimals wei BigInt → "12.3456 PAW" */
export function formatWei(value, unit = "PAW", maxFrac = 4) {
  if (value == null) return `0 ${unit}`;
  let wei;
  try {
    if (typeof value === "bigint") wei = value;
    else if (typeof value === "number") wei = BigInt(Math.trunc(value));
    else if (typeof value === "string") wei = BigInt(value);
    else if (typeof value.toString === "function") wei = BigInt(value.toString());
    else wei = 0n;
  } catch { wei = 0n; }

  const base = 10n ** 18n;
  const whole = wei / base;
  const frac  = wei % base;

  // group whole if safe
  const wholeStr = (typeof whole === "bigint" && whole <= BigInt(Number.MAX_SAFE_INTEGER))
    ? Number(whole).toLocaleString()
    : whole.toString();

  let fracStr = frac.toString().padStart(18, "0").slice(0, maxFrac);
  fracStr = fracStr.replace(/0+$/g, ""); // trim trailing zeros
  return `${wholeStr}${fracStr ? "." + fracStr : ""} ${unit}`;
}

/** number(토큰 단위) → "12.34 PAW" */
export function fmtPAW(n, maxFrac = 4) {
  const num = typeof n === "number" ? n : Number(n || 0);
  return `${num.toLocaleString(undefined, { maximumFractionDigits: maxFrac })} PAW`;
}

export function short(addr, left = 6, right = 4) {
  if (!addr || typeof addr !== "string") return "-";
  if (addr.length <= left + right + 2) return addr;
  return addr.slice(0, left + 2) + "…" + addr.slice(-right);
}

// ───────────────────────────────────────
// Chain / Me / Contract UI
// ───────────────────────────────────────
export async function showChain() {
  const badge = $("#chainBadge");
  const info  = $("#chainInfo");
  let text = "Unknown";
  try {
    if (globalThis.ethereum) {
      const prov = new ethers.BrowserProvider(globalThis.ethereum, "any");
      const net = await prov.getNetwork();
      const id  = Number(net.chainId);
      const hex = "0x" + id.toString(16);
      const name = (id === 204) ? "opBNB" : (net.name || "EVM");
      text = `${name} (${hex})`;
      if (badge) badge.textContent = `Network: ${name}`;
      if (info)  info.textContent  = `${text}`;
      return;
    }
  } catch {}
  if (badge) badge.textContent = `Network: ${text}`;
  if (info)  info.textContent  = text;
}

export async function showMe() {
  const el = $("#meAddr");
  if (!el) return;
  try {
    let addr = "-";
    if (globalThis.ethereum?.request) {
      const accts = await globalThis.ethereum.request({ method: "eth_accounts" });
      if (accts && accts[0]) addr = accts[0];
    }
    el.textContent = addr;
    el.title = addr;
  } catch {
    el.textContent = "-";
  }
}

export function showContractShort() {
  const el = $("#caddr");
  if (!el) return;
  const full = (el.textContent || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(full)) return;
  el.title = full;
  el.textContent = short(full);
}

// ───────────────────────────────────────
// Top10 table
// rows: [{addr, val}]
// ───────────────────────────────────────
export function renderTop10(rows = []) {
  const body = $("#topRankBody");
  if (!body) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="text-center text-muted">-</td></tr>`;
    return;
  }
  const html = rows.slice(0,10).map((r, i) => `
    <tr>
      <td>${i+1}</td>
      <td class="addr">${short(r.addr)}</td>
      <td class="text-end">${(typeof r.val === "bigint")
        ? (r.val <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(r.val).toLocaleString() : r.val.toString())
        : Number(r.val || 0).toLocaleString()
      }</td>
    </tr>
  `).join("");
  body.innerHTML = html;
}
