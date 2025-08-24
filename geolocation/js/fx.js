// /geolocation/js/fx.js
// mid(숫자) 기반 4컷(800x200) 정책 + 공통 FX 유틸 (Leaflet 기반)

/* ========================= 전역(기본 프로덕션 경로) ========================= */
let ANI_BASE = 'https://puppi.netlify.app/images/ani/';
export function getAniBase(){ return ANI_BASE; }           // ✅ 외부에서 기본 경로 조회
export function setAniBase(url){
  if (!url) return;
  ANI_BASE = String(url).replace(/\/+$/,'') + '/';
}
// === 추가: GSAP 로더 =========================================
let _gsapMod = null;
async function ensureGSAP(){
  if (_gsapMod) return _gsapMod;
  _gsapMod = await import('https://cdn.skypack.dev/gsap@3.12.5');
  return _gsapMod;
}

/* ================== 임팩트 FX + HP Bar CSS (공통) ================== */
/* ⚠️ 벼락 CSS는 여기에서 제거 —> 전용 ensureLightningCSS 로 분리 */
export function ensureImpactCSS() {
  if (document.getElementById('impactfx-css')) return;
  const css = `
  .hitfx{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;width:84px;height:84px;z-index:12000}
  .hitfx .spark{position:absolute;inset:0;border-radius:50%;
    background:radial-gradient(circle,rgba(255,255,255,1) 0%, rgba(255,255,255,.6) 22%, rgba(255,255,255,0) 60%),
               conic-gradient(from .25turn, rgba(255,255,255,1), rgba(255,255,255,0) 30%);
    filter: drop-shadow(0 6px 18px rgba(255,255,255,.8));
    animation:hitSpark .24s ease-out forwards}
  .hitfx .ring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,255,255,.95);
    box-shadow:0 0 24px rgba(255,255,255,.75);animation:hitRing .34s ease-out forwards}
  .hitfx .shard{position:absolute;left:50%;top:50%;width:4px;height:22px;transform-origin:50% 0%;
    background:linear-gradient(#fff, rgba(255,255,255,0));filter: drop-shadow(0 2px 6px rgba(255,255,255,.75));
    opacity:.95;animation:hitShard .34s ease-out forwards}
  @keyframes hitSpark{0%{transform:scale(.25) rotate(-15deg);opacity:0}50%{opacity:1}100%{transform:scale(1.25) rotate(15deg);opacity:0}}
  @keyframes hitRing{0%{transform:scale(.2);opacity:.95}100%{transform:scale(1.5);opacity:0}}
  @keyframes hitShard{
    0%{transform:rotate(var(--deg,0)) translate(-50%,-50%) scaleY(.3);opacity:1}
    100%{transform:rotate(var(--deg,0)) translate(calc(-50% + var(--dx,0px)), calc(-50% + var(--dy,0px))) scaleY(1);opacity:0}}
  @keyframes tinyShake{0%{transform:translate(0,0)}25%{transform:translate(2px,-1px)}50%{transform:translate(-2px,1px)}75%{transform:translate(1px,2px)}100%{transform:translate(0,0)}}
  .shake-map{animation:tinyShake 120ms ease}

  .mon-hp{
    position:absolute; left:50%; bottom:calc(100% + 6px);
    transform:translateX(-50%);
    width: calc(100% + 18px); height: 10px;
    background: rgba(0,0,0,.45); border-radius: 999px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.18);
    pointer-events:none; overflow:hidden;
  }
  .mon-hp-fill{
    height:100%; width:100%;
    background: linear-gradient(90deg,#22c55e,#f59e0b,#ef4444);
    transition: width .18s ease;
    will-change: width;
    contain: paint;
  }
  .mon-hp-text{position:absolute; left:0; right:0; top:-16px; font-size:12px; font-weight:700; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.6); pointer-events:none;}
  `;
  const s = document.createElement('style'); s.id = 'impactfx-css'; s.textContent = css; document.head.appendChild(s);
}

export function spawnImpactAt(map, lat, lon) {
  const angles = [0,45,90,135,180,225,270,315];
  const radius = 16;
  const shards = angles.map(a=>{
    const rad = a*Math.PI/180, dx=(Math.cos(rad)*radius).toFixed(1), dy=(Math.sin(rad)*radius).toFixed(1);
    return `<div class="shard" style="--deg:${a}deg; --dx:${dx}px; --dy:${dy}px;"></div>`;
  }).join('');
  const html = `<div class="hitfx"><div class="ring"></div><div class="spark"></div>${shards}</div>`;
  const icon = L.divIcon({ className:'', html, iconSize:[84,84], iconAnchor:[42,42] });
  const fx = L.marker([lat, lon], { icon, interactive:false, zIndexOffset: 20000 }).addTo(map);
  setTimeout(()=>{ try{ map.removeLayer(fx); }catch{} }, 380);
}

export function shakeMap(containerId = 'map') {
  const c = document.getElementById(containerId); if (!c) return;
  c.classList.remove('shake-map'); void c.offsetWidth; c.classList.add('shake-map');
  setTimeout(()=>c.classList.remove('shake-map'), 140);
}

/* =========================== HP Bar 부착 =========================== */
export function attachHPBar(marker, maxHits){
  const root = marker.getElement(); if (!root) return { set:()=>{} };
  const wrap = root.querySelector('.mon-wrap') || root;
  let bar = wrap.querySelector('.mon-hp');
  if (!bar){
    bar = document.createElement('div');
    bar.className = 'mon-hp';
    bar.innerHTML = `<div class="mon-hp-fill"></div><div class="mon-hp-text"></div>`;
    wrap.appendChild(bar);
  }
  const fill = bar.querySelector('.mon-hp-fill');
  const text = bar.querySelector('.mon-hp-text');
  const set = (left)=>{
    const safeLeft = Math.max(0, Math.min(left, maxHits));
    const p = maxHits ? (safeLeft / maxHits) * 100 : 0;
    fill.style.width = `${p}%`;
    text.textContent = `${safeLeft}/${maxHits}`;
  };
  return { set };
}

/* ======================= (일반) 스프라이트 유틸 ======================= */
function ensureSpriteCSS(){
  if (document.getElementById('spritefx-css')) return;
  const css = `
  .sprite-anim{
    position:absolute; left:50%; top:50%;
    transform: translate3d(-50%, -50%, 0) scale(var(--spr-scale, 1));
    transform-origin: 50% 50%;
    image-rendering: pixelated;
    pointer-events:none;
    will-change: transform, background-position;
    backface-visibility:hidden;
    contain: paint style layout size;
  }`;
  const s = document.createElement('style'); s.id = 'spritefx-css'; s.textContent = css;
  document.head.appendChild(s);
}
function createSpriteElem({ url, frameW, frameH, scale = 1 }){
  const el = document.createElement('div');
  el.className = 'sprite-anim';
  el.style.width  = `${frameW}px`;
  el.style.height = `${frameH}px`;
  el.style.backgroundImage  = `url("${url}")`;
  el.style.backgroundRepeat = 'no-repeat';
  el.style.backgroundPosition = '0px 0px';
  el.style.setProperty('--spr-scale', String(scale));
  return el;
}

/** ✅ GSAP steps 기반 스프라이트 애니 (잔상 최소화 + 속도정확) */
export async function attachSpriteToMarker(marker, anim = {}, opts = {}){
  ensureSpriteCSS();
  const root = marker?.getElement();
  if (!root) return { stop:()=>{}, element:null };
  const wrap = root.querySelector('.mon-wrap') || root;

  const {
    url, frames = 4, frameW = 200, frameH = 200,
    once = false, fps  = 8   // ← 기본 8fps (너무 빠르다는 피드백 반영)
  } = anim;
  if (!url || !frames) return { stop:()=>{}, element:null };


   // ✅ 원하는 픽셀 고정: opts.targetPx > .ani-first width > iconSize 순으로 결정
  let { scale, targetPx, classNameExtra = '' } = opts;
  function _getTargetW(){
    if (Number(targetPx)) return Math.max(8, Math.round(Number(targetPx)));
    const el = wrap.querySelector('.ani-first, .ani-size-ref, .leaflet-marker-icon');
    const wFromEl = el?.clientWidth;
    if (wFromEl) return Math.round(wFromEl);
    const iconSize = marker?.options?.icon?.options?.iconSize || [];
    if (iconSize[0]) return Math.round(iconSize[0]);
    return frameW; // fallback
  }
  if (scale == null) {
    const targetW = _getTargetW();
    scale = targetW / frameW;
  }
  // 🔎 스케일 스냅 제거: 정확히 요청한 픽셀을 우선함
  scale = Math.max(0.25, scale);


  const cs = window.getComputedStyle(wrap);
  if (cs.position === 'static') wrap.style.position = 'relative';

  const el = createSpriteElem({ url, frameW, frameH, scale });
  if (classNameExtra) el.classList.add(classNameExtra);
  wrap.appendChild(el);

  // ▶ GSAP steps 이징으로 정확히 프레임 스냅
  const { gsap } = await ensureGSAP();
  const state = { f: 0 };
  const duration = Math.max(0.001, frames / Math.max(1, fps)); // 한 사이클 시간(초)

  const tl = gsap.timeline({
    repeat: once ? 0 : -1,
    paused: false
  });

  tl.to(state, {
    f: frames - 1,
    duration,
    ease: `steps(${frames})`,
    onUpdate(){
      // 정수 프레임만 적용 → 잔상 방지
      const frame = (state.f | 0);
      el.style.backgroundPosition = `${-(frame * frameW)}px 0px`;
    }
  });

  // 페이지 비가시성 시 자동 일시정지 → 배터리/열/티어링 감소
  const visHandler = () => {
    try {
      if (document.hidden) tl.pause();
      else tl.resume();
    } catch {}
  };
  document.addEventListener('visibilitychange', visHandler);

  let stopped = false;
  function stop(){
    if (stopped) return; stopped = true;
    try { tl.kill(); } catch {}
    try { el.remove(); } catch {}
    document.removeEventListener('visibilitychange', visHandler);
  }

  return { stop, element: el };
}
/* ============== 4컷 mid 전용(Idle/Hit) - CSS/유틸 ============== */
let _aniCSSInjected = false;
export function ensureMonsterAniCSS(){
  if (_aniCSSInjected) return; _aniCSSInjected = true;
  const css = `
  .ani-sheet{
    position:absolute; left:50%; top:50%;
    width:200px; height:200px; pointer-events:none;
    transform: translate3d(-50%, -50%, 0) scale(var(--ani-scale, 1));
    background-repeat:no-repeat; background-position:0 0;
    background-size:800px 200px;
    animation: ani4 var(--ani-dur, 420ms) steps(4) 1 both;
    image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;
    will-change: transform, background-position; backface-visibility:hidden; contain: layout paint size;
  }
  @keyframes ani4 { from { background-position-x:0px; } to { background-position-x:-600px; } }
  .ani-wrap{ position:relative; width:0; height:0; }`;
  const style = document.createElement('style');
  style.id = 'ani4-css';
  style.textContent = css; document.head.appendChild(style);
}

export function playMonsterHitSprite(map, latlng, mid, opt={}){
  ensureMonsterAniCSS();
  const { durationMs=420, scale=1, basePath } = opt;
  const url = `${(basePath || ANI_BASE)}${encodeURIComponent(mid)}.png`;
  const html = `<div class="ani-wrap"><div class="ani-sheet" style="--ani-dur:${durationMs}ms;--ani-scale:${scale};background-image:url('${url}')"></div></div>`;
  const icon = L.divIcon({ className: 'ani-marker', html, iconSize: [0,0], iconAnchor: [0,0] });
  const mk = L.marker(L.latLng(latlng[0], latlng[1]), { icon, interactive:false, zIndexOffset:22000 }).addTo(map);
  setTimeout(() => { try { map.removeLayer(mk); } catch {} }, durationMs + 60);
}

export function makeAniFirstFrameIcon(mid, {
  size, frames = 4, frameW = 200, frameH = 200, basePath
} = {}) {
  const isAbsolute = String(mid).startsWith('http://') || String(mid).startsWith('https://');
  const url = isAbsolute ? String(mid) : `${(basePath || ANI_BASE)}${encodeURIComponent(mid)}.png`;

  const w = Math.max(16, Number(size) || 96);
  const aspect = frameH / frameW;
  const h = Math.round(w * aspect);

  const bgW = w * frames;
  const bgH = h;

  const html = `
    <div class="ani-first" style="
      width:${w}px;height:${h}px;
      background:url('${url}') 0 0 / ${bgW}px ${bgH}px no-repeat;
      image-rendering:pixelated; pointer-events:none;
    "></div>`;
  return L.divIcon({ className: 'ani-first-icon', html, iconSize: [w, h], iconAnchor: [w/2, h] });
}

/* ===== Critical 표시/링 ===== */
export function spawnCritLabelAt(map, lat, lon){
  const html = `<div class="emojifx" style="font-weight:900; font-size:32px; color:#ffd700; text-shadow:0 2px 8px rgba(0,0,0,.45)">CRITICAL!</div>`;
  const icon = L.divIcon({ className:'', html, iconSize:[120, 50], iconAnchor:[60, 30] });
  const fx = L.marker([lat, lon], { icon, interactive:false, zIndexOffset:22000 }).addTo(map);
  setTimeout(()=>{ try{ map.removeLayer(fx); }catch{} }, 800);
}
export function flashCritRingOnMarker(marker){
  try{
    const root = marker.getElement();
    const wrap = root?.querySelector('.mon-wrap') || root;
    if (!wrap) return;
    const ring = document.createElement('div');
    ring.className = 'crit-ring';
    wrap.appendChild(ring);
    setTimeout(()=>{ try{ ring.remove(); }catch{} }, 500);
  }catch{}
}

/* ===== Lightning FX (단일 소스) ===== */
let _lightningCSSInjected = false;
export function ensureLightningCSS(){
  if (_lightningCSSInjected) return;
  const css = `
  .lightning-wrap{
    position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    width:140px; height:160px; pointer-events:none; z-index:22000;
  }
  .lightning-bolt{
    position:absolute; left:50%; top:0; width:6px; height:90%;
    transform: translateX(-50%) skewX(-8deg);
    background:
      linear-gradient(#fff, rgba(255,255,255,.9) 10%, rgba(140,200,255,.7) 40%, rgba(120,180,255,.0));
    box-shadow: 0 0 18px rgba(140,200,255,.95), 0 0 36px rgba(120,180,255,.8) inset;
    filter: drop-shadow(0 0 8px rgba(140,200,255,.9));
    clip-path: polygon(48% 0%, 54% 0%, 60% 20%, 52% 20%, 66% 45%, 56% 45%, 70% 70%, 50% 70%, 58% 100%, 46% 100%, 40% 80%, 48% 80%, 34% 55%, 44% 55%, 30% 30%, 40% 30%);
    animation: boltFlash .18s ease-out forwards;
  }
  .lightning-branch{
    position:absolute; top:25%; left:50%; width:4px; height:40%;
    background: linear-gradient(#fff, rgba(140,200,255,.0));
    filter: drop-shadow(0 0 8px rgba(140,200,255,.9));
    transform-origin: top center;
    animation: boltFlash .22s ease-out forwards;
  }
  .lightning-branch.b1{ transform: translateX(-50%) rotate(-35deg); }
  .lightning-branch.b2{ transform: translateX(-50%) rotate(28deg); top:38%; height:34%; }
  .impact-ring{
    position:absolute; left:50%; bottom:8px; width:120px; height:120px; transform:translateX(-50%);
    border-radius:50%; border:3px solid rgba(140,200,255,.95);
    box-shadow:0 0 24px rgba(140,200,255,.8);
    animation: ringOut .35s ease-out forwards;
  }
  .screen-flash{
    position:fixed; inset:0; background:rgba(255,255,255,.85); z-index:2147483646; pointer-events:none;
    animation: screenFlash .12s ease-out forwards;
  }
  @keyframes boltFlash{ 0%{opacity:0; filter:brightness(1.6)} 20%{opacity:1} 100%{opacity:.0; filter:brightness(1)} }
  @keyframes ringOut{ 0%{transform:translateX(-50%) scale(.2); opacity:1} 100%{transform:translateX(-50%) scale(1.6); opacity:0} }
  @keyframes screenFlash{ 0%{opacity:.85} 100%{opacity:0} }
  `;
  const s=document.createElement('style'); s.id='lightningfx-css'; s.textContent=css; document.head.appendChild(s);
  _lightningCSSInjected = true;
}

/** 목표 좌표에 벼락 이펙트(정확히 꽂힘) */
export function spawnLightningAt(map, lat, lon, {flashScreen=true, shake=true} = {}){
  ensureLightningCSS();
  const html = `
    <div class="lightning-wrap">
      <div class="lightning-bolt"></div>
      <div class="lightning-branch b1"></div>
      <div class="lightning-branch b2"></div>
      <div class="impact-ring"></div>
    </div>`;
  const icon = L.divIcon({ className:'', html, iconSize:[140,160], iconAnchor:[70,150] });
  const mk = L.marker([lat, lon], { icon, interactive:false, zIndexOffset: 22000 }).addTo(map);
  setTimeout(()=>{ try{ map.removeLayer(mk); }catch{} }, 380);

  if (flashScreen){
    const flash = document.createElement('div');
    flash.className = 'screen-flash';
    document.body.appendChild(flash);
    setTimeout(()=>{ try{ flash.remove(); }catch{} }, 160);
  }
  if (shake){ try{ shakeMap(); } catch{} }
}
