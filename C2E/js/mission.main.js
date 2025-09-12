// mission.main.js — bootstrap & wiring (safe refresh / 4900 guard)
import { connect, ensureProvider, ensureChain, api, getState } from "./mission.api.js";
import { $, toast, showChain, showMe, showContractShort, renderTop10 } from "./mission.ui.js";
import { buildMissions } from "./mission.missions.js";
import { saveNoteExtra } from "./mission.storage.js";

async function refreshAll(){
  // 글로벌 (연결 안 돼 있거나 provider 문제가 있어도 UI는 유지)
  let g;
  try {
    g = await api.global();
    $("#valPool").textContent         = `${(Number(g.pool)/1e18).toLocaleString(undefined,{maximumFractionDigits:4})} PAW`;
    $("#valTotalWithdraw").textContent= `${(Number(g.totalW)/1e18).toLocaleString(undefined,{maximumFractionDigits:4})} PAW`;
    $("#valMembers").textContent      = g.mid.toString();
    $("#scanLimit").textContent       = `최대 ${Math.min(g.mid, 300)}명 스캔`;
  } catch {
    // provider 끊김 등: 표시값 유지
  }

  const { me } = getState();
  if(me){
    try{
      let cnt = 0;
      for(const id of [1,2,3,4,5,6,7,8]){ try{ if(await api.isPending(me, id)) cnt++; }catch{} }
      $("#valMyPending").textContent = String(cnt);
    }catch{ $("#valMyPending").textContent = "-"; }

    try{
      const m = await api.my(me);
      $("#meMypay").textContent    = `${(Number(m.info.mypay)/1e18).toLocaleString(undefined,{maximumFractionDigits:4})} PAW`;
      $("#meAllow").textContent    = `${(Number(m.info.allow)/1e18).toLocaleString(undefined,{maximumFractionDigits:4})} PAW`;
      $("#meTotalpay").textContent = `${(Number(m.info.totalpay)/1e18).toLocaleString(undefined,{maximumFractionDigits:4})} PAW`;
      $("#meRating").textContent   = m.info.rating.toString();
      $("#meWhite").textContent    = m.info.white ? "✅ Yes" : "❌ No";
      $("#meLastW").textContent    = new Date(Number(m.last)*1000).toLocaleString();
      $("#meAvail").textContent    = `${(Number(m.avail)/1e18).toLocaleString(undefined,{maximumFractionDigits:4})} PAW`;
    }catch{}
  } else {
    $("#valMyPending").textContent = "-";
  }

  // 미션 (실패해도 전체 UI가 멈추지 않도록 try)
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
  } catch (e) {
    console.warn("buildMissions failed", e);
  }

  // 랭킹
  try {
    const rows = await api.ranking(300);
    renderTop10(rows);
  } catch {}
}

async function boot(){
  showContractShort();
  try{
    await ensureProvider();
    const cid = await ensureChain(); // 연결 전이면 null일 수 있음
    if (cid) showChain(cid);
  }catch(e){
    // 지갑 미설치/비연결 상태 — 연결 버튼으로 처리
  }
  await refreshAll();
}

function bindUI(){
  // 지갑 연결
  $("#btnConnect")?.addEventListener("click", async ()=>{
    try{
      const { me } = await connect();
      showMe(me);
      const cid = await ensureChain();
      if (cid) showChain(cid);
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

  // 스태프
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

  // 하단 참고 데이터 저장
  $("#noteForm")?.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    try{
      if(!getState().signer) await connect();
      const note = document.getElementById("noteText")?.value?.trim() || "";
      if(!note) return toast("내용을 입력하세요.", false);
      await saveNoteExtra(getState().me, note);
      document.getElementById("noteStatus").textContent = "✅ 저장됨";
      document.getElementById("noteStatus").className = "small text-success";
      toast("참고 데이터가 저장되었습니다.");
    }catch(e){ toast(e?.message||"저장 실패", false); }
  });
}



document.addEventListener("DOMContentLoaded", async ()=>{
  try{ await boot(); bindUI(); }catch(e){ console.error(e); }
});
