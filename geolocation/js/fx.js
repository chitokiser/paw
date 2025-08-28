// /geolocation/js/fx.js
// mid(숫자) 기반 4컷(800x200) 정책 + 공통 FX 유틸 (Leaflet 기반)

/* ========================= 전역(기본 프로덕션 경로) ========================= */
let ANI_BASE = 'https://puppi.netlify.app/images/ani/';
export function getAniBase(){ return ANI_BASE; }
export function setAniBase(url){
  if (!url) return;
  ANI_BASE = String(url).replace(/\/+$/,'') + '/';
}

// === GSAP 로더 =========================================
let _gsapMod = null;
async function ensureGSAP(){
  if (_gsapMod) return _gsapMod;
  _gsapMod = await import('https://cdn.skypack.dev/gsap@3.12.5');
  return _gsapMod;
}

/* ================== 임팩트 FX + HP Bar CSS (공통) ================== */
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

  /* 크리티컬 링 */
  .crit-ring{
    position:absolute; left:50%; top:50%; width:120px; height:120px; transform:translate(-50%,-50%);
    border:3px solid rgba(255,215,0,.95); border-radius:50%;
    box-shadow: 0 0 24px rgba(255,215,0,.8), inset 0 0 14px rgba(255,215,0,.6);
    animation:critRing .5s ease-out forwards; pointer-events:none; z-index: 13000;
  }
  @keyframes critRing{0%{transform:translate(-50%,-50%) scale(.3); opacity:1}100%{transform:translate(-50%,-50%) scale(1.4); opacity:0}}

  /* 전역 FX z-index 레이어 */
  .fx-layer-upper{ z-index: 24000 !important; pointer-events:none !important; }
  `;
  const s = document.createElement('style'); s.id = 'impactfx-css'; s.textContent = css; document.head.appendChild(s);
}

export function spawnImpactAt(map, lat, lon) {
  ensureImpactCSS();
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
    once = false, fps  = 8
  } = anim;
  if (!url || !frames) return { stop:()=>{}, element:null };

  let { scale, targetPx, classNameExtra = '' } = opts;
  function _getTargetW(){
    if (Number(targetPx)) return Math.max(8, Math.round(Number(targetPx)));
    const el = wrap.querySelector('.ani-first, .ani-size-ref, .leaflet-marker-icon');
    const wFromEl = el?.clientWidth;
    if (wFromEl) return Math.round(wFromEl);
    const iconSize = marker?.options?.icon?.options?.iconSize || [];
    if (iconSize[0]) return Math.round(iconSize[0]);
    return frameW;
  }
  if (scale == null) {
    const targetW = _getTargetW();
    scale = targetW / frameW;
  }
  scale = Math.max(0.25, scale);

  const cs = window.getComputedStyle(wrap);
  if (cs.position === 'static') wrap.style.position = 'relative';

  const el = createSpriteElem({ url, frameW, frameH, scale });
  if (classNameExtra) el.classList.add(classNameExtra);
  wrap.appendChild(el);

  const { gsap } = await ensureGSAP();
  const state = { f: 0 };
  const duration = Math.max(0.001, frames / Math.max(1, fps));

  const tl = gsap.timeline({ repeat: once ? 0 : -1, paused: false });
  tl.to(state, {
    f: frames - 1,
    duration,
    ease: `steps(${frames})`,
    onUpdate(){
      const frame = (state.f | 0);
      el.style.backgroundPosition = `${-(frame * frameW)}px 0px`;
    }
  });

  const visHandler = () => {
    try { if (document.hidden) tl.pause(); else tl.resume(); } catch {}
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

export function makeAniFirstFrameIcon(mid, { size, frames = 4, frameW = 200, frameH = 200, basePath } = {}) {
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
  ensureImpactCSS();
  const html = `<div class="emojifx" style="font-weight:900; font-size:32px; color:#ffd700; text-shadow:0 2px 8px rgba(0,0,0,.45)">CRITICAL!</div>`;
  const icon = L.divIcon({ className:'', html, iconSize:[120, 50], iconAnchor:[60, 30] });
  const fx = L.marker([lat, lon], { icon, interactive:false, zIndexOffset:22000 }).addTo(map);
  setTimeout(()=>{ try{ map.removeLayer(fx); }catch{} }, 800);
}
export function flashCritRingOnMarker(marker){
  ensureImpactCSS();
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

/* =========================== 번개 FX =========================== */
export function ensureLightningCSS(){
  if (document.getElementById('lightningfx-css')) return;
  const css = `
  .fx-flash{position:fixed; inset:0; background:rgba(255,255,255,1); opacity:0; pointer-events:none; z-index: 30000;}
  .fx-lightning{position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width: 160px; height: 220px; pointer-events:none; z-index: 24000;
    filter: drop-shadow(0 0 18px rgba(255,255,255,.95)) drop-shadow(0 0 48px rgba(0,200,255,.55)); will-change: transform, opacity, filter;}
  .fx-lightning svg{position:absolute; left:50%; top:0; transform: translateX(-50%); width: 110px; height: 220px; overflow:visible;}
  .fx-lightning .glow{position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width: 180px; height: 180px; border-radius:50%;
    background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(0,200,255,0.4) 45%, rgba(0,0,0,0) 70%); opacity: 0.85; filter: blur(1px);}
  .fx-lightning .ground{position:absolute; left:50%; bottom:4px; transform:translateX(-50%); width: 140px; height: 22px; border-radius: 999px;
    background: radial-gradient(ellipse at center, rgba(255,255,255,.85) 0%, rgba(255,255,255,.25) 50%, rgba(255,255,255,0) 70%); opacity: .9;}
  `;
  const s = document.createElement('style'); s.id = 'lightningfx-css'; s.textContent = css; document.head.appendChild(s);
}

export async function spawnLightningAt(map, lat, lng, { flashScreen=false, shake=false } = {}){
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  ensureImpactCSS(); ensureLightningCSS();
  const { gsap } = await ensureGSAP();

  const boltSVG = `
    <svg viewBox="0 0 110 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#ffffff"/><stop offset="70%" stop-color="#b9f3ff"/><stop offset="100%" stop-color="#7ad7ff"/>
        </linearGradient>
        <filter id="glow" height="200%" width="200%" x="-50%" y="-50%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d="M60 0 L45 70 L78 70 L40 150 L55 95 L25 95 Z" fill="url(#lg)" stroke="#e6fbff" stroke-width="2" filter="url(#glow)"/>
    </svg>`;
  const html = `<div class="fx-lightning fx-layer-upper">${boltSVG}<div class="glow"></div><div class="ground"></div></div>`;
  const icon = L.divIcon({ className: '', html, iconSize: [0,0], iconAnchor: [0,0] });
  const mk = L.marker([lat, lng], { icon, interactive:false, zIndexOffset: 24000 }).addTo(map);

  try {
    const el = mk.getElement()?.querySelector?.('.fx-lightning');
    const glow = el?.querySelector?.('.glow'); const ground = el?.querySelector?.('.ground'); const svg = el?.querySelector('svg');
    const tl = gsap.timeline({ defaults:{ ease:'power2.out' } });
    gsap.set(el, { opacity: 0, scaleY: 0.2, transformOrigin: '50% 0%' });
    gsap.set(svg, { filter: 'blur(0.6px)' });
    gsap.set(glow,{ opacity:0.0, scale:0.6, transformOrigin:'50% 50%' });
    gsap.set(ground,{ opacity:0.0, scaleX:0.3, scaleY:0.6, transformOrigin:'50% 50%' });
    tl.to(el,{ opacity:1, scaleY:1, duration:0.06 })
      .to(glow,{ opacity:0.85, scale:1.0, duration:0.07 }, '<')
      .to(ground,{ opacity:0.9, scaleX:1.1, scaleY:1.0, duration:0.07 }, '<')
      .to(el,{ opacity:0.0, duration:0.12 }, '+=0.05')
      .to(glow,{ opacity:0.0, duration:0.12 }, '<')
      .to(ground,{ opacity:0.0, duration:0.12 }, '<');
  } catch(e){ console.warn('[spawnLightningAt] animation failed', e); }

  if (flashScreen) {
    const flashEl = document.createElement('div'); flashEl.className = 'fx-flash'; document.body.appendChild(flashEl);
    try {
      const { gsap } = await ensureGSAP();
      gsap.fromTo(flashEl, { opacity: 0 }, { opacity: 1, duration: 0.05, ease:'power1.out' })
          .to(flashEl, { opacity: 0, duration: 0.18, ease:'power1.in', delay: 0.02 })
          .eventCallback('onComplete', () => { try { flashEl.remove(); } catch {} });
    } catch { setTimeout(()=>{ try { flashEl.remove(); } catch {} }, 240); }
  }
  if (shake) { try { shakeMap(); } catch {} }
  setTimeout(()=>{ try { map.removeLayer(mk); } catch {} }, 380);
}

/* =========================== 마제스틱 폭발(기존 원형) =========================== */
export async function spawnMajesticExplosionAt(map, lat, lng, { shake=true } = {}) {
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  ensureImpactCSS();
  const { gsap } = await ensureGSAP();
  const html = `<div class="fx-majestic fx-layer-upper"><div class="core"></div><div class="ring"></div><div class="sparks"></div></div>`;
  const icon = L.divIcon({ className: '', html, iconSize: [0,0], iconAnchor: [0,0] });
  const mk = L.marker([lat, lng], { icon, interactive:false, zIndexOffset: 24000 }).addTo(map);
  try {
    const el = mk.getElement(); if (!el) return;
    const core = el.querySelector('.core') || document.createElement('div');
    const ring = el.querySelector('.ring') || document.createElement('div');
    const wrap = el.querySelector('.sparks') || document.createElement('div');
    // 간단 스파크
    const { gsap } = await ensureGSAP();
    for (let i=0;i<12;i++){
      const sp = document.createElement('div'); sp.className='spark'; wrap.appendChild(sp);
      const ang=(Math.PI*2)*(i/12)+(Math.random()*0.4-0.2), dist=60+Math.random()*40;
      const dx=Math.cos(ang)*dist, dy=Math.sin(ang)*dist;
      gsap.fromTo(sp,{ x:0,y:0,scaleY:0.3,rotation:ang*180/Math.PI },{ x:dx,y:dy,scaleY:1,opacity:0,duration:0.34+Math.random()*0.16,ease:'power2.out' });
    }
    gsap.set(core,{ opacity:0, scale:0.5, transformOrigin:'50% 50%' });
    gsap.set(ring,{ opacity:0, scale:0.3,  transformOrigin:'50% 50%' });
    const tl = gsap.timeline({ defaults:{ ease:'power2.out' } });
    tl.to(core,{ opacity:0.95, scale:1.0, duration:0.08 })
      .to(ring,{ opacity:1.0,  scale:1.15, duration:0.12 }, '<')
      .to(core,{ opacity:0, duration:0.18 }, '+=0.02')
      .to(ring,{ opacity:0, scale:1.4, duration:0.22 }, '<');
    if (shake) { try { shakeMap(); } catch {} }
  } catch (e) { console.warn('[spawnMajesticExplosionAt] animation failed', e); }
  setTimeout(() => { try { map.removeLayer(mk); } catch {} }, 520);
}

/* =========================== 🔥 사방 화염(유저 중심) =========================== */
export function ensureFlameCSS(){
  if (document.getElementById('flamefx-css')) return;
  const css = `
  .fx-flames{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:0; height:0; pointer-events:none; z-index:24000; }
  .fx-flames .flame{
    position:absolute; left:50%; top:50%; width:22px; height:36px; transform-origin:50% 100%;
    background: radial-gradient(ellipse at 50% 60%, rgba(255,255,255,.95) 0%, rgba(255,165,0,.9) 30%, rgba(255,60,0,.85) 60%, rgba(255,60,0,0) 75%);
    border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
    filter: blur(.3px) drop-shadow(0 0 10px rgba(255,120,0,.8)) drop-shadow(0 0 24px rgba(255,80,0,.35));
    opacity: 0;
  }
  .fx-flames .ring{
    position:absolute; left:50%; top:50%; width:120px; height:120px; border-radius:50%;
    transform:translate(-50%,-50%) scale(.25);
    box-shadow:0 0 22px rgba(255,120,0,.6), inset 0 0 16px rgba(255,160,0,.6);
    border:2px solid rgba(255,210,180,.9); opacity:0;
  }`;
  const st = document.createElement('style'); st.id = 'flamefx-css'; st.textContent = css; document.head.appendChild(st);
}

/**
 * 유저 위치에서 사방 화염 분출
 * @param {L.Map} map
 * @param {number} lat
 * @param {number} lng
 * @param {{count?:number, radiusPx?:number, durationMs?:number, shake?:boolean}} opt
 */
export async function spawnRadialFlamesAt(map, lat, lng, opt = {}){
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  ensureImpactCSS(); ensureFlameCSS();
  const { gsap } = await ensureGSAP();

  const count      = Number.isFinite(opt.count) ? opt.count : 16;
  const radiusPx   = Number.isFinite(opt.radiusPx) ? opt.radiusPx : 140;
  const durationMs = Number.isFinite(opt.durationMs) ? opt.durationMs : 520;
  const doShake    = opt.shake !== false;

  const html = `<div class="fx-flames fx-layer-upper"><div class="ring"></div><div class="wrap"></div></div>`;
  const icon = L.divIcon({ className:'', html, iconSize:[0,0], iconAnchor:[0,0] });
  const mk = L.marker([lat, lng], { icon, interactive:false, zIndexOffset:24000 }).addTo(map);

  try {
    const root = mk.getElement();
    const wrap = root?.querySelector?.('.wrap');
    const ring = root?.querySelector?.('.ring');

    // 링
    gsap.set(ring, { opacity:0, scale:0.25, transformOrigin:'50% 50%' });
    gsap.to(ring, { opacity:1, scale:1.0, duration:0.12, ease:'power2.out' })
        .to(ring, { opacity:0, scale:1.35, duration:0.28, ease:'power2.in' }, '+=0.02');

    // 불꽃들
    for (let i=0;i<count;i++){
      const el = document.createElement('div'); el.className='flame'; wrap.appendChild(el);
      const ang = (Math.PI*2)*(i/count) + (Math.random()*0.3 - 0.15);
      const dist = radiusPx * (0.8 + Math.random()*0.25);
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
      const rot = (ang*180/Math.PI) + (Math.random()*20 - 10);

      gsap.fromTo(el,
        { x:0, y:0, scale:0.4, rotation:rot, opacity:0 },
        { x:dx, y:dy, scale:1.15, opacity:0.98, duration:0.22, ease:'power2.out' }
      ).to(el,
        { opacity:0, scale:0.6, duration:0.22, ease:'power2.in' },
        '+=0.06'
      );
    }

    if (doShake) { try { shakeMap(); } catch {} }
  } catch (e) { console.warn('[spawnRadialFlamesAt] fail', e); }

  setTimeout(() => { try { map.removeLayer(mk); } catch {} }, durationMs);
}
