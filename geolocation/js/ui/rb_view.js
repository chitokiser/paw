// /geolocation/js/ui/rb_view.js
// 요구사항 게시판 UI (작성자만 수정/삭제 노출)
// - 목록 실시간(onSnapshot)
// - 낙관적(optimistic) 카드 즉시 추가
// - myUid와 authorUid를 비교해 내 글에만 액션 버튼 노출

import { rb_authReady, rb_getMyLevel, rb_subscribe, rb_create, rb_update, rb_delete } from "../board/rb_api.js";
import { auth } from "../firebase.js";

const $ = (s, el=document)=>el.querySelector(s);
let MY_UID = null; // 현재 로그인 UID

/* ──────────────────────────────────────────────
 * 낙관적 임시 항목 보관
 * ────────────────────────────────────────────── */
const Local = {
  temps: new Map(), // tempId -> item
  makeTemp({ title, body, tags, authorUid, authorName }) {
    const id = "temp-" + Date.now();
    const item = {
      id,
      title,
      body,
      tags,
      status: "open",
      authorUid: authorUid || MY_UID || null,
      authorName: authorName || "you",
      createdAt: { toDate: ()=> new Date() },
      _optimistic: true
    };
    this.temps.set(id, item);
    return item;
  },
  clearIfReplaced(remoteList){
    // 원격이 도착하면 같은 제목/본문의 임시 항목 제거(간단 매칭)
    const remoteSig = new Set(remoteList.map(i => (i.title||"") + "§" + (i.body||"")));
    for (const [id, it] of this.temps){
      const sig = (it.title||"")+"§"+(it.body||"");
      if (remoteSig.has(sig)) this.temps.delete(id);
    }
  },
  mergedWith(remoteList){
    const temps = Array.from(this.temps.values());
    return [...temps, ...remoteList];
  }
};

/* ──────────────────────────────────────────────
 * 템플릿: 리스트 아이템 (작성자만 액션 노출)
 * ────────────────────────────────────────────── */
function tplListItem(p, myUid){
  const isMine = (p.authorUid && myUid && p.authorUid === myUid);
  const when = p.createdAt?.toDate ? p.createdAt.toDate() : null;
  const ts = when ? when.toLocaleString() : "";
  const spin = p._optimistic ? ' ⏳' : '';
  return `
    <div class="rb-item" data-id="${p.id}">
      <div class="rb-head">
        <div class="rb-title">${escapeHtml(p.title||"(no title)")}${spin}</div>
        <div class="rb-meta">
          <span class="rb-status">${p.status||"open"}</span>
          <span class="rb-author">${escapeHtml(p.authorName||"unknown")}</span>
          <span class="rb-when">${ts}</span>
        </div>
      </div>
      <div class="rb-body">${escapeHtml(p.body||"")}</div>
      ${Array.isArray(p.tags)&&p.tags.length
        ? `<div class="rb-tags">${p.tags.map(t=>`<span>#${escapeHtml(t)}</span>`).join(" ")}</div>`
        : ""}
      ${isMine ? `
        <div class="rb-actions">
          <button class="rb-mark" data-status="accepted"${p._optimistic?' disabled':''}>Accept</button>
          <button class="rb-mark" data-status="in_progress"${p._optimistic?' disabled':''}>Doing</button>
          <button class="rb-mark" data-status="done"${p._optimistic?' disabled':''}>Done</button>
          <button class="rb-del"${p._optimistic?' disabled':''}>Delete</button>
        </div>
      ` : ``}
    </div>
  `;
}

/* ──────────────────────────────────────────────
 * 스타일
 * ────────────────────────────────────────────── */
function mountStyles(){
  if (document.getElementById("rb-styles")) return;
  const css = document.createElement("style");
  css.id = "rb-styles";
  css.textContent = `
    .rb-wrap { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
               color:#e9eefc; border-radius:16px; padding:16px; }
    .rb-form { display:grid; gap:8px; margin-bottom:14px; }
    .rb-form input, .rb-form textarea {
      width:100%; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,.15);
      background:rgba(0,0,0,.25); color:#e9eefc;
    }
    .rb-btn { background:linear-gradient(135deg,#7c3aed,#2563eb); color:#fff;
              border:none; padding:10px 14px; border-radius:12px; cursor:pointer; }
    .rb-item { border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:12px; margin-bottom:10px; background:rgba(255,255,255,.03); }
    .rb-title { font-weight:700; font-size:16px; }
    .rb-meta { opacity:.8; font-size:12px; display:flex; gap:8px; margin-top:2px; }
    .rb-body { white-space:pre-wrap; margin-top:6px; }
    .rb-tags { margin-top:8px; opacity:.9; font-size:12px; }
    .rb-tags span { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12);
                    padding:2px 8px; border-radius:999px; margin-right:4px; display:inline-block; }
    .rb-actions { margin-top:8px; display:flex; gap:6px; }
    .rb-actions button { background:rgba(255,255,255,.08); color:#e9eefc; border:1px solid rgba(255,255,255,.12);
                         padding:6px 10px; border-radius:10px; cursor:pointer; }
    .rb-note { font-size:12px; opacity:.85; margin-bottom:8px; }
    .rb-muted { opacity:.7; }
  `;
  document.head.appendChild(css);
}

/* ──────────────────────────────────────────────
 * 렌더/바인딩
 * ────────────────────────────────────────────── */
function renderForm(root, canWrite){
  const disabled = canWrite ? "" : "disabled";
  root.innerHTML = `
    <div class="rb-wrap">
      <div class="rb-note">유저 요구사항 게시판 — <span class="rb-muted">레벨 1 이상 작성 가능</span></div>
      <div class="rb-form">
        <input id="rb-title" type="text" placeholder="제목" ${disabled}/>
        <textarea id="rb-body" rows="4" placeholder="내용" ${disabled}></textarea>
        <input id="rb-tags" type="text" placeholder="태그(쉼표로 구분)" ${disabled}/>
        <button id="rb-submit" class="rb-btn" ${disabled}>등록</button>
      </div>
      <div id="rb-list"></div>
    </div>
  `;
  if (!canWrite) {
    const note = document.createElement("div");
    note.className = "rb-note";
    note.textContent = "작성 권한이 없습니다. (레벨 1 이상 필요)";
    root.querySelector(".rb-form")?.appendChild(note);
  }
}

function bindEvents(root){
  root.addEventListener("click", async (e)=>{
    const sbtn = e.target.closest("#rb-submit");
    if (sbtn) {
      sbtn.disabled = true; sbtn.textContent = "등록 중…";
      try{
        const title = $("#rb-title", root)?.value?.trim();
        const body  = $("#rb-body", root)?.value?.trim();
        const tags  = ($("#rb-tags", root)?.value||"").split(",").map(s=>s.trim()).filter(Boolean);
        if (!title || !body) { alert("제목/내용을 입력하세요."); return; }

        // 1) 낙관적 즉시 추가 (내 UID/이메일 반영)
        const authorUid  = MY_UID;
        const authorName = auth.currentUser?.email || "you";
        const temp = Local.makeTemp({ title, body, tags, authorUid, authorName });
        const list = $("#rb-list", root);
        list.insertAdjacentHTML("afterbegin", tplListItem(temp, MY_UID));

        // 2) 서버 생성
        await rb_create({ title, body, tags });

        // 3) 입력칸 초기화
        $("#rb-title", root).value = "";
        $("#rb-body",  root).value = "";
        $("#rb-tags",  root).value = "";
      }catch(err){
        alert("등록 실패: " + (err?.message||err));
      }finally{
        sbtn.disabled = false; sbtn.textContent = "등록";
      }
    }

    const markBtn = e.target.closest(".rb-mark");
    if (markBtn) {
      const id = e.target.closest(".rb-item")?.dataset?.id;
      const status = markBtn.dataset.status;
      try { await rb_update(id, { status }); }
      catch (err) { alert("상태 변경 실패: " + (err?.message||err)); }
    }

    const delBtn = e.target.closest(".rb-del");
    if (delBtn) {
      const id = e.target.closest(".rb-item")?.dataset?.id;
      if (!confirm("삭제하시겠습니까?")) return;
      try { await rb_delete(id); }
      catch (err) { alert("삭제 실패: " + (err?.message||err)); }
    }
  });
}

function mountList(root){
  const list = $("#rb-list", root);
  rb_subscribe((remote)=>{
    // 원격이 도착하면 임시 항목 제거/대체
    Local.clearIfReplaced(remote);
    const merged = Local.mergedWith(remote);
    list.innerHTML = merged.map(item => tplListItem(item, MY_UID)).join("");
  });
}

/* ──────────────────────────────────────────────
 * 유틸
 * ────────────────────────────────────────────── */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

/* ──────────────────────────────────────────────
 * 부트스트랩
 * ────────────────────────────────────────────── */
(async function init(){
  const host = document.getElementById("reqboard");
  if (!host) return;
  mountStyles();

  await rb_authReady();
  MY_UID = auth.currentUser?.uid || null;

  const level = await rb_getMyLevel();
  const canWrite = level >= 1;

  renderForm(host, canWrite);
  bindEvents(host);
  mountList(host);
})();
