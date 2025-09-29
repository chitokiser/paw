// mission.main.js — bootstrap & wiring (no ensureProvider)
import { connect, ensureChain, api, getState } from "./mission.api.js";
import { $, toast, showChain, showMe, showContractShort, renderTop10, formatWei } from "./mission.ui.js";
import { buildMissions } from "./mission.missions.js";
import { saveNoteExtra } from "./mission.storage.js";

const IDS = [1,2,3,4,5,6,7,8];

async function refreshAll(){
  // ── 글로벌 카드
  try {
    const g = await api.global();
    $("#valPool").textContent          = formatWei(g.pool);
    $("#valTotalWithdraw").textContent = formatWei(g.totalW);
    $("#valMembers").textContent       = g.mid.toString();
    $("#scanLimit").textContent        = `최대 ${Math.min(g.mid, 300)}명 스캔`;
  } catch(e) {
    console.error("Error in refreshAll (global):", e);
  }

  // ── 내 상태
  const { me } = getState();
  if (me){
    // 대기중 카운트
    try{
      let cnt = 0;
      for (const id of IDS){
        try{ if (await api.isPending(me,id)) cnt++; }catch(e){ console.warn(`isPending check failed for mission ${id}`, e); }
      }
      $("#valMyPending").textContent = String(cnt);
    }catch(e){
      $("#valMyPending").textContent = "-";
      console.error("Error in refreshAll (pending count):", e);
    }

    // myinfo
    try{
      const m = await api.my(me);
      $("#meMypay").textContent    = formatWei(m.info.mypay || 0n);
      $("#meAllow").textContent    = formatWei(m.info.allow || 0n);
      $("#meTotalpay").textContent = formatWei(m.info.totalpay || 0n);
      $("#meRating").textContent   = (m.info.rating ?? "-").toString();
      $("#meWhite").textContent    = m.info.white ? "✅ Yes" : "❌ No";
      $("#meLastW").textContent    = new Date(Number(m.last||0)*1000).toLocaleString();
      $("#meAvail").textContent    = formatWei(m.avail || 0n);
      // 인출 버튼 활성화(10 PAW 이상)
      const canW = (typeof m.avail==="bigint" ? m.avail : BigInt(m.avail||0)) >= 10n*10n**18n;
      $("#btnWithdraw").disabled = !canW;
    }catch(e){
      console.error("Error in refreshAll (my info):", e);
    }
  } else {
    $("#valMyPending").textContent = "-";
    $("#btnWithdraw").disabled = true;
  }

  // ── Top10
  try{
    const rows = await api.ranking?.(300);
    if (Array.isArray(rows)) renderTop10(rows);
  }catch(e){
    console.error("Error in refreshAll (ranking):", e);
  }

  // ── 미션 카드
  try{
    await buildMissions({
      wrap: document.getElementById("missionsWrap"),
      onClaim: async (id)=>{
        try{
          if(!getState().signer) await connect();
          const tx = await api.claimByMission(id);  // ← 미션별 자동 분기
          toast("보상 요구 제출됨");
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
        }catch(e){ toast(e?.shortMessage||e?.message||"실패", false); }
      }
    });
  }catch(e){
    console.error("Error in refreshAll (buildMissions):", e);
  }
}

async function boot(){
  showContractShort();
  await showChain();
  // showMe / refreshAll 등은 지갑 연결 후 호출
}

function bindUI(){
  // 지갑 연결
  $("#btnConnect")?.addEventListener("click", async ()=>{
    try{
      await connect();
      await showChain();
      await showMe();
      await refreshAll();
      toast("지갑 연결 완료");
    }catch(e){
      toast(e?.message||"지갑 연결 실패", false);
      console.error("Wallet connection failed:", e);
    }
  });

  // 인출
  $("#btnWithdraw")?.addEventListener("click", async ()=>{
    try{
      if(!getState().signer) await connect();
      const tx = await api.withdraw();
      toast("인출 제출됨");
      await tx.wait();
      toast("인출 완료");
      await refreshAll();
    }catch(e){ toast(e?.shortMessage||e?.message||"인출 실패", false); }
  });

  // 스태프: resolve
  $("#formResolve")?.addEventListener("submit", async(ev)=>{
    ev.preventDefault();
    try{
      if(!getState().signer) await connect();
      const u = document.getElementById("resUser").value.trim();
      const id = Number(document.getElementById("resMission").value);
      const g  = Number(document.getElementById("resGrade").value);
      if(!globalThis.ethers.isAddress(u)) return toast("유효한 주소가 아닙니다", false);
      const tx = await api.resolveByMission?.(u,id,g) || await api.resolve(u,id,g);
      toast("검증 제출");
      await tx.wait();
      toast("검증 완료");
      await refreshAll();
    }catch(e){ toast(e?.shortMessage||e?.message||"검증 실패(권한/상태 확인)", false); }
  });

  // 스태프: 상태 조회
  $("#formCheck")?.addEventListener("submit", async(ev)=>{
    ev.preventDefault();
    try{
      const uIn = document.getElementById("chkUser").value.trim();
      const u = uIn || getState().me;
      const id = Number(document.getElementById("chkMission").value);
      if(!u || !globalThis.ethers.isAddress(u)) return toast("유효한 주소가 아닙니다", false);
      const ok = await api.isPending(u,id);
      document.getElementById("chkResult").textContent = ok ? "대기 중 (true)" : "없음 (false)";
    }catch{ toast("조회 실패", false); }
  });

  // 참고 데이터 저장
  $("#noteForm")?.addEventListener("submit", async(ev)=>{
    ev.preventDefault();
    try{
      if(!getState().signer) await connect();
      const note = document.getElementById("noteText")?.value?.trim() || "";
      if(!note) return toast("내용을 입력하세요.", false);
      await saveNoteExtra(getState().me, note);
      document.getElementById("noteStatus").textContent = "✅ 저장됨";
      document.getElementById("noteStatus").className  = "small text-success";
      toast("참고 데이터가 저장되었습니다.");
    }catch(e){ toast(e?.message||"저장 실패", false); }
  });
}

document.addEventListener("DOMContentLoaded", async ()=>{
  try{
    bindUI(); // 1. UI 버튼 먼저 연결
    await boot(); // 2. 지갑 연결과 무관한 초기화만 실행
  }catch(e){ console.error(e); }
});
