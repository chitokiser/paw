// mission.missions.js — 미션 카드/버튼/탭 렌더
import { api, getState } from "./mission.api.js";
import { $, toast, fmtPAW } from "./mission.ui.js";
import {
  saveMission2, loadMission2,
  createStaffRef, loadStaffRefs, updateStaffRef, deleteStaffRef,
  saveUserSubmission, loadUserSubmission
} from "./mission.storage.js";

const IDS = [1,2,3,4,5,6,7,8];

const TEXT = {
  1:{ body:`미션내용: 멘토 입력 및 레벨 충족 → 화이트 전환. 보상은 토큰이 아닌 <b>5000 GP + 5000 EXP</b>입니다.` },
  2:{ body:`
    미션내용: 카카오/텔레그램/Zalo 연락처 등록 후 운영자에게 연락 → [보상 요구].<hr/>
    <div class="d-flex gap-3 flex-wrap">
      <div class="text-center"><img src="../images/qr/kakao.png" width="100" class="border rounded"/><div class="small mt-1">Kakao</div></div>
      <div class="text-center"><img src="../images/qr/zalo.png" onerror="this.onerror=null;this.src='../images/qr/qrzalo.png'" width="100" class="border rounded"/><div class="small mt-1">Zalo</div></div>
      <div class="text-center"><img src="../images/qr/telegram.png" width="100" class="border rounded"/><div class="small mt-1">Telegram</div></div>
    </div>
    <div class="mt-3">
      <div class="small mb-1">※ 아래 입력은 <b>지갑주소</b>를 키로 Firestore에 저장됩니다.</div>
      <form id="m2Form" class="row g-2">
        <div class="col-md-4"><input id="m2Kakao" class="form-control" placeholder="Kakao ID"/></div>
        <div class="col-md-4"><input id="m2Telegram" class="form-control" placeholder="@telegram"/></div>
        <div class="col-md-4"><input id="m2ZaloPhone" class="form-control" placeholder="+84 xxx"/></div>
        <div class="col-12"><textarea id="m2Note" class="form-control" rows="2" placeholder="닉네임/설명 등"></textarea></div>
        <div class="col-12 d-flex gap-3 align-items-center">
          <button id="m2SaveBtn" class="btn btn-sm btn-outline-light" type="submit">아이디 등록하기</button>
          <span class="small text-muted">내 지갑: <span class="addr" id="m2Addr">-</span></span>
          <span id="m2Status" class="small"></span>
        </div>
      </form>
    </div>` },
  3:{ body:`미션내용: 오픈채팅방 다수 가입 후 인사말 남기기 → [보상 요구].` },
  4:{ body:`미션내용: 블로그 생성 + 첫 글 등록 → [보상 요구].` },
  5:{ body:`미션내용: 블로그 매일 글쓰기(매일보상) → [보상 요구].` },
  6:{ body:`미션내용: 스토어 리뷰/평점 작성(식별코드 포함) → [보상 요구].` },
  7:{ body:`미션내용: 유튜브 댓글 달기 → [보상 요구].` },
  8:{ body:`미션내용: SNS포스팅(페이스북,X)` },
};

function staffItem(it, editable){
  const ts = it.updatedAt ? new Date(it.updatedAt).toLocaleString() : "-";
  const links = (it.links||[]).map(u=>`<a href="${u}" target="_blank" class="me-2">${u}</a>`).join("");
  return `
  <div class="p-2 rounded border border-secondary" data-id="${it.id}">
    <div class="d-flex justify-content-between">
      <div><strong class="item-title">${it.title||"(무제)"}</strong><div class="small text-muted">${ts}</div></div>
      ${editable?`<div class="btn-group btn-group-sm">
        <button class="btn btn-outline-light act-edit">수정</button>
        <button class="btn btn-outline-danger act-del">삭제</button>
      </div>`:""}
    </div>
    <div class="small mt-1 item-content">${(it.content||"").replace(/\n/g,"<br>")}</div>
    ${links?`<div class="small mt-1 item-links">${links}</div>`:""}
    <div class="edit-form mt-2" style="display:none">
      <div class="row g-2">
        <div class="col-md-4"><input class="form-control ef-title" value="${(it.title||"").replace(/"/g,"&quot;")}"/></div>
        <div class="col-md-8"><input class="form-control ef-links" value="${(it.links||[]).join(", ")}"/></div>
        <div class="col-12"><textarea class="form-control ef-content" rows="3">${it.content||""}</textarea></div>
        <div class="col-12 d-flex gap-2">
          <button class="btn btn-sm btn-grad ef-save" type="button">저장</button>
          <button class="btn btn-sm btn-outline-light ef-cancel" type="button">취소</button>
        </div>
      </div>
    </div>
  </div>`;
}

export async function buildMissions({ wrap, onClaim, onBuffing, onM1 }){
  const { me } = getState();
  if (!wrap) return;
  wrap.innerHTML = "";

  // isStaff는 api에 없을 수도 있으므로 안전 가드
  let isStaff = false;
  try {
    if (me && typeof api.isStaff === "function") {
      isStaff = await api.isStaff(me);
    }
  } catch {
    isStaff = false;
  }

  const tpl = document.getElementById("tplMission");
  const useTpl = !!(tpl && tpl.content && tpl.content.firstElementChild);

  for (const id of IDS){
    const frag = useTpl ? document.importNode(tpl.content, true) : (()=>{ const d=document.createElement("div"); d.className="col-12"; d.innerHTML=`
      <div class="glass p-3">
        <div class="d-flex justify-content-between flex-wrap gap-2">
          <div>
            <div class="h5 mb-1">미션 <span class="missionId"></span> — 완료보상 <span class="reward"></span></div>
            <div class="small-note">상태: <span class="status badge badge-soft"></span></div>
          </div>
          <div class="d-flex gap-2 btns"></div>
        </div>
        <div class="mt-3 missionBody small"></div>
      </div>`; return d; })();

    const root = frag instanceof HTMLElement ? frag : frag.firstElementChild;
    const q = (s)=> root.querySelector(s);
    q(".missionId").textContent = id;

    // 보상 표시
    const rewardEl = q(".reward");
    if (id===1) {
      rewardEl.textContent = "5000 GP + 5000 EXP";
    } else {
      try{
        if (typeof api.adprice === "function") {
          const priceWei = await api.adprice(id);
          const n = (typeof priceWei === "bigint") ? Number(priceWei) : Number(priceWei||0);
          rewardEl.textContent = fmtPAW(n/1e18);
        } else {
          rewardEl.textContent = "—";
        }
      }catch{
        rewardEl.textContent = "—";
      }
    }

    // 본문
    q(".missionBody").innerHTML = TEXT[id]?.body || "";

    // 상태
    const stEl = q(".status");
    if (me) {
      try { stEl.textContent = (await api.isPending(me,id)) ? "보상 심사 대기" : "대기 없음"; }
      catch { stEl.textContent = "-"; }
    } else {
      stEl.textContent = "지갑 미연결";
    }

    // 참고하기 탭(운영자/내 제출)
    const refId = `ref-${id}`;
    const btnRef = document.createElement("button");
    btnRef.className = "btn btn-sm btn-outline-info";
    btnRef.textContent = "참고하기";
    btnRef.setAttribute("data-bs-toggle","collapse");
    btnRef.setAttribute("data-bs-target",`#${refId}`);
    q(".btns").appendChild(btnRef);

    const refBox = document.createElement("div");
    refBox.className="collapse mt-3";
    refBox.id = refId;
    refBox.innerHTML = `
    <div class="p-3 rounded" style="background:rgba(255,255,255,.05); border:1px dashed rgba(255,255,255,.15)">
      <ul class="nav nav-tabs">
        <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#s-${id}">운영자 참고</button></li>
        <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#m-${id}">내 제출</button></li>
      </ul>
      <div class="tab-content pt-3">
        <div class="tab-pane fade show active" id="s-${id}">
          <div class="small text-muted mb-2">운영자 등록 자료</div>
          <div id="staffList-${id}" class="vstack gap-2"></div>
          ${isStaff ? `
          <hr class="mt-3 mb-2"/>
          <form id="staffForm-${id}" class="row g-2">
            <div class="col-md-4"><input id="staffTitle-${id}" class="form-control" placeholder="제목"/></div>
            <div class="col-md-8"><input id="staffLinks-${id}" class="form-control" placeholder="링크들(쉼표 구분)"/></div>
            <div class="col-12"><textarea id="staffContent-${id}" class="form-control" rows="3" placeholder="설명/메모"></textarea></div>
            <div class="col-12 d-flex gap-2">
              <button class="btn btn-sm btn-grad" type="submit">운영자 자료 등록</button>
              <span id="staffSaveStatus-${id}" class="small"></span>
            </div>
          </form>`:""}
        </div>
        <div class="tab-pane fade" id="m-${id}">
          <form id="mineForm-${id}" class="row g-2">
            <div class="col-12"><textarea id="mineNote-${id}" class="form-control" rows="3" placeholder="내 메모/설명"></textarea></div>
            <div class="col-12"><input id="mineLinks-${id}" class="form-control" placeholder="링크들(쉼표 구분)"/></div>
            <div class="col-12 d-flex gap-2">
              <button class="btn btn-sm btn-outline-light" type="submit">제출 저장</button>
              <span id="mineSaveStatus-${id}" class="small"></span>
            </div>
          </form>
          ${id===2?`<div class="alert alert-secondary mt-3 small mb-0">※ 미션2 연락처는 상단 폼을 우선 사용하세요.</div>`:""}
        </div>
      </div>
    </div>`;
    q(".missionBody").appendChild(refBox);

    // 운영자 참고 목록 로드
    const listEl = refBox.querySelector(`#staffList-${id}`);
    async function reloadStaff(){
      try{
        const items = await loadStaffRefs(id, 20);
        if (!items.length) { listEl.innerHTML = `<div class="text-muted small">자료 없음</div>`; return; }
        listEl.innerHTML = items.map(it=>staffItem(it, isStaff)).join("");

        if (isStaff){
          listEl.querySelectorAll(".act-edit").forEach(btn=>{
            btn.addEventListener("click",()=>{
              const card = btn.closest("[data-id]");
              card.querySelector(".edit-form").style.display="block";
              card.querySelector(".item-title").style.display="none";
              card.querySelector(".item-content").style.display="none";
              const l = card.querySelector(".item-links"); if (l) l.style.display="none";
            });
          });
          listEl.querySelectorAll(".ef-cancel").forEach(btn=>{
            btn.addEventListener("click",()=>{
              const c=btn.closest("[data-id]");
              c.querySelector(".edit-form").style.display="none";
              c.querySelector(".item-title").style.display="";
              c.querySelector(".item-content").style.display="";
              const l = c.querySelector(".item-links"); if (l) l.style.display="";
            });
          });
          listEl.querySelectorAll(".ef-save").forEach(btn=>{
            btn.addEventListener("click",async ()=>{
              const c=btn.closest("[data-id]"); const itemId=c.getAttribute("data-id");
              const title=c.querySelector(".ef-title").value.trim();
              const content=c.querySelector(".ef-content").value.trim();
              const linksIn=c.querySelector(".ef-links").value.trim();
              const links = linksIn? linksIn.split(",").map(s=>s.trim()).filter(Boolean):[];
              await updateStaffRef(id,itemId,{title,content,links});
              toast("저장되었습니다."); await reloadStaff();
            });
          });
          listEl.querySelectorAll(".act-del").forEach(btn=>{
            btn.addEventListener("click",async ()=>{
              const c=btn.closest("[data-id]"); const itemId=c.getAttribute("data-id");
              if(!confirm("삭제할까요?")) return;
              await deleteStaffRef(id,itemId);
              toast("삭제되었습니다."); await reloadStaff();
            });
          });
        }
      }catch(e){
        listEl.innerHTML = `<div class="text-danger small">로드 실패: ${e.message||e}</div>`;
      }
    }
    await reloadStaff();

    // 스태프 등록 폼
    if (isStaff){
      const f = refBox.querySelector(`#staffForm-${id}`);
      if (f) f.addEventListener("submit", async(ev)=>{
        ev.preventDefault();
        const title = refBox.querySelector(`#staffTitle-${id}`).value.trim();
        const content = refBox.querySelector(`#staffContent-${id}`).value.trim();
        const linksIn = refBox.querySelector(`#staffLinks-${id}`).value.trim();
        const links = linksIn? linksIn.split(",").map(s=>s.trim()).filter(Boolean):[];
        await createStaffRef(id,{title,content,links});
        refBox.querySelector(`#staffSaveStatus-${id}`).textContent="✅ 저장됨";
        toast("운영자 자료가 저장되었습니다."); await reloadStaff();
        refBox.querySelector(`#staffTitle-${id}`).value="";
        refBox.querySelector(`#staffContent-${id}`).value="";
        refBox.querySelector(`#staffLinks-${id}`).value="";
      });
    }

    // 내 제출 로드/저장
    const mineForm = refBox.querySelector(`#mineForm-${id}`);
    if (mineForm){
      if (me){
        try{
          const sub = await loadUserSubmission(id, me);
          if (sub){
            refBox.querySelector(`#mineNote-${id}`).value  = sub.note||"";
            refBox.querySelector(`#mineLinks-${id}`).value = (sub.links||[]).join(", ");
            refBox.querySelector(`#mineSaveStatus-${id}`).textContent="💾 불러옴";
          }
        }catch{}
      }
      mineForm.addEventListener("submit", async(ev)=>{
        ev.preventDefault();
        if (!me) return toast("지갑 연결이 필요합니다.", false);
        const note  = refBox.querySelector(`#mineNote-${id}`).value.trim();
        const links = (refBox.querySelector(`#mineLinks-${id}`).value.trim()||"")
                        .split(",").map(s=>s.trim()).filter(Boolean);
        await saveUserSubmission(id, me, { note, links });
        refBox.querySelector(`#mineSaveStatus-${id}`).textContent="✅ 저장됨";
        toast("내 제출이 저장되었습니다.");
      });
    }

    // 미션2 연락처 폼
    if (id===2){
      const addrEl = q("#m2Addr");
      if (addrEl) addrEl.textContent = me || "-";
      if (me){
        try{
          const m2 = await loadMission2(me);
          if (m2){
            const set = (sel, val)=>{ const el=q(sel); if (el) el.value=val||""; };
            set("#m2Kakao", m2.kakao);
            set("#m2Telegram", m2.telegram);
            set("#m2ZaloPhone", m2.zaloPhone);
            set("#m2Note", m2.note);
            const s = q("#m2Status"); if (s) s.textContent = "💾 불러옴";
          }
        }catch{}
      }
      const form = q("#m2Form");
      if (form) form.addEventListener("submit", async(ev)=>{
        ev.preventDefault();
        if (!me) return toast("지갑 연결이 필요합니다.", false);
        const payload = {
          kakao:      q("#m2Kakao")?.value.trim() || "",
          telegram:   q("#m2Telegram")?.value.trim() || "",
          zaloPhone:  q("#m2ZaloPhone")?.value.trim() || "",
          note:       q("#m2Note")?.value.trim() || ""
        };
        if (!payload.kakao && !payload.telegram && !payload.zaloPhone)
          return toast("하나 이상 입력하세요.", false);
        await saveMission2(me, payload);
        const s = q("#m2Status"); if (s){ s.textContent="✅ 저장됨"; s.className="small text-success"; }
        toast("연락처/메모 저장 완료");
      });
    }

    // 공통 버튼 (m1/보상 요구)
    const btnWrap = q(".btns");
    if (id===1){
      const b2 = document.createElement("button");
      b2.className="btn btn-sm btn-warning"; b2.textContent="보상받기 (5000GP+5000EXP)";
      if (typeof onBuffing === "function") b2.addEventListener("click", onBuffing);
      btnWrap.prepend(b2);
    } else {
      const b = document.createElement("button");
      b.className="btn btn-sm btn-outline-light"; b.textContent="보상 요구";
      b.addEventListener("click", async ()=>{
        if (typeof onClaim === "function") {
          // 외부 콜백이 있으면 우선 사용
          try { await onClaim(id); } catch(e){ toast(e?.message||String(e), "error"); }
        } else {
          // 기본 동작: 미션별 자동 분기 (2→claimpay2, 3→claimpay3, 4+→claimpay4)
          try {
            await api.claimByMission(id);
            toast("보상요구가 전송되었습니다. 블록 처리 대기…");
          } catch (err){
            toast("보상요구 실패: " + (err?.message || err), "error");
          }
        }
      });
      btnWrap.prepend(b);
    }

    wrap.appendChild(root);
  }
}
