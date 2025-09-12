// mission.missions.js — mission texts + cards + collapsible "참고하기" (staff CRUD)

// ✅ 필요한 모듈만 깔끔하게 import
import { api, getState } from "./mission.api.js";
import { $, toast, fmtPAW } from "./mission.ui.js";
import {
  saveMission2,
  loadMission2,
  createStaffRef, loadStaffRefs, updateStaffRef, deleteStaffRef,
  saveUserSubmission, loadUserSubmission
} from "./mission.storage.js";

// 렌더링할 미션 ID 목록 (필요 시 늘리세요)
const MISSION_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

// 미션 본문 안내 텍스트
const MISSION_TEXT = {
  1: {
    body: `미션내용: 멘토 어카운트 입력 후 레벨1 달성 → 
      <a href="https://puppi.netlify.app/memberjoin" target="_blank" rel="noopener">회원가입 링크</a><br>
      <b>보상:</b> 별도 PAW 지급이 아닌 <b>5000 GP + 5000 EXP</b>가 지급됩니다.<br>
      보상은 <code>mypage.html</code>의 [5000GP + 5000EXP Free]와 동일하게 <code>buffing()</code>을 호출해 즉시 적용됩니다.`
  },
  2: {
    body: `
    미션내용: 카카오ID, 텔레그램ID, <b>Zalo 전화번호</b> 등록 후 관리자에게 연락.<br>
    완료 후 본문 폼의 [아이디 등록하기] → [보상 요구] 순서로 진행.<br><br>
    <b>운영자 메신저 QR</b><br>
    <div class="d-flex flex-wrap gap-3 mt-2">
      <div class="text-center">
        <img src="../images/qr/kakao.png" alt="Kakao QR" width="100" class="border rounded"/><br>
        <small>Kakao</small>
      </div>
      <div class="text-center">
        <img src="../images/qr/zalo.png" onerror="this.onerror=null;this.src='../images/qr/qrzalo.png'" alt="Zalo QR" width="100" class="border rounded"/><br>
        <small>Zalo</small>
      </div>
      <div class="text-center">
        <img src="../images/qr/telegram.png" alt="Telegram QR" width="100" class="border rounded"/><br>
        <small>Telegram</small>
      </div>
    </div>
    <hr>
    <div class="mt-2">
      <div class="small mb-1">※ 아래 입력값은 <b>지갑주소를 키</b>로 Firestore에 저장됩니다.</div>
      <form id="m2Form" class="row g-2">
        <div class="col-12 col-md-4">
          <label class="form-label small">Kakao ID</label>
          <input id="m2Kakao" class="form-control" placeholder="your-kakao-id"/>
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label small">Telegram ID</label>
          <input id="m2Telegram" class="form-control" placeholder="@yourtelegram"/>
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label small">Zalo Phone</label>
          <input id="m2ZaloPhone" type="tel" class="form-control" placeholder="+84 912 345 678"/>
        </div>
        <div class="col-12">
          <label class="form-label small">주로 사용하는 ID/닉네임 등 식별자</label>
          <textarea id="m2Note" class="form-control" rows="2" placeholder="블로그/유튜브/구글 등에서 주로 쓰는 닉네임"></textarea>
        </div>
        <div class="col-12 d-flex align-items-center gap-3 mt-2">
          <button id="m2SaveBtn" type="submit" class="btn btn-sm btn-outline-light">아이디 등록하기</button>
          <span class="small text-muted">내 지갑주소: <span class="addr" id="m2Addr">-</span></span>
          <span id="m2Status" class="small"></span>
        </div>
      </form>
    </div>`
  },
  3: { body: `미션내용: 오픈채팅방 리스트(운영자 제공/숨김펼침)에 모두 가입 후 인사말 채팅 → [보상 요구].` },
  4: { body: `미션내용: 블로그 만들기 모두 생성 + 첫 포스팅 → [보상 요구].` },
  5: { body: `미션내용: 가입한 블로그에 매일 글쓰기(매일보상). 글 주제/배너/이미지는 AI 자동 제공 → 완료 후 [보상 요구].` },
  6: { body: `미션내용: 광고주(구글/카카오/네이버) 상점 리뷰·평점 작성(식별코드=지갑 앞6자리 포함) → 완료 후 [보상 요구].` },
  7: { body: `미션내용: 유튜브 댓글 달기(샘플 제공) → 완료 후 [보상 요구].` },
  8: { body: `미션내용: (운영자 지정) — 본 미션은 예비 슬롯입니다. 필요 시 내용을 채워주세요.` }
};

// 운영자 참고 항목 렌더
function renderStaffItemHTML(it, missionId, editable) {
  const ts = it.updatedAt ? new Date(it.updatedAt).toLocaleString() : "-";
  const linksHtml = (it.links || [])
    .map(u => `<a href="${u}" target="_blank" rel="noopener" class="me-2">${u}</a>`)
    .join("");
  return `
    <div class="p-2 rounded border border-secondary" data-id="${it.id}">
      <div class="d-flex justify-content-between align-items-start gap-2">
        <div class="flex-grow-1">
          <strong class="item-title">${it.title || "(무제)"}</strong>
          <div class="small text-muted">${ts}</div>
        </div>
        ${editable ? `
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn btn-outline-light act-edit">수정</button>
            <button type="button" class="btn btn-outline-danger act-del">삭제</button>
          </div>` : ``}
      </div>
      <div class="small mt-1 item-content">${(it.content || "").replace(/\n/g, "<br>")}</div>
      ${linksHtml ? `<div class="mt-1 small item-links">${linksHtml}</div>` : ""}
      <!-- 편집폼 (숨김) -->
      <div class="edit-form mt-2" style="display:none">
        <div class="row g-2">
          <div class="col-12 col-md-4"><input class="form-control ef-title" value="${(it.title || "").replace(/"/g, "&quot;")}"/></div>
          <div class="col-12 col-md-8"><input class="form-control ef-links" value="${(it.links || []).join(", ")}"/></div>
          <div class="col-12"><textarea class="form-control ef-content" rows="3">${it.content || ""}</textarea></div>
          <div class="col-12 d-flex gap-2">
            <button class="btn btn-sm btn-grad ef-save" type="button">저장</button>
            <button class="btn btn-sm btn-outline-light ef-cancel" type="button">취소</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function buildMissions({ wrap, onClaim, onBuffing, onM1 }) {
  const { me } = getState();
  if (!wrap) return;
  wrap.innerHTML = "";

  // 온체인 staff[user] 기준 스태프 판정
  const isStaff = me ? (await api.isStaff(me)) : false;

  const tpl = document.getElementById("tplMission");
  const hasTpl = !!(tpl && tpl.content && tpl.content.firstElementChild);

  for (const id of MISSION_IDS) {
    // --- 카드 생성
    let node;
    if (hasTpl) {
      node = document.importNode(tpl.content, true);
    } else {
      const div = document.createElement("div");
      div.className = "col-12";
      div.innerHTML = `
        <div class="glass p-3">
          <div class="d-flex justify-content-between flex-wrap gap-2">
            <div>
              <div class="h5 mb-1">미션 <span class="missionId"></span> — 완료보상 <span class="reward"></span></div>
              <div class="small-note">상태: <span class="status badge badge-soft"></span></div>
            </div>
            <div class="d-flex gap-2 btns"></div>
          </div>
          <div class="mt-3 missionBody small"></div>
        </div>`;
      node = div;
    }
    const root = node instanceof HTMLElement ? node : node.firstElementChild || node;
    const q = (s) => root.querySelector(s);

    q(".missionId").textContent = id;

    // --- 보상 표시
    const rewardEl = q(".reward");
    if (id === 1) {
      rewardEl.textContent = "5000 GP + 5000 EXP";
    } else {
      try {
        const p = await api.adprice(id);
        rewardEl.textContent = fmtPAW(Number(p) / 1e18);
      } catch {
        rewardEl.textContent = "0 PAW";
      }
    }

    // --- 본문
    q(".missionBody").innerHTML = (MISSION_TEXT[id]?.body) || "";

    // --- 버튼 영역 확보
    let btnWrap = q(".btns");
    if (!btnWrap) {
      btnWrap = document.createElement("div");
      btnWrap.className = "d-flex gap-2 btns";
      (root.querySelector(".d-flex.justify-content-between") || root).appendChild(btnWrap);
    }

    // --- 상태 표시
    const statusEl = q(".status");
    if (me) {
      try {
        const pending = await api.isPending(me, id);
        statusEl.textContent = pending ? "보상 심사 대기" : "대기 없음";
      } catch {
        statusEl.textContent = "-";
      }
    } else {
      statusEl.textContent = "지갑 미연결";
    }

    // === [참고하기] 토글 + 탭 ===
    const collapseId = `ref-${id}`;
    const btnRef = document.createElement("button");
    btnRef.className = "btn btn-sm btn-outline-info";
    btnRef.setAttribute("data-bs-toggle", "collapse");
    btnRef.setAttribute("data-bs-target", `#${collapseId}`);
    btnRef.textContent = "참고하기";
    btnWrap.appendChild(btnRef);

    const refBox = document.createElement("div");
    refBox.className = "collapse mt-3";
    refBox.id = collapseId;
    refBox.innerHTML = `
      <div class="p-3 rounded" style="background:rgba(255,255,255,.05); border:1px dashed rgba(255,255,255,.15)">
        <ul class="nav nav-tabs" role="tablist">
          <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#ref-staff-${id}" type="button">운영자 참고</button></li>
          <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#ref-mine-${id}" type="button">내 제출</button></li>
        </ul>
        <div class="tab-content pt-3">
          <!-- 운영자 참고 -->
          <div class="tab-pane fade show active" id="ref-staff-${id}">
            <div class="small text-muted mb-2">운영자가 등록한 참고자료</div>
            <div id="staffList-${id}" class="vstack gap-2"></div>
            ${isStaff ? `
              <hr class="mt-3 mb-2"/>
              <form id="staffForm-${id}" class="row g-2">
                <div class="col-12 col-md-4"><input id="staffTitle-${id}" class="form-control" placeholder="제목(선택)"/></div>
                <div class="col-12 col-md-8"><input id="staffLinks-${id}" class="form-control" placeholder="링크들(쉼표로 구분, 선택)"/></div>
                <div class="col-12"><textarea id="staffContent-${id}" class="form-control" rows="3" placeholder="설명 또는 참고 메모"></textarea></div>
                <div class="col-12 d-flex gap-2">
                  <button class="btn btn-sm btn-grad" type="submit">운영자 자료 등록</button>
                  <span id="staffSaveStatus-${id}" class="small"></span>
                </div>
              </form>
            ` : ``}
          </div>

          <!-- 내 제출 -->
          <div class="tab-pane fade" id="ref-mine-${id}">
            <form id="mineForm-${id}" class="row g-2">
              <div class="col-12"><textarea id="mineNote-${id}" class="form-control" rows="3" placeholder="내 제출(메모/링크 설명)"></textarea></div>
              <div class="col-12"><input id="mineLinks-${id}" class="form-control" placeholder="링크들(쉼표로 구분, 선택)"/></div>
              <div class="col-12 d-flex gap-2">
                <button class="btn btn-sm btn-outline-light" type="submit">제출 저장</button>
                <span id="mineSaveStatus-${id}" class="small"></span>
              </div>
            </form>
            ${id === 2 ? `<div class="alert alert-secondary mt-3 small mb-0">※ 미션2의 메신저/연락처는 ‘본문의 아이디 등록하기 폼’을 우선 사용하세요.</div>` : ``}
          </div>
        </div>
      </div>
    `;
    q(".missionBody")?.appendChild(refBox);

    // --- 운영자 참고 목록 로드 & 편집 바인딩
    const listEl = refBox.querySelector(`#staffList-${id}`);
    async function reloadStaffList() {
      try {
        const items = await loadStaffRefs(id, 20);
        if (!items.length) {
          listEl.innerHTML = `<div class="text-muted small">등록된 참고자료가 없습니다.</div>`;
          return;
        }
        listEl.innerHTML = items.map(it => renderStaffItemHTML(it, id, isStaff)).join("");
        if (isStaff) {
          // 수정/삭제 이벤트
          listEl.querySelectorAll(".act-edit").forEach(btn => {
            btn.addEventListener("click", () => {
              const card = btn.closest("[data-id]");
              card.querySelector(".edit-form").style.display = "block";
              card.querySelector(".item-title").style.display = "none";
              card.querySelector(".item-content").style.display = "none";
              const l = card.querySelector(".item-links"); if (l) l.style.display = "none";
            });
          });
          listEl.querySelectorAll(".ef-cancel").forEach(btn => {
            btn.addEventListener("click", () => {
              const card = btn.closest("[data-id]");
              card.querySelector(".edit-form").style.display = "none";
              card.querySelector(".item-title").style.display = "";
              card.querySelector(".item-content").style.display = "";
              const l = card.querySelector(".item-links"); if (l) l.style.display = "";
            });
          });
          listEl.querySelectorAll(".ef-save").forEach(btn => {
            btn.addEventListener("click", async () => {
              const card = btn.closest("[data-id]");
              const itemId  = card.getAttribute("data-id");
              const title   = card.querySelector(".ef-title").value.trim();
              const content = card.querySelector(".ef-content").value.trim();
              const linksIn = card.querySelector(".ef-links").value.trim();
              const links   = linksIn ? linksIn.split(",").map(s => s.trim()).filter(Boolean) : [];
              try {
                await updateStaffRef(id, itemId, { title, content, links });
                toast("저장되었습니다.");
                await reloadStaffList();
              } catch (e) { toast(e?.message || "저장 실패", false); }
            });
          });
          listEl.querySelectorAll(".act-del").forEach(btn => {
            btn.addEventListener("click", async () => {
              const card = btn.closest("[data-id]");
              const itemId = card.getAttribute("data-id");
              if (!confirm("정말 삭제할까요?")) return;
              try {
                await deleteStaffRef(id, itemId);
                toast("삭제되었습니다.");
                await reloadStaffList();
              } catch (e) { toast(e?.message || "삭제 실패", false); }
            });
          });
        }
      } catch (e) {
        console.error("staff refs load error:", e);
        listEl.innerHTML = `<div class="text-danger small">참고자료 로드 실패. <br>오류: ${e.message || JSON.stringify(e)} <br>F12 개발자 콘솔을 확인하세요.</div>`;
      }
    }
    await reloadStaffList();

    // --- 스태프 입력 핸들러(생성)
    if (isStaff) {
      const f = refBox.querySelector(`#staffForm-${id}`);
      if (f) {
        f.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          try {
            const title   = refBox.querySelector(`#staffTitle-${id}`)?.value?.trim() || "";
            const content = refBox.querySelector(`#staffContent-${id}`)?.value?.trim() || "";
            const linksIn = refBox.querySelector(`#staffLinks-${id}`)?.value?.trim() || "";
            const links   = linksIn ? linksIn.split(",").map(s => s.trim()).filter(Boolean) : [];
            await createStaffRef(id, { title, content, links });
            refBox.querySelector(`#staffSaveStatus-${id}`).textContent = "✅ 저장됨";
            toast("운영자 참고자료가 저장되었습니다.");
            await reloadStaffList();
            // 폼 리셋
            refBox.querySelector(`#staffTitle-${id}`).value = "";
            refBox.querySelector(`#staffContent-${id}`).value = "";
            refBox.querySelector(`#staffLinks-${id}`).value = "";
          } catch (e) {
            toast(e?.message || "저장 실패", false);
          }
        });
      }
    }

    // --- 내 제출 탭: 기존 데이터 채우기 + 저장
    const myForm = refBox.querySelector(`#mineForm-${id}`);
    if (myForm) {
      // 로드
      if (me) {
        try {
          const sub = await loadUserSubmission(id, me);
          if (sub) {
            const noteEl  = refBox.querySelector(`#mineNote-${id}`);
            const linksEl = refBox.querySelector(`#mineLinks-${id}`);
            if (noteEl)  noteEl.value  = sub.note || "";
            if (linksEl) linksEl.value = (sub.links || []).join(", ");
            refBox.querySelector(`#mineSaveStatus-${id}`).textContent = "💾 불러옴";
          }
        } catch { /* no-op */ }
      }
      // 저장
      myForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        try {
          if (!me) throw new Error("지갑 연결이 필요합니다.");
          const note    = refBox.querySelector(`#mineNote-${id}`)?.value?.trim() || "";
          const linksIn = refBox.querySelector(`#mineLinks-${id}`)?.value?.trim() || "";
          const links   = linksIn ? linksIn.split(",").map(s => s.trim()).filter(Boolean) : [];
          await saveUserSubmission(id, me, { note, links });
          refBox.querySelector(`#mineSaveStatus-${id}`).textContent = "✅ 저장됨";
          toast("내 제출이 저장되었습니다.");
        } catch (e) {
          toast(e?.message || "저장 실패", false);
        }
      });
    }

    // --- 미션2 본문 폼: 로드 + 저장
    if (id === 2) {
      const meSpan = q("#m2Addr"); if (meSpan) meSpan.textContent = me || "-";
      if (me) {
        try {
          const m2 = await loadMission2(me);
          if (m2) {
            q("#m2Kakao").value     = m2.kakao || "";
            q("#m2Telegram").value  = m2.telegram || "";
            q("#m2ZaloPhone").value = m2.zaloPhone || "";
            q("#m2Note").value      = m2.note || "";
            q("#m2Status").textContent = "💾 불러옴";
          }
        } catch { /* no-op */ }
      }
      const m2Form = q("#m2Form");
      if (m2Form) {
        m2Form.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          try {
            if (!me) throw new Error("지갑 연결이 필요합니다.");
            const kakao     = q("#m2Kakao")?.value?.trim() || "";
            const telegram  = q("#m2Telegram")?.value?.trim() || "";
            const zaloPhone = q("#m2ZaloPhone")?.value?.trim() || "";
            const note      = q("#m2Note")?.value?.trim() || "";
            if (!kakao && !telegram && !zaloPhone) return toast("하나 이상의 ID/번호를 입력하세요.", false);
            await saveMission2(me, { kakao, telegram, zaloPhone, note });
            const st = q("#m2Status"); if (st) { st.textContent = "✅ 저장됨"; st.className = "small text-success"; }
            toast("메신저/연락처 및 참고 데이터가 저장되었습니다.");
          } catch (e) {
            toast(e?.message || "저장 실패", false);
          }
        });
      }
    }

    // --- 고유 동작 버튼
    if (id === 1) {
      const btnM1 = document.createElement("button");
      btnM1.className = "btn btn-sm btn-grad";
      btnM1.textContent = "화이트멤버 되기 (m1)";
      btnM1.addEventListener("click", onM1);

      const btnReward = document.createElement("button");
      btnReward.className = "btn btn-sm btn-warning";
      btnReward.textContent = "보상받기 (5000GP+5000EXP)";
      btnReward.addEventListener("click", onBuffing);

      const linkMyPage = document.createElement("a");
      linkMyPage.className = "btn btn-sm btn-outline-light";
      linkMyPage.href = "../mypage.html";
      linkMyPage.target = "_blank";
      linkMyPage.rel = "noopener";
      linkMyPage.textContent = "마이페이지 열기";

      btnWrap.prepend(btnM1, btnReward, linkMyPage);
    } else {
      const btnClaim = document.createElement("button");
      btnClaim.className = "btn btn-sm btn-outline-light";
      btnClaim.textContent = "보상 요구";
      btnClaim.addEventListener("click", () => onClaim(id));
      btnWrap.prepend(btnClaim);
    }

    // --- DOM에 삽입
    wrap.appendChild(root);
  }
}
