// /geolocation/js/playerFx.js
 import * as Audio from './audio.js';
 const swordWhoosh = Audio.swordWhoosh || (()=>{ /* no-op fallback */ });

/* ===================== 공통 유틸 ===================== */
function safeUrl(rel){ try { return new URL(rel, import.meta.url).toString(); } catch { return rel; } }
function imgOk(src){
  return new Promise(r=>{
    const im=new Image();
    im.onload=()=>r(true);
    im.onerror=()=>r(false);
    im.decoding='async';
    im.src=src;
  });
}
function raf(){ return new Promise(r=>requestAnimationFrame(r)); }
async function ensureMarkerEl(playerMarker, tries=15){
  for (let i=0;i<tries;i++){
    const el = playerMarker?.getElement?.();
    if (el) return el;
    await raf();
  }
  return null;
}

/* ===================== 스프라이트 자원 ===================== */
let SPRITE_URL_RESOLVED = null;
let SPRITE_PRELOAD_DONE = false;
const SPRITE_CANDIDATES = [
  '/images/user/act800x257.png',
  safeUrl('../images/user/act800x257.png'),
  '/geolocation/images/user/act800x257.png',
  '../images/user/act800x257.png'
];

async function resolveSpriteUrl(){
  if (SPRITE_URL_RESOLVED && await imgOk(SPRITE_URL_RESOLVED)) return SPRITE_URL_RESOLVED;
  for (const u of SPRITE_CANDIDATES){
    if (await imgOk(u)) { SPRITE_URL_RESOLVED = u; return u; }
  }
  return null;
}
function preloadSpriteOnce(){
  if (SPRITE_PRELOAD_DONE) return; SPRITE_PRELOAD_DONE = true;
  (async()=>{
    for (const u of SPRITE_CANDIDATES){
      if (await imgOk(u)){ SPRITE_URL_RESOLVED=u; return; }
    }
    SPRITE_URL_RESOLVED = null;
  })();
}

/* ===================== 래퍼/DOM ===================== */
function ensureWrap(root){
  // 기존 래퍼가 여러 개면 병합
  let wrap = root.querySelector('.player-wrap');
  const wraps = root.querySelectorAll('.player-wrap');
  if (wraps.length > 1){
    wrap = wraps[0];
    for (let i=1; i<wraps.length; i++){
      const w = wraps[i];
      while (w.firstChild) wrap.appendChild(w.firstChild);
      w.remove();
    }
  }
  // 없으면 새로 생성
  if (!wrap){
    wrap = document.createElement('div');
    wrap.className = 'player-wrap';
    while (root.firstChild) wrap.appendChild(root.firstChild);
    root.appendChild(wrap);
  }
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  return wrap;
}
function getPlayerIconSize(playerMarker){
  const root=playerMarker?.getElement?.(); if(!root) return [48,48];
  const img=root.querySelector('.player-img');
  if (img) return [img.offsetWidth||48, img.offsetHeight||48];
  const r=root.getBoundingClientRect(); return [r.width||48, r.height||48];
}

/* ===================== 좌/우 반전 CSS & API ===================== */
export function ensurePlayerFacingCSS(){
  if (document.getElementById('pf-facing-css')) return;
  const css = `
  .player-wrap{ position:relative; }
  .player-wrap .player-img{ transform-origin:50% 50%; }
  /* 왼쪽 보기일 때만 반전 */
  .player-wrap.face-left .player-img{ transform: scaleX(-1); }
  .player-wrap.face-left > img{ transform: scaleX(-1); } /* .player-img 미사용 폴백 */
  .player-wrap.face-left .pf-attack-sprite{ transform: translate(-50%,-50%) scaleX(-1); }
  `;
  const s=document.createElement('style'); s.id='pf-facing-css'; s.textContent=css; document.head.appendChild(s);
}

export function setFacingByLatLng(map, playerMarker, targetLL, dir){
  try{
    const root = playerMarker?.getElement?.(); if (!root) return;
    const wrap = ensureWrap(root);
    ensurePlayerFacingCSS();

    let d = dir;
    if (!d && map && playerMarker?.getLatLng){
      const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
      const ll = (targetLL?.lat!=null) ? targetLL
              : Array.isArray(targetLL) ? L.latLng(targetLL[0], targetLL[1])
              : targetLL;
      const p2 = map.latLngToLayerPoint(ll);
      const dx = p2.x - p1.x;
      d = dx < -8 ? 'left' : (dx > 8 ? 'right' : null);
    }
    if (d === 'left') wrap.classList.add('face-left');
    else if (d === 'right') wrap.classList.remove('face-left');
  }catch{}
}

/* ===================== 이펙트용 CSS ===================== */
let cssInjected=false;
function injectCSS(){
  if (cssInjected) return; cssInjected=true;
  const css = `
  .leaflet-marker-icon{ overflow:visible !important; }
  .player-wrap{ position:relative; }

  /* 🔴 붉은 칼바람 이펙트 */
  .player-wrap .slash{
    position:absolute; left:50%; top:50%;
    transform: translate(-50%,-50%) rotate(var(--angle,0deg));
    width: var(--slashSize,160px); height: var(--slashSize,160px);
    pointer-events:none; opacity:0;
    background: conic-gradient(from 0deg,
      rgba(244,63,94,0) 0deg,
      rgba(244,63,94,.98) 42deg,
      rgba(244,63,94,0) 92deg);
    -webkit-mask: radial-gradient(circle at 50% 50%, rgba(0,0,0,0) var(--innerR,24px), rgba(0,0,0,1) calc(var(--innerR,24px) + 1px));
    mask: radial-gradient(circle at 50% 50%, rgba(0,0,0,0) var(--innerR,24px), rgba(0,0,0,1) calc(var(--innerR,24px) + 1px));
    filter: drop-shadow(0 0 10px rgba(244,63,94,.55)) drop-shadow(0 2px 10px rgba(0,0,0,.35));
    z-index:10000; will-change:transform,opacity;
  }
  .player-wrap .slash.on{ animation: pf_slash .24s ease-out 1 forwards; }
  @keyframes pf_slash{
    0%   { opacity:0; transform: translate(-50%,-50%) rotate(calc(var(--angle,0deg) - 16deg)) scale(.94); }
    25%  { opacity:1; }
    100% { opacity:0; transform: translate(-50%,-50%) rotate(calc(var(--angle,0deg) + 54deg)) scale(1.02); }
  }

  /* 4컷 공격 스프라이트 */
  @keyframes pf_attack_once { from { background-position: 0px 0; } to { background-position: var(--pf-endX,-600px) 0; } }
  .pf-attack-sprite{
    position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    background-repeat:no-repeat; image-rendering:pixelated; pointer-events:none;
    will-change: background-position; z-index:10001;
  }
  .pf-hide{ visibility:hidden; }

  @supports not (mask: radial-gradient(black,transparent)) {
    .player-wrap .slash{ -webkit-mask:none; mask:none; background:rgba(244,63,94,.9); clip-path: polygon(50% 50%, 100% 38%, 100% 62%); }
  }
  `;
  const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s);
  preloadSpriteOnce();
}

/* ===================== 칼바람(각도/반경 동기) ===================== */
function ensureSlashEl(playerMarker){
  const root=playerMarker?.getElement(); if(!root) return null;
  const wrap=ensureWrap(root);
  let slash=wrap.querySelector('.slash');
  if(!slash){ slash=document.createElement('div'); slash.className='slash'; wrap.appendChild(slash); }
  return slash;
}

export async function swingSwordAt(map, playerMarker, targetLat, targetLon, withSound=true){
  injectCSS();
  const el = await ensureMarkerEl(playerMarker);
  if (!el) return;
  const slash=ensureSlashEl(playerMarker); if(!slash) return;

  // 방향도 즉시 동기화
  try{ setFacingByLatLng(map, playerMarker, L.latLng(targetLat, targetLon)); }catch{}

  // 리셋
  slash.classList.remove('on'); slash.style.animation='none'; void slash.offsetWidth; slash.style.animation='';

  // 각도
  const p1=map.latLngToLayerPoint(playerMarker.getLatLng());
  const p2=map.latLngToLayerPoint(L.latLng(targetLat, targetLon));
  const angleDeg = Math.atan2(p2.y-p1.y, p2.x-p1.x)*180/Math.PI;

  // 반경/두께: 아이콘 크기 기준
  const [iconW, iconH]=getPlayerIconSize(playerMarker);
  const radius = Math.min(iconW, iconH) / 2;
  const thickness = Math.max(10, Math.round(Math.max(iconW, iconH)*0.28));
  const slashSize = radius*2 + thickness*2;

  slash.style.setProperty('--innerR', `${radius}px`);
  slash.style.setProperty('--slashSize', `${slashSize}px`);
  slash.style.setProperty('--angle', `${angleDeg}deg`);

  slash.classList.remove('on'); void slash.offsetWidth;
  slash.classList.add('on');

  if (withSound){ try{ swordWhoosh(); }catch{} }
}

/* ===================== 4컷 공격 스프라이트 ===================== */
const SHEET_W=800, SHEET_H=257, FRAMES=4; // 프레임 200x257
const FRAME_W=SHEET_W/FRAMES, FRAME_H=SHEET_H;
const DURATION_MS=600;

export async function playPlayerAttackOnce(playerMarker, opts = {}) {
  injectCSS();
  const el = await ensureMarkerEl(playerMarker);
  if (!el) return;

  const root = playerMarker.getElement();
  const wrap = ensureWrap(root);

  // 싱글턴: 기존 스프라이트 제거
  try { playerMarker._pfAttackEl?.remove(); } catch {}
  playerMarker._pfAttackEl = null;

  const [iconW, iconH] = getPlayerIconSize(playerMarker);
  const scaleX = iconW / 200, scaleY = iconH / 257;
  const scaledSheetW = SHEET_W * scaleX, scaledSheetH = SHEET_H * scaleY;
  const lastOffsetX = -(SHEET_W - FRAME_W) * scaleX;
  const { durationMs = DURATION_MS, frames = FRAMES } = opts;

  // 기본 이미지 숨기기
  const baseImg = wrap.querySelector('.player-img') || root.querySelector('img');
  baseImg?.classList?.add('pf-hide');

  // 새 스프라이트 생성
  const sp = document.createElement('div');
  sp.className = 'pf-attack-sprite';
  sp.style.width  = iconW + 'px';
  sp.style.height = iconH + 'px';
  sp.style.backgroundRepeat = 'no-repeat';
  sp.style.imageRendering   = 'pixelated';
  sp.style.willChange = 'background-position';
  sp.style.zIndex = 10001;
  sp.style.setProperty('--pf-endX', `${lastOffsetX}px`);
  sp.style.backgroundSize = `${scaledSheetW}px ${scaledSheetH}px`;
  wrap.appendChild(sp);
  playerMarker._pfAttackEl = sp;

  // 시트 로드 후 재생
  const url = await resolveSpriteUrl();
  if (!url){ sp.remove(); baseImg?.classList?.remove('pf-hide'); return; }
  await imgOk(url);
  sp.style.backgroundImage = `url("${url}")`;
  requestAnimationFrame(() => {
    sp.style.animation='none'; void sp.offsetWidth;
    sp.style.animation = `pf_attack_once ${durationMs}ms steps(${frames}) 1 forwards`;
  });

  // 정리
  const cleanup = () => {
    try { sp.remove(); } catch {}
    if (playerMarker._pfAttackEl === sp) playerMarker._pfAttackEl = null;
    baseImg?.classList?.remove('pf-hide');
  };
  const tid = setTimeout(cleanup, durationMs + 150);
  sp.addEventListener('animationend', () => { clearTimeout(tid); cleanup(); }, { once:true });
}

/* ===================== 합쳐 실행 ===================== */
export async function attackOnceToward(map, playerMarker, targetLat, targetLon){
  await swingSwordAt(map, playerMarker, targetLat, targetLon, true);
  await playPlayerAttackOnce(playerMarker);
}

/* 프리로드 */
preloadSpriteOnce();
