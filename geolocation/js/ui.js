// /js/ui.js
export function injectCSS(){
  // 중복 주입 방지
  if (document.getElementById('ui-base-css')) return;

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
    background:#111827; color:#fff; padding:8px 12px; border-radius:999px; display:none; z-index:10050; font-weight:600 }

  /* === HUD: 우상단 고정 + 세이프에어리어 대응 === */
  .hud{ position:fixed; right: calc(env(safe-area-inset-right, 0px) + 12px);
    top: calc(env(safe-area-inset-top, 0px) + 12px);
    background:rgba(17,24,39,.92); color:#fff; padding:10px 12px;
    border-radius:12px; z-index:10040; min-width:200px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; box-shadow:0 6px 20px rgba(0,0,0,.25) }
  .hud .row{display:flex; justify-content:space-between; gap:8px; margin:4px 0;}
  .hud .mono{font-variant-numeric:tabular-nums;}
  .hud .ok{color:#86efac}
  .hud .warn{color:#facc15}

  #startGate{ position:fixed; inset:0; width:100%; height:100%;
    background:#111827; color:#fff; font-size:20px; font-weight:700; display:flex; align-items:center; justify-content:center;
    z-index:2000; border:none; cursor:pointer; }

  /* === 코너 UI 공통 === */
  :root{ --gap:12px; --fab-size:52px; --fab-radius:16px; }

  /* Leaflet 줌 컨트롤: 좌상단 + 세이프에어리어 */
  .leaflet-top.leaflet-left{
    top: calc(env(safe-area-inset-top, 0px) + var(--gap));
    left: calc(env(safe-area-inset-left, 0px) + var(--gap));
  }

  /* FAB 버튼 공통 (홈/인벤토리) */
  .fab{
    position: fixed; z-index:10045;
    width: var(--fab-size); height: var(--fab-size);
    border-radius: var(--fab-radius);
    background:#111827; color:#fff; border:none;
    display:flex; align-items:center; justify-content:center;
    font-size:20px; cursor:pointer; box-shadow:0 6px 20px rgba(0,0,0,.28);
    outline:none; user-select:none;
    transition: transform .08s ease, box-shadow .2s ease, background .2s ease;
  }
  .fab:hover{ transform: translateY(-1px); }
  .fab:active{ transform: translateY(1px) scale(.98); }
  .fab svg{ width:28px; height:28px; }

  /* 좌하=홈, 우하=인벤토리 */
  #btn-home{
    left: calc(env(safe-area-inset-left, 0px) + var(--gap));
    bottom: calc(env(safe-area-inset-bottom, 0px) + var(--gap));
  }
  #btn-inventory{
    right: calc(env(safe-area-inset-right, 0px) + var(--gap));
    bottom: calc(env(safe-area-inset-bottom, 0px) + var(--gap));
  }
  `;
  const s = document.createElement('style');
  s.id = 'ui-base-css';
  s.textContent = css;
  document.head.appendChild(s);
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

/* ===== 코너 버튼/레이아웃 설치 ===== */
export function mountCornerUI({ map, playerMarker, invUI } = {}){
  injectCSS();
  try { ensureHUD(); } catch {}

  // 홈(FAB, 좌하)
  if (!document.getElementById('btn-home')){
    const b = document.createElement('button');
    b.id = 'btn-home'; b.className = 'fab'; b.title = '내 위치로 이동';
    b.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3l9 8-1.5 1.5L12 6 4.5 12.5 3 11l9-8z" fill="currentColor"/>
        <path d="M5 12v8h5v-5h4v5h5v-8" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>`;
    b.addEventListener('click', ()=>{
      try{
        const { lat, lng } = playerMarker.getLatLng();
        map.setView([lat,lng], Math.max(map.getZoom(), 18), { animate:true });
      }catch{}
    });
    document.body.appendChild(b);
  }

  // 인벤토리(FAB, 우하)
  if (!document.getElementById('btn-inventory')){
    const b = document.createElement('button');
    b.id = 'btn-inventory'; b.className = 'fab'; b.title = '인벤토리';
    b.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 7h12l1 3H5l1-3z" fill="currentColor"/>
        <rect x="4" y="10" width="16" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/>
        <path d="M9 13h6" stroke="currentColor" stroke-width="1.5" />
      </svg>`;
    b.addEventListener('click', ()=>{
      try{
        if (typeof invUI?.toggle === 'function'){ invUI.toggle(); return; }
        const panel = document.querySelector('.inventory-panel, [data-inventory]');
        const isOpen = !!(panel && (panel.offsetParent !== null));
        if (isOpen && typeof invUI?.close === 'function') invUI.close();
        else if (typeof invUI?.open === 'function') invUI.open();
        else console.log('[InventoryUI] toggle: open/close 메서드가 없습니다.');
      }catch(e){ console.warn(e); }
    });
    document.body.appendChild(b);
  }
}
