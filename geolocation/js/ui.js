// /geolocation/js/ui.js
/* =================================================================
 * HUD & 코너 UI (안정판)
 *  - HUD 항목: 레벨 / 공격력 / 방어력 / 경험치바 / HP / 블록체인 포인트 / 이동거리
 *  - 레벨업 버튼 제거(자동 레벨업 정책)
 *  - 널가드/중복주입/숫자 변환 방어
 *  - CP 표시: cp/chainPoint/chain 모두 수용(하위호환)
 *  - HP/EXP 바: id + class 동시 부여(레거시 선택자 호환)
 *  - ⬅ 좌측 상단에 geohome.html로 돌아가는 버튼 추가 (Leaflet 기본 ± 숨김)
 * ================================================================= */

export function injectCSS(){
  if (document.getElementById('ui-base-css')) return;

  const css = `
  .mon-wrap{position:relative;}
  .mon-img{ width:100%; height:100%; display:block; object-fit:contain;
    image-rendering:crisp-edges; image-rendering:pixelated;
    transition:filter .15s ease, opacity .6s ease, transform .6s ease;}
  .mon-hit{animation:hitflash .12s steps(1) 2;}
  @keyframes hitflash{50%{filter:brightness(2.2) contrast(1.3) saturate(1.4)}}
  .mon-death{animation:spinout .9s ease forwards;}
  @keyframes spinout{to{opacity:0; transform:rotate(540deg) scale(.1); filter:blur(2px)}}

  .player-emoji{font-size:22px; transition:filter .12s ease}
  .player-hit{ animation: playerflash .22s steps(1) 2; }
  .leaflet-marker-icon.player-hit{ animation: playerflash .22s steps(1) 2; }
  @keyframes playerflash{ 50%{ filter: brightness(2.2) contrast(1.5) } }

  #eventToast{
    position:fixed; top:12px; left:50%; transform:translateX(-50%);
    background:#111827; color:#fff; padding:8px 12px; border-radius:999px;
    display:none; z-index:10050; font-weight:600
  }

  /* === HUD: 우상단 고정 === */
  #hud{
    position:fixed;
    right: calc(env(safe-area-inset-right, 0px) + 12px);
    top:   calc(env(safe-area-inset-top,   0px) + 12px);
    background:rgba(17,24,39,.68);
    color:#fff; padding:10px 12px;
    border-radius:12px; z-index:10040; min-width:220px;
    box-shadow:0 10px 30px rgba(0,0,0,.28); backdrop-filter: blur(8px);
    font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
  }
  #hud .row{display:flex; justify-content:space-between; align-items:center; gap:8px; margin:4px 0;}
  #hud .label{opacity:.85; font-size:12px;}
  #hud .val{font-weight:800; font-variant-numeric:tabular-nums;}

  .bar{ height:10px; background:#111827; border-radius:999px; overflow:hidden;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
  .bar>i{ display:block; height:100%; width:0%;
          background: linear-gradient(90deg,#22c55e,#f59e0b,#ef4444);
          transition: width .25s ease; }
  .bar.exp>i{ background: linear-gradient(90deg,#38bdf8,#60a5fa,#a78bfa); }

  :root{ --gap:12px; --fab-size:52px; --fab-radius:16px; }

  /* Leaflet 기본 ± 줌 컨트롤 숨김 */
  .leaflet-control-zoom{ display:none !important; }

  /* (참고) 좌측 상단 컨테이너 위치 보정 유지 */
  .leaflet-top.leaflet-left{
    top:  calc(env(safe-area-inset-top,  0px) + var(--gap));
    left: calc(env(safe-area-inset-left, 0px) + var(--gap));
  }

  .fab{
    position: fixed; z-index:10045;
    width: var(--fab-size); height: var(--fab-size);
    border-radius: var(--fab-radius);
    background:rgba(17,24,39,.68); color:#fff; border:none;
    display:flex; align-items:center; justify-content:center;
    font-size:20px; cursor:pointer; box-shadow:0 6px 20px rgba(0,0,0,.28);
    outline:none; user-select:none;
    transition: transform .08s ease, box-shadow .2s ease, background .2s ease;
    backdrop-filter: blur(6px);
  }
  .fab:hover{ transform: translateY(-1px); }
  .fab:active{ transform: translateY(1px) scale(.98); }
  .fab svg{ width:28px; height:28px; }

  /* 좌측 상단: 지오홈으로 */
  #btn-back{
    left: calc(env(safe-area-inset-left,  0px) + var(--gap));
    top:  calc(env(safe-area-inset-top,   0px) + var(--gap));
  }

  #btn-home{
    left:   calc(env(safe-area-inset-left,  0px) + var(--gap));
    bottom: calc(env(safe-area-inset-bottom,0px) + var(--gap));
  }
  #btn-inventory{
    right:  calc(env(safe-area-inset-right, 0px) + var(--gap));
    bottom: calc(env(safe-area-inset-bottom,0px) + var(--gap));
  }`;
  const s = document.createElement('style');
  s.id = 'ui-base-css';
  s.textContent = css;
  document.head.appendChild(s);
}

export function toast(msg){
  if (!msg && msg !== 0) return;
  let t=document.getElementById('eventToast');
  if(!t){ t=document.createElement('div'); t.id='eventToast'; document.body.appendChild(t); }
  t.textContent=String(msg);
  t.style.display='block';
  setTimeout(()=>{ try{ t.style.display='none'; }catch{} },1100);
}

/* ---------- 내부 유틸 ---------- */
const $ = (id)=>document.getElementById(id);
const _num = (v, def=0)=> (Number.isFinite(Number(v)) ? Number(v) : def);
const _distText = (m)=>{
  const n = Number(m);
  if (!Number.isFinite(n)) return '0 m';
  if (n < 1000) return `${Math.round(n)} m`;
  return `${(n/1000).toFixed(2)} km`;
};

/** HUD 생성 */
export function ensureHUD(){
  let hud = $('hud');
  if (hud) return hud;

  hud = document.createElement('div');
  hud.id = 'hud';
  hud.innerHTML = `
    <div class="row"><span class="label">레벨</span>   <span id="hudLevel" class="val">1</span></div>
    <div class="row"><span class="label">공격력</span> <span id="hudAtk" class="val">1</span></div>
    <div class="row"><span class="label">방어력</span> <span id="hudDef" class="val">10</span></div>

    <div class="row" style="margin-top:2px">
      <span class="label">경험치</span>
      <span id="hudExpText" class="val">0 / 20,000</span>
    </div>
    <div class="bar exp"><i id="hudExpFill" class="hud-exp-fill"></i></div>

    <div class="row" style="margin-top:6px">
      <span class="label">HP</span>
      <span id="hudHPText" class="val hud-hp-text">0 / 0</span>
    </div>
    <div class="bar"><i id="hudHPFill" class="hud-hp-fill"></i></div>

    <div class="row" style="margin-top:6px">
      <span class="label">블록체인 포인트</span>
      <span id="hudChain" class="val hud-cp-text">0</span>
    </div>

    <div class="row" style="margin-top:2px">
      <span class="label">이동거리</span>
      <span id="hudDist" class="val">0 m</span>
    </div>
  `;
  document.body.appendChild(hud);

  return hud;
}

/** HUD 업데이트: 필요한 키만 넘기면 됩니다. */
export function setHUD(partial = {}){
  ensureHUD();

  if (partial.level   != null && $('hudLevel')) $('hudLevel').textContent = String(partial.level);
  if (partial.attack  != null && $('hudAtk'))   $('hudAtk').textContent   = String(partial.attack);
  if (partial.defense != null && $('hudDef'))   $('hudDef').textContent   = String(partial.defense);

  // EXP: 현재 / (다음레벨 × 20000)
  if (partial.exp != null || partial.level != null){
    const lvFromHUD = _num($('hudLevel')?.textContent, 1);
    const lv   = _num(partial.level, lvFromHUD);
    const cur  = Math.max(0, _num(partial.exp, 0));
    const need = Math.max(1, (lv + 1) * 20000);
    const pct  = Math.max(0, Math.min(100, (cur/need)*100));
    if ($('hudExpText')) $('hudExpText').textContent = `${cur.toLocaleString()} / ${need.toLocaleString()}`;
    if ($('hudExpFill')) $('hudExpFill').style.width = pct.toFixed(1) + '%';
  }

  // HP
  if (partial.hp != null || partial.hpMax != null){
    const cur = Math.max(0, _num(partial.hp, 0));
    const max = Math.max(1, _num(partial.hpMax, Math.max(cur, 1)));
    const pct = Math.max(0, Math.min(100, (cur/max)*100));
    if ($('hudHPText')) $('hudHPText').textContent = `${cur} / ${max}`;
    if ($('hudHPFill')) $('hudHPFill').style.width = pct.toFixed(1) + '%';
  }

  // 체인 포인트(cp 우선, 하위호환: chainPoint/chain)
  const cpLike = (partial.cp ?? partial.chainPoint ?? partial.chain);
  if (cpLike != null && $('hudChain')) $('hudChain').textContent = String(_num(cpLike, 0));

  // 이동거리
  if (partial.distanceM != null && $('hudDist')) $('hudDist').textContent = _distText(partial.distanceM);
}

/** 시작 게이트 */
export function addStartGate(onStart){
  if (document.getElementById('startGate')) return;
  const btn = document.createElement('button');
  btn.id = 'startGate';
  btn.textContent = '탭해서 시작';
  Object.assign(btn.style, {
    position:'fixed', inset:0, width:'100%', height:'100%',
    background:'#111827', color:'#fff', fontSize:'20px', fontWeight:700,
    display:'flex', alignItems:'center', justifyContent:'center',
    zIndex:2000, border:'none', cursor:'pointer'
  });
  document.body.appendChild(btn);
  const kick = ()=>{ try { onStart?.(); } catch (e) { console.warn('[startGate] onStart err', e); } try { btn.remove(); } catch {} };
  btn.addEventListener('pointerdown', kick, { once:true });
}

export function mountCornerUI({ map, playerMarker, invUI } = {}){
  injectCSS();
  ensureHUD();

  // 좌측 상단: 지오홈(geohome.html)으로 돌아가기 버튼
  if (!document.getElementById('btn-back')){
    const b = document.createElement('button');
    b.id = 'btn-back'; b.className = 'fab'; b.title = '지오홈으로';
    b.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    b.addEventListener('click', ()=>{
      try{
        const url = (window.__GEOHOME_URL || 'geohome.html');
        window.location.href = url;
      }catch{ window.location.assign('geohome.html'); }
    });
    document.body.appendChild(b);
  }

  // 홈 버튼
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
        if (!map || !playerMarker?.getLatLng) return;
        const { lat, lng } = playerMarker.getLatLng();
        map.setView([lat,lng], Math.max(map.getZoom?.()||18, 18), { animate:true });
      }catch(e){ console.warn('[btn-home] err', e); }
    });
    document.body.appendChild(b);
  }

  // 인벤토리 버튼
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
      }catch(e){ console.warn('[btn-inventory] err', e); }
    });
    document.body.appendChild(b);
  }
}

export default {
  injectCSS,
  toast,
  ensureHUD,
  setHUD,
  addStartGate,
  mountCornerUI
};
