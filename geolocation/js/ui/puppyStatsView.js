// puppyStatsView.js
// - geohome에 Puppy(강아지) 능력값을 불러와 보여주는 UI 카드
// - 체인 모듈: /js/chain/*
// - 게임 상태 스토어: /js/Score.js

import { ch_connectAndLoad } from "../chain/ch_wallet.js";
import { ch_deriveGameStats } from "../chain/ch_puppy_stats.js";
import { Score } from "../Score.js";

const $ = (s, el=document)=>el.querySelector(s);
const fmtPct = v => (v*100).toFixed(1) + '%';
const fmtNum = v => Number(v).toFixed(1);

function renderCard(root, state){
  root.innerHTML = `
    <style>
      .puppy-card{ background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1);
        color:#e9eefc; border-radius:16px; padding:16px; max-width:680px; }
      .puppy-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .btn{ background:linear-gradient(135deg,#7c3aed,#2563eb); color:#fff; border:none;
        padding:10px 14px; border-radius:12px; cursor:pointer; }
      .kv{ background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
        padding:10px; border-radius:12px; }
      .kv b{ display:block; font-size:12px; color:#cfe1ff; }
      .kv span{ font-size:16px; }
    </style>
    <div class="puppy-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <h3 style="flex:1;margin:0;font-size:18px">Puppy Stats</h3>
        <span>티어: <strong id="tier">${state?.tier ?? 0}</strong></span>
        <button id="btn" class="btn">${state?'Reload':'Connect & Load'}</button>
      </div>
      <div class="kv" style="margin-bottom:10px">
        <b>Raw (0~1000)</b>
        <span>I:${state?.raw?.I ?? 0} · C:${state?.raw?.C ?? 0} · S:${state?.raw?.S ?? 0}
             · A:${state?.raw?.A ?? 0} · E:${state?.raw?.E ?? 0} · F:${state?.raw?.F ?? 0}</span>
      </div>
      <div class="puppy-grid">
        <div class="kv"><b>Move Speed</b>   <span id="ms">${fmtNum(state?.derived?.moveSpeed ?? 3.8)} m/s</span></div>
        <div class="kv"><b>Melee Damage</b> <span id="md">${fmtNum(state?.derived?.meleeDamage ?? 20)}</span></div>
        <div class="kv"><b>Crit Chance</b>  <span id="cc">${fmtPct(state?.derived?.critChance ?? 0.05)}</span></div>
        <div class="kv"><b>Dodge</b>        <span id="dg">${fmtPct(state?.derived?.dodge ?? 0.02)}</span></div>
        <div class="kv"><b>Dash CD</b>      <span id="dc">${fmtNum(state?.derived?.dashCD ?? 6.0)} s</span></div>
        <div class="kv"><b>Energy Max</b>   <span id="em">${fmtNum(state?.derived?.energyMax ?? 100)}</span></div>
        <div class="kv"><b>Energy Regen</b> <span id="er">${fmtNum(state?.derived?.energyRegen ?? 2)} /10s</span></div>
        <div class="kv"><b>Ail Resist</b>   <span id="ar">${fmtPct(state?.derived?.ailResist ?? 0)}</span></div>
        <div class="kv"><b>Skill CDR</b>    <span id="sr">${fmtPct(state?.derived?.skillCDR ?? 0)}</span></div>
      </div>
    </div>
  `;
}

async function loadAndApply(root){
  const result = await ch_connectAndLoad();            // {addr, tier, raw}
  const derived = ch_deriveGameStats(result.raw);      // 파생 계산
  // 게임 스토어 반영
  Score.setTier(Number(result.tier));
  Score.applyDerived(derived);
  // 카드 렌더
  renderCard(root, { ...result, derived });
}

(function init(){
  const root = document.getElementById("puppy-card");
  if (!root) return;
  renderCard(root, null);

  root.addEventListener('click', async (e)=>{
    const btn = e.target.closest('#btn');
    if (!btn) return;
    btn.disabled = true; btn.textContent = 'Loading…';
    try{
      await loadAndApply(root);
    }catch(err){
      alert('Wallet connect/load failed: '+(err?.message||err));
    }finally{
      const b = root.querySelector('#btn'); if (b){ b.disabled = false; b.textContent = 'Reload'; }
    }
  });
})();
