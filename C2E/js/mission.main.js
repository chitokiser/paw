// mission.main.js — 중복 방지 락 + 전체 새로고침 일원화
import { connect, ensureProvider, ensureChain, api, getState } from "./mission.api.js";
import { buildMissions } from "./mission.missions.js";
import { saveNoteExtra } from "./mission.storage.js";

// 간단한 DOM 헬퍼
const $  = (sel, el=document) => el.querySelector(sel);
function setText(id, text){ const el = document.getElementById(id); if (el) el.textContent = text; }
function toast(msg, ok=true){ try{ console[ok?'log':'warn'](msg); }catch{} }

// 18d → "n PAW"
const asPAW = (raw, frac=4) => `${Number(api.formatUnits(raw, 18)).toLocaleString(undefined,{maximumFractionDigits:frac})} PAW`;

// 네트워크 뱃지
function paintNetworkBadge(cidHex){
  const badge = document.getElementById("chainBadge");
  const hex = (cidHex||"").toLowerCase();
  if (badge) badge.textContent = `Network: ${hex || "-"}`;
  const chainInfo = document.getElementById("chainInfo");
  if (chainInfo) chainInfo.textContent = hex || "-";
}

// 연결 후 내 주소 표시
function paintMeAddr(){
  const { me } = getState();
  if (me) {
    setText("meAddr", me);
    const wbtn = document.getElementById("btnWithdraw");
    if (wbtn) wbtn.disabled = false;
  }
}

// ===== 새로고침 동시 실행 방지 락 =====
let _refreshing = false;
let _refreshAgain = false;

export async function refreshAll(){
  if (_refreshing) { _refreshAgain = true; return; }
  _refreshing = true;
  try {
    // 1) 글로벌
    try {
      const g = await api.global();
      setText("valPool",          asPAW(g.pool, 4));
      setText("valTotalWithdraw", asPAW(g.totalW, 4));
      setText("valMembers",       String(g.mid));
      setText("scanLimit",        `최대 ${Math.min(g.mid, 300)}명 스캔`);
    } catch (e) { console.warn("[global] read fail", e); }

    // 2) 내정보
    const { me } = getState();
    if (me) {
      try {
        let cnt = 0;
        for (const id of [1,2,3,4,5,6,7]) {
          try { if (await api.isPending(me, id)) cnt++; } catch {}
        }
        setText("valMyPending", String(cnt));
      } catch { setText("valMyPending", "-"); }

      try {
        const m = await api.my(me);
        setText("meMypay",    asPAW(m.info.mypay, 4));
        setText("meAllow",    asPAW(m.info.allow, 4));
        setText("meTotalpay", asPAW(m.info.totalpay, 4));
        setText("meRating",   String(m.info.rating));
        setText("meWhite",    m.info.white ? "✅ Yes" : "❌ No");
        setText("meLastW",    new Date(Number(m.last)*1000).toLocaleString());
        setText("meAvail",    asPAW(m.avail, 4));
      } catch (e) { console.warn("[my] read fail", e); }
    } else {
      setText("valMyPending", "-");
    }

    // 3) 미션(원자적 렌더) — buildMissions 내부에서 replaceChildren 사용
    try {
      await buildMissions({
        wrap: document.getElementById("missionsWrap"),
        onClaim: async (id)=>{
          try{
            if(!getState().signer) await connect();
            const tx = await api.claim(id);
            toast("보상 요구 제출");
            await tx.wait();
            toast("보상 요구 완료");
            await refreshAll();
          }catch(e){ toast(e?.shortMessage||e?.message||"실패", false); }
        },
        onBuffing: async ()=>{
          try{
            if(!getState().signer) await connect();
            const tx = await api.buffing();
            toast("보상 트랜잭션 제출됨");
            await tx.wait();
            toast("5000GP + 5000EXP 지급 완료");
          }catch(e){ toast(e?.shortMessage||e?.message||"실패", false); }
        },
        onM1: async ()=>{
          try{
            if(!getState().signer) await connect();
            const tx = await api.m1();
            toast("미션1 등록 제출");
            await tx.wait();
            toast("화이트 멤버 등록 완료");
            await refreshAll();
          }catch(e){ toast(e?.shortMessage||e?.message||"미션1 실패", false); }
        }
      });
    } catch (e) { console.warn("buildMissions failed", e); }

    // 4) 랭킹
    try {
      const rows = await api.ranking(300);
      const body = document.getElementById("topRankBody");
      if (body) {
        if (!rows.length) {
          body.innerHTML = `<tr><td colspan="3" class="text-center text-muted">-</td></tr>`;
        } else {
          body.innerHTML = rows.map((r, i)=>`
            <tr>
              <td>${i+1}</td>
              <td class="addr">${r.addr}</td>
              <td class="text-end">${Number(api.formatUnits(r.val, 18)).toLocaleString(undefined,{maximumFractionDigits:4})} PAW</td>
            </tr>
          `).join("");
        }
      }
    } catch (e) { console.warn("[ranking] read fail", e); }

  } finally {
    _refreshing = false;
    if (_refreshAgain) { _refreshAgain = false; await refreshAll(); }
  }
}

async function boot(){
  try{
    await ensureProvider();
    const cid = await ensureChain(); // 미연결이면 null
    paintNetworkBadge(cid);
  }catch(e){
    try {
      const net = await (await ensureProvider()).getNetwork();
      paintNetworkBadge("0x" + Number(net.chainId).toString(16));
    } catch {}
  }
  await refreshAll();
}

function bindUI(){
  // 지갑 연결
  $("#btnConnect")?.addEventListener("click", async ()=>{
    try{
      const { me } = await connect();
      paintMeAddr();
      const cid = await ensureChain();
      paintNetworkBadge(cid);
      await refreshAll();
    }catch(e){
      if (e?.code === 4900) toast("지갑이 끊겼습니다. 확장에서 네트워크를 선택하고 다시 시도하세요.", false);
      else toast(e?.message||"지갑 연결 실패", false);
    }
  });

  // 인출
  $("#btnWithdraw")?.addEventListener("click", async ()=>{
    try{
      if(!getState().signer) await connect();
      const tx = await api.withdraw();
      toast("인출 제출");
      await tx.wait();
      toast("인출 성공");
      await refreshAll();
    }catch(e){ toast(e?.shortMessage||e?.message||"인출 실패", false); }
  });

  // 스태프: 검증 처리
  $("#formResolve")?.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    try{
      if(!getState().signer) await connect();
      const u  = document.getElementById("resUser").value.trim();
      const id = Number(document.getElementById("resMission").value);
      const g  = Number(document.getElementById("resGrade").value);
      if(!globalThis.ethers.isAddress(u)) return toast("유효한 주소가 아닙니다", false);
      const tx = await api.resolve(u, id, g);
      toast("검증 제출");
      await tx.wait();
      toast("검증 완료");
      await refreshAll();
    }catch(e){ toast(e?.shortMessage||e?.message||"검증 실패(권한/상태 확인)", false); }
  });

  // 스태프: 대기 여부 확인
  $("#formCheck")?.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    try{
      const uIn = document.getElementById("chkUser").value.trim();
      const u = uIn || getState().me;
      const id = Number(document.getElementById("chkMission").value);
      if(!u || !globalThis.ethers.isAddress(u)) return toast("유효한 주소가 아닙니다", false);
      const ok = await api.isPending(u, id);
      document.getElementById("chkResult").textContent = ok ? "대기 중 (true)" : "없음 (false)";
    }catch{ toast("조회 실패", false); }
  });

  // 참고 데이터 저장
  $("#noteForm")?.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    try{
      if(!getState().signer) await connect();
      const note = document.getElementById("noteText")?.value?.trim() || "";
      if(!note) return toast("내용을 입력하세요.", false);
      await saveNoteExtra(getState().me, note);
      const stat = document.getElementById("noteStatus");
      if (stat) { stat.textContent = "✅ 저장됨"; stat.className = "small text-success"; }
      toast("참고 데이터가 저장되었습니다.");
    }catch(e){ toast(e?.message||"저장 실패", false); }
  });

  // (선택) 탭/포커스 시 재갱신 — 이제 락으로 중복 없음
  document.querySelectorAll('#tabs [data-bs-toggle="tab"], #tabs .nav-link')
    .forEach(btn => btn.addEventListener('shown.bs.tab', ()=> refreshAll()));
  window.addEventListener('focus', ()=> refreshAll());
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) refreshAll(); });
}

document.addEventListener("DOMContentLoaded", async ()=>{
  try { await boot(); bindUI(); } catch(e){ console.error(e); }
  // 디버깅용 전역 노출 (콘솔 테스트 편의)
  globalThis.api = api;
  globalThis.getState = getState;
  globalThis.refreshAll = refreshAll;
});
