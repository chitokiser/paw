/* File: C2E/js/c2e-app.js */
import { KEYWORDS, STYLES } from './c2e-data.js';
import { connectWallet, currentWallet } from './c2e-wallet.js';

/* ---------- util ---------- */
const $ = (s, el=document)=> el.querySelector(s);

// 이미지 경로 보정: 데이터는 "c2e/1.png" 같은 하위경로만 넣는다.
function imgPath(p){
  if(!p) return '';
  if(p.startsWith('/')) return p;                // /images/...
  if(p.startsWith('images/')) return '/' + p;    // images/... -> /images/...
  return '/images/' + p;                         // c2e/1.png -> /images/c2e/1.png
}

function challengeCode(){
  return 'PAW-' + Math.random().toString(16).slice(2,6).toUpperCase();
}

function loadState(){
  try{ return JSON.parse(localStorage.getItem('autoblog_state')||'{}'); }
  catch(e){ return {}; }
}
function saveState(st){ localStorage.setItem('autoblog_state', JSON.stringify(st)); }

/* ---------- dropdowns ---------- */
function initDropdowns(){
  const kwSel = $('select[name=keyword_id]');
  const stSel = $('select[name=style_id]');

  // 키워드
  KEYWORDS.forEach(k=>{
    const o = document.createElement('option');
    o.value = k.id; o.textContent = k.label;
    kwSel.appendChild(o);
  });

  // 스타일
  STYLES.forEach(s=>{
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.label + (s.hint?(' — '+s.hint):'');
    stSel.appendChild(o);
  });

  kwSel.addEventListener('change', rebuildRefLinks);
  rebuildRefLinks();
}

function rebuildRefLinks(){
  const kwSel = $('select[name=keyword_id]');
  const refSel = $('select[name=ref_link]');
  if (!kwSel || !refSel) return;

  refSel.innerHTML = '<option value="">-- 선택 --</option>';

  const kw = KEYWORDS.find(k=> String(k.id) === kwSel.value);
  if(kw){
    // 1) ref_links 배열 지원
    if(Array.isArray(kw.ref_links)){
      kw.ref_links.forEach(r=>{
        const o = document.createElement('option');
        o.value = r.url; o.textContent = (r.label||r.url) + ' — ' + r.url;
        refSel.appendChild(o);
      });
    }
    // 2) 단일 기본 링크
    if(kw.link_url){
      const o = document.createElement('option');
      o.value = kw.link_url; o.textContent = kw.link_url;
      refSel.appendChild(o);
    }

    // 키워드 기본 이미지 미리보기
    const img = $('#kwImage');
    if(img && kw.default_image){
      img.src = imgPath(kw.default_image);
      img.style.display='block';
      img.onerror = ()=>{ img.style.display='none'; };
    }
  }
}

/* ---------- session ---------- */
function ensureUser(){
  const addr = currentWallet();
  if(!addr){
    $('#connectWrap')?.style && ($('#connectWrap').style.display='block');
    $('#mainForm')?.style && ($('#mainForm').style.display='none');
  }else{
    $('#connectWrap')?.style && ($('#connectWrap').style.display='none');
    $('#mainForm')?.style && ($('#mainForm').style.display='block');
    const w = $('#who'); if(w) w.textContent = addr.slice(0,6)+'…'+addr.slice(-4);
  }
}

/* ---------- markdown -> html (간단 렌더) ---------- */
function mdToHtml(md){
  const esc = (s)=>s.replace(/[&<>]/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[m]));
  const lines = (md||'').split(/\r?\n/);
  let html = "";
  let inList = false;
  for(const ln of lines){
    if(/^#{1,6}\s/.test(ln)){
      if(inList){ html += "</ul>"; inList=false; }
      const level = ln.match(/^#+/)[0].length;
      html += `<h${level}>${esc(ln.replace(/^#{1,6}\s/, ""))}</h${level}>`;
      continue;
    }
    if(/^\s*-\s+/.test(ln)){
      if(!inList){ html += "<ul>"; inList=true; }
      html += `<li>${esc(ln.replace(/^\s*-\s+/, ""))}</li>`;
      continue;
    }
    if(ln.trim()===""){ if(inList){ html += "</ul>"; inList=false; } continue; }
    if(inList){ html += "</ul>"; inList=false; }
    html += `<p>${esc(ln)}</p>`;
  }
  if(inList) html += "</ul>";
  return html;
}

/* ---------- 모델/이미지 호출 ---------- */
async function callBothModels({ keyword, styleHint, refUrl, lang, useGPT, useGemini }) {
  const results = { gpt:"", gemini:"" };

  // 언어 안내 (mix 제거)
  const langGuide =
    lang === "en" ? "Write in English." :
    lang === "vi" ? "Write in Vietnamese." :
    "Write in Korean.";

  const body = { keyword, styleHint, refUrl, lang };

  async function call(path){
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if(!r.ok){
      const t = await r.text();
      throw new Error(`${path} failed: ${t}`);
    }
    return r.json();
  }

  const tasks = [];
  if (useGPT)    tasks.push(call("/api/gpt").then(j=>{ results.gpt = (j.text||"").trim(); }));
  if (useGemini) tasks.push(call("/api/gemini").then(j=>{ results.gemini = (j.text||"").trim(); }));

  await Promise.all(tasks);
  return results;
}

async function fetchImages(keyword, n) {
  try{
    const r = await fetch(`/api/images?q=${encodeURIComponent(keyword)}&n=${n}`);
    const j = await r.json();
    return Array.isArray(j.urls) ? j.urls : [];
  }catch(e){ return []; }
}

function interleaveImages(htmlA, htmlB, imgUrls, fallbackImg) {
  const para = (htmlA + "\n" + htmlB)
    .split(/<\/p>/).map(s=>s.trim()).filter(Boolean)
    .map(s=> s.endsWith("</p>")? s : s+"</p>");
  const out = [];
  const imgs = [...imgUrls];
  para.forEach((p, idx)=>{
    out.push(p);
    if (idx % 2 === 1) {
      const src = imgs.shift() || fallbackImg;
      if (src) out.push(
        `<p><img src="${src}" alt="related" style="max-width:100%;border-radius:12px;border:1px solid #e6e8ef"/></p>`
      );
    }
  });
  return out.join("\n");
}

function langHint(lang){
  switch(lang){
    case "en": return "영문";
    case "vi": return "베트남어";
    default:   return "한국어";
  }
}

/* ---------- main actions ---------- */
async function generateDraft(e){
  e.preventDefault();
  const addr = currentWallet();
  if(!addr){ alert('지갑 연결이 필요합니다'); return; }

  const kwId  = Number($('select[name=keyword_id]').value);
  const stId  = Number($('select[name=style_id]').value);
  const ref   = $('select[name=ref_link]').value || '';
  const langEl = $('select[name=lang]');
  const lang = (langEl && ['ko','en','vi'].includes(langEl.value)) ? langEl.value : 'ko';

  if(!kwId || !stId){ alert('키워드/스타일을 선택하세요'); return; }
  const kw = KEYWORDS.find(k=>k.id===kwId);
  const st = STYLES.find(s=>s.id===stId);
  const code = challengeCode();

  // 모델 호출 옵션
  const useGPT    = $('input[name=use_gpt]')?.checked ?? true;
  const useGemini = $('input[name=use_gemini]')?.checked ?? true;

  // 1) 모델 결과 가져오기
  let gptText = "", gemText = "";
  try{
    const { gpt, gemini } = await callBothModels({
      keyword: kw.label,
      styleHint: st.hint || st.label,
      refUrl: ref || kw.link_url,
      lang, useGPT, useGemini
    });
    gptText = gpt; gemText = gemini;
  }catch(err){
    $('#draft').innerHTML =
      `<div class="alert alert-warning"><b>API 오류</b><br>${err.message}</div>`;
    return;
  }

  // 2) 관련 이미지
  const imgCount = Math.max(1, Math.min(8, parseInt(($('input[name=images]')?.value)||"4",10)));
  const fetched = await fetchImages(kw.label, imgCount);
  const fallback = imgPath(kw.default_image || 'c2e/placeholder.png');
  const images = fetched.length ? fetched.slice(0, imgCount) : Array(imgCount).fill(fallback);

  // 3) 렌더
  const htmlA = mdToHtml(gptText);
  const htmlB = mdToHtml(gemText);
  const mixed = interleaveImages(htmlA, htmlB, images, fallback);

  const header = `
    <h2>${kw.label} <small style="font-size:.8em;color:#6b7280">(${st.label}, ${langHint(lang)})</small></h2>
    <p>추천 링크: <a href="${ref || kw.link_url}" target="_blank">${ref || kw.link_url}</a></p>
    <p>도전코드: <b>${code}</b></p>
  `;
  $('#draft').innerHTML = header + mixed;
  $('#code').textContent = code;

  // 4) 상태 저장
  const stt = loadState();
  stt.users = stt.users || {};
  stt.users[addr] = stt.users[addr] || { level:1, points:0 };
  stt.tasks = stt.tasks || [];
  const tid = Date.now();
  stt.tasks.push({
    id: tid, addr, kwId, kwLabel: kw.label, stId, stLabel: st.label,
    code, status:'open', base:10, lang, models:{ gpt:useGPT, gemini:useGemini }
  });
  saveState(stt);

  $('#taskId').value = String(tid);
  $('#verifyWrap').style.display='block';
  refreshMyTasks();
}

async function verifySubmission(e){
  e.preventDefault();
  const addr = currentWallet();
  const taskId = Number($('#taskId').value);
  const url = $('#postURL').value.trim();
  const pasted = $('#pasted').value;

  const stt = loadState();
  const task = (stt.tasks||[]).find(t=>t.id===taskId && t.addr===addr);
  if(!task){ alert('작업을 찾을 수 없습니다'); return; }

  let content = '';
  let usedPaste = false;
  if(url){
    try{
      const resp = await fetch(url, { mode:'cors' });
      content = await resp.text();
    }catch(e){ usedPaste = true; }
  }
  if(!content){
    if(!pasted){ alert('CORS로 가져오지 못했습니다. 본문 붙여넣기를 이용하세요.'); return; }
    content = pasted; usedPaste = true;
  }
  const hasCode = content.includes(task.code);
  const m = content.match(/0x[a-fA-F0-9]{40}/);
  const detectedWallet = m ? m[0] : null;
  const ok = hasCode || (detectedWallet && detectedWallet.toLowerCase()===addr.toLowerCase());

  stt.submissions = stt.submissions || [];
  stt.submissions.push({ id: Date.now(), taskId, addr, url, detectedWallet, ok, usedPaste, when: new Date().toISOString() });
  task.status = ok ? 'verified' : 'posted';
  saveState(stt);
  alert(ok ? '✓ 자동 검증 완료' : '검증 보류(코드/지갑주소 미탐지)');
  refreshMyTasks();
}

function refreshMyTasks(){
  const addr = currentWallet();
  const stt = loadState();
  const my = (stt.tasks||[]).filter(t=>t.addr===addr).sort((a,b)=>b.id-a.id);
  const tbody = $('#myTasks');
  if(!tbody) return;
  tbody.innerHTML = my.map(t=>`
    <tr>
      <td>${t.id}</td>
      <td>${t.kwLabel}</td>
      <td>${t.stLabel}</td>
      <td>${t.status}</td>
      <td class="code">${t.code}</td>
    </tr>
  `).join('');
}

/* ---------- boot ---------- */
window.addEventListener('DOMContentLoaded', ()=>{
  initDropdowns();
  ensureUser();
  $('#btnConnect')?.addEventListener('click', connectWallet);
  $('#genForm')?.addEventListener('submit', generateDraft);
  $('#verifyForm')?.addEventListener('submit', verifySubmission);
  refreshMyTasks();
  document.addEventListener('wallet:connected', ()=>{
    ensureUser(); refreshMyTasks();
  });
});
// File: C2E/js/c2e-app.js
const API_BASE = (location.port === "8888")
  ? ""                         // netlify dev로 접속 중이면 같은 오리진 사용
  : "http://localhost:8888";   // 다른 포트(5550 등)에서 열었을 땐 8888로 프록시

async function call(path, body){
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if(!res.ok){ throw new Error(`${path} failed: ${await res.text()}`); }
  return res.json();
}

// 사용처
// call("/api/gpt", {...})
// call("/api/gemini", {...})
