// File: C2E/js/c2e-admin.js
// Admin 화면: Firestore 사용자 기반으로 컨트랙트 상태 직접 조회

import { db, auth } from "/geolocation/js/firebase.js";
import {
  collection, getDocs, query, orderBy, limit as qlimit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ethers = window.ethers;

// ========= 체인/컨트랙트 설정 =========
const C2E_ADDR = "0xe650d115F07370e4A35cD2b85899F6Cc651c8d3C";
const CHAIN_ID_DEC = 204; // opBNB Mainnet
const CHAIN_ID_HEX = "0x" + CHAIN_ID_DEC.toString(16);

const C2E_ABI = [
  "function claim2(address user, uint256 missionId) view returns (bool)",
  "function claim3(address user, uint256 missionId) view returns (bool)",
  "function claim4(address user, uint256 missionId) view returns (bool)",
  "function staff(address) view returns (bool)",
  "function m1(address user)",
  "function resolveClaim2(address user, uint256 missionId, uint8 grade)",
  "function resolveClaim3(address user, uint256 missionId, uint8 grade)",
  "function resolveClaim4(address user, uint256 missionId, uint8 grade)",
  "event ClaimRequested(address indexed user, uint256 indexed missionId, uint8 kind)",
  "event ClaimResolved(address indexed user, uint256 indexed missionId, uint8 grade, uint256 reward)"
];

// ========= 상태 =========
let provider, signer, c2e;
let currentKind = 2;
let ALL_USERS = []; // 사용자 목록을 저장할 전역 변수

// ========= 유틸 =========
const $  = (s, el=document)=> el.querySelector(s);
const $$ = (s, el=document)=> [...el.querySelectorAll(s)];
function short(a){ return a ? `${a.slice(0,6)}…${a.slice(-4)}` : "-"; }
function ts(t){ try{ return new Date(Number(t)).toLocaleString(); }catch{ return "-"; } }

// ========= Auth =========
async function ensureAuth() {
  if (auth.currentUser) return auth.currentUser;
  await signInAnonymously(auth);
  return auth.currentUser;
}

// ========= Firestore Load =========
async function loadMission2List(max=200){
  await ensureAuth();
  const qref = query(
    collection(db, "c2e_mission2_ids"),
    orderBy("ts", "desc"),
    qlimit(max)
  );
  const snap = await getDocs(qref);
  return snap.docs.map(d => ({ id:d.id, ...(d.data()||{}) }));
}

async function loadSubmissions(max=300){
  await ensureAuth();
  const qref = query(
    collection(db, "c2e_mission_user_submissions"),
    orderBy("ts", "desc"),
    qlimit(max)
  );
  const snap = await getDocs(qref);
  return snap.docs.map(d => ({ id:d.id, ...(d.data()||{}) }));
}

// ========= Provider =========
async function ensureProvider(){
  if(!window.ethereum) throw new Error("지갑이 필요합니다");
  provider = new ethers.BrowserProvider(window.ethereum, "any");
  signer = await provider.getSigner();
  const net = await provider.getNetwork();
  if (net.chainId !== BigInt(CHAIN_ID_DEC)) {
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }]);
    } catch (e) {
      if (e?.code === 4902) {
        await provider.send("wallet_addEthereumChain", [{
          chainId: CHAIN_ID_HEX, chainName: "opBNB Mainnet",
          nativeCurrency:{ name:"BNB", symbol:"BNB", decimals:18 },
          rpcUrls:["https://opbnb-mainnet-rpc.bnbchain.org"],
          blockExplorerUrls:["https://mainnet.opbnbscan.com"]
        }]);
      } else { throw e; }
    }
  }
  c2e = new ethers.Contract(C2E_ADDR, C2E_ABI, signer);
  return { provider, signer, c2e };
}

// ========= 온체인 호출 래퍼(안전) =========
async function safeCall(fn, ...args){
  try {
    return await fn(...args);
  } catch (e){
    return { __error: e };
  }
}

// ========= On-chain 조회 =========
async function checkMapping(kind, addr, missionId){
  const { c2e } = await ensureProvider();
  let r;
  if (kind === 2) r = await safeCall(c2e.claim2, addr, missionId);
  else if (kind === 3) r = await safeCall(c2e.claim3, addr, missionId);
  else r = await safeCall(c2e.claim4, addr, missionId);
  if (r?.__error) throw r.__error;
  return r;
}

async function doResolveKind(kind, addr, missionId, grade){
  const { c2e } = await ensureProvider();
  try {
    const me = await signer.getAddress();
    const ok = await c2e.staff(me);
    if (ok?.__error === undefined && ok === false) {
      throw new Error("스태프 권한이 없습니다.");
    }
  } catch(_) { /* staff() 없거나 실패 → 패스 */ }

  let tx;
  if (kind === 2) {
    tx = await c2e.resolveClaim2(addr, missionId, grade);
  } else if (kind === 3) {
    tx = await c2e.resolveClaim3(addr, missionId, grade);
  } else {
    tx = await c2e.resolveClaim4(addr, missionId, grade);
  }
  const rec = await tx.wait();
  return rec.hash;
}

// ========= 로딩/리로드 (직접 조회 방식) =========
async function reloadPending(allUsers, kind) {
  const tbody = $("#tbody");
  try {
    if (!provider) await ensureProvider();
    if (!allUsers || allUsers.length === 0) {
      renderClaimsTable([]);
      return;
    }

    tbody.innerHTML = `<tr><td colspan="7" class="muted">${allUsers.length}명의 사용자에 대해 보상 상태를 직접 조회합니다...</td></tr>`;

    const MISSION_IDS_TO_CHECK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const pendingClaims = [];
    const promises = [];

    for (const userAddr of allUsers) {
      for (const missionId of MISSION_IDS_TO_CHECK) {
        const promise = checkMapping(kind, userAddr, missionId).then(isPending => {
          if (isPending) {
            pendingClaims.push({
              user: userAddr,
              missionId: missionId,
              kind: kind,
              blockNumber: 'N/A',
              txHash: '#'
            });
          }
        }).catch(e => {
          console.warn(`CheckMapping failed for ${userAddr}, kind ${kind}, mission ${missionId}`, e);
        });
        promises.push(promise);
      }
    }
    
    await Promise.all(promises);
    renderClaimsTable(pendingClaims);

  } catch (e) {
    console.error("Error in new reloadPending:", e);
    if(tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">오류: ${e.message}</td></tr>`;
  }
}

// ========= 렌더링 =========
function renderClaimsTable(items){
  const tbody = $("#tbody");
  if(!tbody) return;
  if(!items.length){
    tbody.innerHTML = `<tr><td colspan="7" class="text-center muted py-4">결과 없음</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(it=>{
    return `
      <tr data-kind="${it.kind}" data-addr="${it.user}" data-mission="${it.missionId}">
        <td class="addr" title="${it.user}">${short(it.user)}</td>
        <td class="text-center">${it.missionId}</td>
        <td class="text-center">${it.kind}</td>
        <td class="col-hide-sm">${it.blockNumber}</td>
        <td class="col-hide-sm">
          <a href="https://mainnet.opbnbscan.com/tx/${it.txHash}" target="_blank" rel="noopener">트랜잭션</a>
        </td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-warning" data-role="check">대기확인</button>
            <button class="btn btn-primary" data-role="resolve">보상</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderMission2List(rows) {
  const list = $("#mission2-list");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = `<div class="muted" style="text-align:center; padding: 20px;">데이터 없음</div>`;
    return;
  }
  list.innerHTML = rows.map(r => {
    const addr = r.addr || r.id;
    return `
      <div class="mission-card" data-addr="${addr}" data-mission="2">
        <div class="mission-card-header">
          <span class="addr" title="${addr}">${addr}</span>
          <button class="btn btn-outline-secondary act-copy" data-addr="${addr}" style="padding: 4px 8px; font-size: 12px;">주소복사</button>
        </div>
        <div class="mission-card-body">
          <div class="field">
            <span class="field-label">Kakao</span>
            <span class="field-value">${r.kakao || "-"}</span>
          </div>
          <div class="field">
            <span class="field-label">Telegram</span>
            <span class="field-value">${r.telegram || "-"}</span>
          </div>
          <div class="field">
            <span class="field-label">Zalo</span>
            <span class="field-value">${r.zaloPhone || "-"}</span>
          </div>
          <div class="field">
            <span class="field-label">Note</span>
            <span class="field-value">${(r.note || "").replace(/</g, "&lt;") || "-"}</span>
          </div>
          <div class="field">
            <span class="field-label">Extra</span>
            <span class="field-value">${(r.noteExtra || "").replace(/</g, "&lt;") || "-"}</span>
          </div>
        </div>
        <div class="mission-card-footer">
          <span class="small text-muted">${ts(r.ts)}</span>
          <div class="btn-group btn-group-sm" style="display: flex; align-items: center;">
            <span class="onchain-status muted" style="margin-right: 8px; font-size: 12px;"></span>
            <button class="btn btn-outline-warning" data-role="check2" style="padding: 6px 10px;">대기확인(c2)</button>
            <button class="btn btn-primary" data-role="resolve2" style="padding: 6px 10px;">보상(c2)</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderSubsTable(rows){
  const tbody = $("#tbl-subs-body");
  if(!tbody) return;
  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="8" class="text-muted text-center">데이터 없음</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r=>{
    const links = Array.isArray(r.links) ? r.links : [];
    return `
      <tr data-addr="${r.addr}" data-mission="${r.missionId||""}">
        <td class="addr" title="${r.addr}">${short(r.addr)}</td>
        <td class="text-center">${r.missionId || "-"}</td>
        <td class="small">${(r.note||"").replace(/</g,"&lt;")}</td>
        <td class="small">
          ${links.map(u=>`<a href="${u}" target="_blank" rel="noopener">${u}</a>`).join("<br/>") || "-"}
        </td>
        <td class="small text-muted">${ts(r.ts)}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary act-copy" data-addr="${r.addr}">주소복사</button>
            <button class="btn btn-outline-warning" data-role="check2">대기확인(c2)</button>
            <button class="btn btn-success" data-role="resolve2">보상(c2)</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ========= 액션 =========
function bindActions(){
  // 지갑 연결 버튼
  const btnConnect = $("#btnConnect");
  if (btnConnect) {
    btnConnect.addEventListener('click', render);
  }

  // '즉시 처리' 버튼 (퀵 액션 폼)
  const btnResolve = $("#btnResolve");
  if (btnResolve) {
    btnResolve.addEventListener('click', async () => {
      try {
        const user = $("#qaUser").value.trim();
        const missionId = Number($("#qaMission").value);
        const kind = Number($("#qaKind").value);
        const grade = Number($("#qaGrade").value);

        if (!ethers.isAddress(user)) {
          return alert('유효한 사용자 주소가 아닙니다.');
        }
        if (!(missionId > 0)) {
          return alert('유효한 미션 ID가 아닙니다.');
        }

        const btn = $("#btnResolve");
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '처리 중...';

        await doResolveKind(kind, user, missionId, grade);

        alert('보상 처리가 완료되었습니다.');
        
        await reloadPending(ALL_USERS, currentKind);

        const card = $("#mission2-list .mission-card[data-addr=\"${user}\"]");
        if (card) {
          const statusEl = card.querySelector('.onchain-status');
          if (statusEl) {
            statusEl.textContent = '보상완료';
            statusEl.style.color = '#28a745';
          }
          const resolveBtn = card.querySelector('[data-role="resolve2"]');
          if (resolveBtn) resolveBtn.disabled = true;
        }

        btn.disabled = false;
        btn.textContent = oldText;

      } catch (err) {
        console.error('Resolve failed:', err);
        alert(`처리 실패: ${err.reason || err.shortMessage || err.message}`);
        const btn = $("#btnResolve");
        if(btn) {
          btn.disabled = false;
          btn.textContent = '즉시 처리 (resolve)';
        }
      }
    });
  }

  // 공통 위임
  document.body.addEventListener('click', async (ev)=>{
    const t = ev.target;
    if(!(t instanceof HTMLElement)) return;

    if(t.classList.contains('act-copy')){
      const a = t.getAttribute('data-addr')||"";
      navigator.clipboard.writeText(a).then(()=> {
        t.textContent = "복사됨"; setTimeout(()=> t.textContent="주소복사", 1200);
      });
      return;
    }

    const role2 = t.closest('[data-role="check2"],[data-role="resolve2"]');
    if(role2){
      const card = role2.closest('.mission-card');
      const addr = card?.dataset?.addr || '';
      const mission = Number(card?.dataset?.mission || 2);
      
      if(role2.dataset.role === 'check2'){
        if(!ethers.isAddress(addr)) { alert("주소 없음"); return; }
        role2.disabled = true;
        try{
          const ok = await checkMapping(2, addr, mission||2);
          const statusEl = card.querySelector('.onchain-status');
          if (statusEl) {
            if (ok) {
              statusEl.textContent = '대기중';
              statusEl.style.color = '#ffc107';
            } else {
              statusEl.textContent = '처리됨/없음';
              statusEl.style.color = '#28a745';
              const resolveBtn = card.querySelector('[data-role="resolve2"]');
              if (resolveBtn) resolveBtn.disabled = true;
            }
          }
        }catch(e){
          alert('상태 확인 중 오류가 발생했습니다.');
        }finally{
          role2.disabled = false;
        }
        return;
      } else { // resolve2
        if(!ethers.isAddress(addr)) { alert("주소 없음"); return; }
        $("#qaUser").value = addr;
        $("#qaMission").value = mission || 2;
        $("#qaKind").value = 2;
        $("#qaUser").scrollIntoView({ behavior: 'smooth', block: 'center' });
        alert('퀵 액션 폼에 정보가 입력되었습니다. 등급을 선택하고 "즉시 처리" 버튼을 누르세요.');
        return;
      }
    }

    const tableBtn = t.closest('#tbody [data-role]');
    if(tableBtn) {
        const tr = tableBtn.closest('tr');
        const kind = Number(tr?.dataset?.kind || currentKind || 2);
        const addr = tr?.dataset?.addr || '';
        const mission = Number(tr?.dataset?.mission || 2);

        if(tableBtn.dataset.role === 'resolve'){
          if(!ethers.isAddress(addr)) { alert("주소 없음"); return; }
          $("#qaUser").value = addr;
          $("#qaMission").value = mission;
          $("#qaKind").value = kind;
          $("#qaUser").scrollIntoView({ behavior: 'smooth', block: 'center' });
          alert('퀵 액션 폼에 정보가 입력되었습니다.');
          return;
        }
        if(tableBtn.dataset.role === 'check'){
          if(!ethers.isAddress(addr)) { alert("주소 없음"); return; }
          tableBtn.disabled = true; const old = tableBtn.textContent || "";
          tableBtn.textContent = "확인중…";
          try {
            const ok = await checkMapping(kind, addr, mission);
            tableBtn.textContent = ok ? "대기중" : "없음";
            tableBtn.classList.toggle('btn-outline-warning', !ok);
            tableBtn.classList.toggle('btn-warning', ok);
          } catch(e){
            tableBtn.textContent = "오류";
          } finally{
            setTimeout(()=>{ tableBtn.textContent = old; tableBtn.disabled=false; }, 1200);
          }
          return;
        }
    }
  });

  // Kind 탭
  $$('[data-kind-tab]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      $$('[data-kind-tab]').forEach(b=> b.classList.remove('active'));
      btn.classList.add('active');
      currentKind = Number(btn.getAttribute('data-kind-tab'));
      await reloadPending(ALL_USERS, currentKind);
    });
  });

  // 새로고침 버튼
  const btnReload = $("#btnReload");
  if (btnReload) btnReload.addEventListener('click', ()=> {
    reloadPending(ALL_USERS, currentKind);
  });

  // 화이트 멤버 등록
  const btnWhite = $("#btnWhite");
  if(btnWhite) btnWhite.addEventListener('click', callWhite);
}

// ========= 화이트멤버 등록 (m1 호출) =========
async function callWhite() {
  try {
    const user = $("#whiteUser").value.trim();
    if (!ethers.isAddress(user)) {
      alert("올바른 사용자 주소를 입력하세요.");
      return;
    }
    if (!c2e || !signer) await ensureProvider();

    const btn = $("#btnWhite");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "처리 중…";

    const tx = await c2e.m1(user);
    console.log(`m1 tx: ${tx.hash}`);
    await tx.wait();

    alert("화이트멤버 등록 완료!");
    $("#whiteUser").value = "";

    btn.disabled = false;
    btn.textContent = originalText;

  } catch (err) {
    console.error(err);
    alert("등록 실패: " + (err?.reason || err?.message || err));
    const btn = $("#btnWhite");
    if(btn) {
      btn.disabled = false;
      btn.textContent = "화이트멤버 등록 (m1)";
    }
  }
}

// ========= 최종 렌더링 =========
async function render(){
  try{
    await ensureProvider();
    const net = await provider.getNetwork();
    const addr = await signer.getAddress();
    $("#net").textContent = net.name;
    $("#me").textContent = short(addr);
    $("#btnConnect").textContent = '지갑 연결됨';
    $("#btnConnect").disabled = true;

    const m2 = await loadMission2List(200);
    const subs = await loadSubmissions(300);
    renderMission2List(m2);
    renderSubsTable(subs);

    const userSet = new Set();
    m2.forEach(item => (item.addr || item.id) && userSet.add(item.addr || item.id));
    subs.forEach(item => item.addr && userSet.add(item.addr));
    ALL_USERS = [...userSet];

    await reloadPending(ALL_USERS, currentKind);

  }catch(e){
    console.error(e);
    $("#me").textContent = `연결/로드 실패: ${e.message}`;
  }
}

window.addEventListener('DOMContentLoaded', async ()=>{
  bindActions();
  await ensureAuth();
  render();
});
