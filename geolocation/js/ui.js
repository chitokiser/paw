// /js/ui.js
export function injectCSS(){
  const css = `
  .mon-wrap{position:relative;}
  .mon-img{ width:100%; height:100%; display:block; object-fit:contain;
    image-rendering:crisp-edges; image-rendering:pixelated; transition:filter .15s ease, opacity .6s ease, transform .6s ease;}
  .mon-hit{animation:hitflash .12s steps(1) 2;}
  @keyframes hitflash{50%{filter:brightness(2.2) contrast(1.3) saturate(1.4)}}
  .mon-death{animation:spinout .9s ease forwards;}
  @keyframes spinout{to{opacity:0; transform:rotate(540deg) scale(.1); filter:blur(2px)}}

  .player-emoji{font-size:22px; transition:filter .12s ease}
  .player-hit{ animation: playerflash .22s steps(1) 2; }
  .leaflet-marker-icon.player-hit{ animation: playerflash .22s steps(1) 2; }
  @keyframes playerflash{ 50%{ filter: brightness(2.2) contrast(1.5) } }

  #eventToast{ position:fixed; top:12px; left:50%; transform:translateX(-50%);
    background:#111827; color:#fff; padding:8px 12px; border-radius:999px; display:none; z-index:1001; font-weight:600 }
  .hud{ position:fixed; right:12px; top:60px; background:rgba(17,24,39,.92); color:#fff; padding:10px 12px;
    border-radius:12px; z-index:1000; min-width:200px; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; box-shadow:0 6px 20px rgba(0,0,0,.25) }
  .hud .row{display:flex; justify-content:space-between; gap:8px; margin:4px 0;}
  .hud .mono{font-variant-numeric:tabular-nums;}
  .hud .ok{color:#86efac}
  .hud .warn{color:#facc15}

  #startGate{ position:fixed; inset:0; width:100%; height:100%;
    background:#111827; color:#fff; font-size:20px; font-weight:700; display:flex; align-items:center; justify-content:center;
    z-index:2000; border:none; cursor:pointer; }`;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
}

export function toast(msg){
  let t=document.getElementById('eventToast');
  if(!t){ t=document.createElement('div'); t.id='eventToast'; document.body.appendChild(t); }
  t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',1100);
}

export function ensureHUD(){
  let hud = document.querySelector('.hud');
  if (hud) return hud;
  hud = document.createElement('div');
  hud.className='hud';
  hud.innerHTML = `
    <div class="row"><div>남은 시간</div><div id="hudTime" class="mono warn">-</div></div>
    <div class="row"><div>남은 타격</div><div id="hudHits" class="mono ok">-</div></div>
    <div class="row"><div>이번 보상</div><div id="hudEarn" class="mono">-</div></div>
    <div class="row"><div>이동거리</div><div id="hudDist" class="mono">0 m</div></div>
    <div class="row"><div>블록체인점수</div><div id="hudChain" class="mono">0</div></div>
  `;
  document.body.appendChild(hud);
  return hud;
}
export function setHUD({timeLeft=null, hitsLeft=null, earn=null, chain=null, distanceM=null}={}){
  const hud = ensureHUD();
  if (timeLeft!=null)  hud.querySelector('#hudTime').textContent  = timeLeft;
  if (hitsLeft!=null)  hud.querySelector('#hudHits').textContent  = hitsLeft;
  if (earn!=null)      hud.querySelector('#hudEarn').textContent  = `+${earn} GP`;
  if (chain!=null)     hud.querySelector('#hudChain').textContent = chain;
  if (distanceM!=null) hud.querySelector('#hudDist').textContent  = `${Math.round(distanceM)} m`;
}
export function addStartGate(onStart){
  if (document.getElementById('startGate')) return;
  const btn = document.createElement('button');
  btn.id = 'startGate'; btn.textContent = '탭해서 시작';
  document.body.appendChild(btn);
  const kick = ()=>{ try { onStart?.(); } catch {} btn.remove(); };
  btn.addEventListener('pointerdown', kick, { once:true });
  document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState === 'visible') { try {} catch {} }});
}
