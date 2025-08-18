// /js/fx.js

/* 임팩트 FX + 몬스터 HP바 CSS 주입 */
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
  }
  .mon-hp-text{
    position:absolute; left:0; right:0; top:-16px;
    font-size:12px; font-weight:700; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.6);
    pointer-events:none;
  }

  /* ===== Emoji FX (호환용) ===== */
  .emojifx{
    font-size: 36px;
    animation: popUp .8s ease-out forwards;
  }
  @keyframes popUp{
    0%{ transform:translateY(0) scale(0.2); opacity:0; }
    40%{ transform:translateY(-20px) scale(1.2); opacity:1; }
    100%{ transform:translateY(-40px) scale(1); opacity:0; }
  }

  .crit-ring{
    position:absolute;inset:0;border-radius:50%;
    border:3px solid gold;
    box-shadow:0 0 20px gold;
    animation:critRing .5s ease-out forwards;
  }
  @keyframes critRing{
    0%{ transform:scale(0.2); opacity:1; }
    100%{ transform:scale(2.2); opacity:0; }
  }

  /* ===== Explosion FX (user → monster) ===== */
  .boomfx{
    position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    pointer-events:none; width:var(--boom-size,120px); height:var(--boom-size,120px);
    z-index:20000;
  }
  .boom-core{
    position:absolute; inset:0; border-radius:50%;
    background:
      radial-gradient(circle at 50% 50%,
        rgba(255,255,255,.95) 0%,
        rgba(255,255,255,.75) 22%,
        rgba(255,200,120,.25) 40%,
        rgba(255,150,0,0) 60%);
    filter: blur(1px);
    animation: boomCore .22s ease-out forwards;
  }
  @keyframes boomCore{
    0%{ transform:scale(.3); opacity:0; }
    60%{ opacity:1; }
    100%{ transform:scale(1.35); opacity:0; }
  }

  .boom-ring{
    position:absolute; inset:0; border-radius:50%;
    border:2px solid hsl(var(--boom-hue,20) 90% 60% / .95);
    box-shadow:0 0 24px hsl(var(--boom-hue,20) 90% 55% / .8);
    animation: boomRing .38s ease-out forwards;
  }
  @keyframes boomRing{
    0%{ transform:scale(.25); opacity:1; }
    100%{ transform:scale(1.8); opacity:0; }
  }

  .boom-rays>i{
    position:absolute; left:50%; top:50%; width:3px; height:26px; transform-origin:50% 0%;
    background:linear-gradient(hsl(var(--boom-hue,20) 90% 70%), transparent);
    filter: drop-shadow(0 2px 6px hsl(var(--boom-hue,20) 90% 70% / .8));
    opacity:.95; animation: boomRay .34s ease-out forwards;
  }
  @keyframes boomRay{
    0%{ transform:rotate(var(--deg)) translate(-50%,-50%) scaleY(.3); }
    100%{ transform:rotate(var(--deg)) translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scaleY(1); opacity:0; }
  }

  .boom-sparks>em{
    position:absolute; left:50%; top:50%; width:6px; height:6px; border-radius:50%;
    background:#fff; box-shadow:0 0 10px #fff; animation: boomSpark .5s ease-out forwards;
  }
  @keyframes boomSpark{
    0%{ transform:translate(-50%,-50%) scale(.6); opacity:1; }
    100%{ transform:translate(var(--sx), var(--sy)) scale(.2); opacity:0; }
  }

  .boom-heat{
    position:absolute; inset:0; border-radius:50%;
    background: radial-gradient(closest-side, rgba(255,255,255,.35), rgba(255,255,255,0));
    mix-blend-mode: screen; animation: boomHeat .4s ease-out forwards;
  }
  @keyframes boomHeat{
    0%{ transform:scale(.6); opacity:.8; }
    100%{ transform:scale(1.6); opacity:0; }
  }

  /* 크리티컬 강조 */
  .boomfx.crit{ --boom-size:140px; --boom-hue:48; }   /* gold 계열 */
  `;
  const s = document.createElement('style');
  s.id = 'impactfx-css';
  s.textContent = css;
  document.head.appendChild(s);
}

/* (호환) 이모지 FX — 필요 시 여전히 사용 가능 */
export function spawnEmojiAt(map, lat, lon, emoji="💥") {
  const html = `<div class="emojifx">${emoji}</div>`;
  const icon = L.divIcon({
    className: '',
    html,
    iconSize: [48, 48],
    iconAnchor: [24, 24]
  });
  const fx = L.marker([lat, lon], { icon, interactive:false, zIndexOffset:20000 }).addTo(map);
  setTimeout(()=>{ try{ map.removeLayer(fx); }catch{} }, 800);
}

/* 적에게 꽂히는 기본 임팩트 FX (화이트 스파클) */
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

/* 새 폭발 이펙트 (user → monster) */
export function spawnExplosionAt(map, lat, lon, { size=120, hue=20, crit=false } = {}){
  const angles = [0,30,60,90,120,150,180,210,240,270,300,330];
  const radius = size * 0.16;
  const rays = angles.map(a=>{
    const rad = a*Math.PI/180;
    const dx = (Math.cos(rad)*radius).toFixed(1) + 'px';
    const dy = (Math.sin(rad)*radius).toFixed(1) + 'px';
    return `<i style="--deg:${a}deg; --dx:${dx}; --dy:${dy};"></i>`;
  }).join('');

  // 작은 스파크(파편) 랜덤
  let sparks = '';
  for (let i=0;i<10;i++){
    const sx = (Math.random()*80 - 40).toFixed(0) + 'px';
    const sy = (Math.random()*80 - 40).toFixed(0) + 'px';
    sparks += `<em style="--sx:${sx}; --sy:${sy};"></em>`;
  }

  const cls = crit ? 'boomfx crit' : 'boomfx';
  const html = `
    <div class="${cls}" style="--boom-size:${size}px; --boom-hue:${hue}">
      <div class="boom-heat"></div>
      <div class="boom-core"></div>
      <div class="boom-ring"></div>
      <div class="boom-rays">${rays}</div>
      <div class="boom-sparks">${sparks}</div>
    </div>
  `;
  const icon = L.divIcon({ className:'', html, iconSize:[size,size], iconAnchor:[size/2,size/2] });
  const fx = L.marker([lat, lon], { icon, interactive:false, zIndexOffset:20000 }).addTo(map);
  setTimeout(()=>{ try{ map.removeLayer(fx); }catch{} }, crit ? 700 : 520);
}

/* 아주 약한 화면 흔들림 */
export function shakeMap(containerId = 'map') {
  const c = document.getElementById(containerId); if (!c) return;
  c.classList.remove('shake-map'); void c.offsetWidth; c.classList.add('shake-map');
  setTimeout(()=>c.classList.remove('shake-map'), 140);
}

/* 몬스터 HP 바 부착 */
export function attachHPBar(marker, maxHits){
  const root = marker.getElement();
  if (!root) return { set:()=>{} };
  const wrap = root.querySelector('.mon-wrap');
  if (!wrap) return { set:()=>{} };

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


/* ===== Sprite Animation (Treasure 등) ===== */
function ensureSpriteCSS(){
  if (document.getElementById('spritefx-css')) return;
  const css = `
  .sprite-anim{
    position:absolute; left:50%; top:50%;
    transform: translate(-50%, -50%);
    image-rendering: pixelated; /* 레트로 시트일 때 계단현상 자연스럽게 */
    pointer-events:none;
    will-change: background-position;
  }
  .sprite-anim.wrap{
    position:relative; left:0; top:0; transform:none;
  }`;
  const s = document.createElement('style');
  s.id = 'spritefx-css';
  s.textContent = css;
  document.head.appendChild(s);
}
function preloadImage(url){
  return new Promise((res, rej)=>{
    const img = new Image();
    img.onload = ()=>res(img);
    img.onerror = rej;
    img.src = url;
  });
}

function createSpriteElem({ url, frameW, frameH, scale=1 }){
  const el = document.createElement('div');
  el.className = 'sprite-anim';
  el.style.width = `${Math.round(frameW*scale)}px`;
  el.style.height = `${Math.round(frameH*scale)}px`;
  el.style.backgroundImage = `url("${url}")`;
  el.style.backgroundRepeat = 'no-repeat';
  el.style.backgroundPosition = '0px 0px';
  return el;
}

/**
 * 지도 위 좌표에 스프라이트 시트 애니메이션을 한 번/반복 재생합니다.
 * - anim: { url, frameW, frameH, frames, once=true|false, fps=8 }
 * - opts: { zIndexOffset=18000, scale=1, anchorCenter=true }
 * 반환: { stop() }
 */
export async function playSpriteOnMap(map, lat, lon, anim, opts = {}){
  ensureSpriteCSS();
  const {
    url, frameW, frameH, frames,
    once = true, fps = 8
  } = anim || {};
  const { zIndexOffset=18000, scale=1, anchorCenter=true } = opts;

  if (!url || !frameW || !frameH || !frames){
    console.warn('[sprite] invalid anim payload', anim);
    return { stop:()=>{} };
  }
  try{ await preloadImage(url); }catch(e){ console.warn('[sprite] preload fail', e); }

  const el = createSpriteElem({ url, frameW, frameH, scale });
  const icon = L.divIcon({
    className:'',
    html: el,
    iconSize: [frameW*scale, frameH*scale],
    iconAnchor: anchorCenter ? [frameW*scale/2, frameH*scale/2] : [0,0]
  });
  const mk = L.marker([lat, lon], { icon, interactive:false, zIndexOffset }).addTo(map);

  let frame = 0;
  let stopped = false;
  const period = 1000/Math.max(1,fps);

  const tick = ()=>{
    if (stopped) return;
    const x = -(frame*frameW*scale);
    el.style.backgroundPosition = `${x}px 0px`;
    frame++;
    if (frame >= frames){
      if (once){
        stop();
        try{ map.removeLayer(mk); }catch{}
        return;
      }
      frame = 0;
    }
    timer = setTimeout(tick, period);
  };

  let timer = setTimeout(tick, period);

  function stop(){
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try{ map.removeLayer(mk); }catch{}
  }
  return { stop };
}

/**
 * 이미 존재하는 Leaflet 마커의 DOM(.mon-wrap)에 애니메이션 노드를 붙여 재생
 * - marker: L.Marker (getElement()로 루트 DOM 접근)
 * - anim: { url, frameW, frameH, frames, once=true|false, fps=8 }
 * - opts: { scale=1, classNameExtra='' }
 * 반환: { stop(), element }
 */
export async function attachSpriteToMarker(marker, anim, opts = {}){
  ensureSpriteCSS();
  const root = marker?.getElement();
  if (!root) return { stop:()=>{}, element:null };

  const wrap = root.querySelector('.mon-wrap') || root; // .mon-wrap 없으면 루트에
  const {
    url, frameW, frameH, frames,
    once = true, fps = 8
  } = anim || {};
  const { scale=1, classNameExtra='' } = opts;

  if (!url || !frameW || !frameH || !frames){
    console.warn('[sprite] invalid anim for marker', anim);
    return { stop:()=>{}, element:null };
  }
  try{ await preloadImage(url); }catch(e){ console.warn('[sprite] preload fail', e); }

  const el = createSpriteElem({ url, frameW, frameH, scale });
  el.classList.add('wrap');
  if (classNameExtra) el.classList.add(classNameExtra);
  wrap.appendChild(el);

  let frame = 0;
  let stopped = false;
  const period = 1000/Math.max(1,fps);

  const tick = ()=>{
    if (stopped) return;
    const x = -(frame*frameW*scale);
    el.style.backgroundPosition = `${x}px 0px`;
    frame++;
    if (frame >= frames){
      if (once){
        stop();
        return;
      }
      frame = 0;
    }
    timer = setTimeout(tick, period);
  };

  let timer = setTimeout(tick, period);

  function stop(){
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try{ el.remove(); }catch{}
  }
  return { stop, element: el };
}

// fx.js (하단에 추가)
// 4프레임 스프라이트(가로 4컷) 1회 재생용

let _aniCSSInjected = false;
export function ensureMonsterAniCSS(){
  if (_aniCSSInjected) return;
  _aniCSSInjected = true;
  const css = `
  .ani-sheet{
    position:absolute; left:50%; top:50%;
    width:200px; height:200px; pointer-events:none;
    transform: translate(-50%, -50%) scale(var(--ani-scale, 1));
    background-repeat:no-repeat; background-position:0 0;
    background-size:800px 200px; /* 200x200 x 4프레임 = 800x200 */
    animation: ani4 var(--ani-dur, 420ms) steps(4) 1 both;
    image-rendering: -webkit-optimize-contrast;
    image-rendering: crisp-edges;
  }
  @keyframes ani4 {
    from { background-position-x:    0px; }
    to   { background-position-x: -600px; } /* 200px * (4-1) */
  }
  .ani-wrap{ position:relative; width:0; height:0; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

/**
 * 플레이어(또는 지정 위치)에 mid 스프라이트 1회 재생
 * @param {L.Map} map
 * @param {[number, number]} latlng  [lat, lng]
 * @param {string|number} mid        예: 12 → /images/ani/12.png
 * @param {{durationMs?:number, scale?:number, basePath?:string}} [opt]
 */
export function playMonsterHitSprite(map, latlng, mid, opt={}){
  ensureMonsterAniCSS();
  const { durationMs=420, scale=1, basePath='/images/ani/' } = opt;
  const url = `${basePath}${mid}.png`; // 윈도우 경로 표기는 웹에선 '/' 사용
  const html =
    `<div class="ani-wrap">
       <div class="ani-sheet" style="--ani-dur:${durationMs}ms;--ani-scale:${scale};background-image:url('${url}')"></div>
     </div>`;
  const icon = L.divIcon({
    className: 'ani-marker',
    html,
    iconSize: [0,0],
    iconAnchor: [0,0]
  });
  const mk = L.marker(L.latLng(latlng[0], latlng[1]), { icon, interactive:false });
  mk.addTo(map);

  // 애니 끝나면 제거
  setTimeout(() => {
    try { map.removeLayer(mk); } catch {}
  }, durationMs + 50);
}
