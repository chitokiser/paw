// /geolocation/js/playerFx.js
import { swordWhoosh } from './audio.js';

/* ===================== Sprite(스프라이트) 준비 ===================== */
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

let SPRITE_URL_RESOLVED = null;
let SPRITE_PRELOAD_DONE = false;

// ✅ 실제 배포 경로를 최우선
const SPRITE_CANDIDATES = [
  '/images/user/act800x257.png',
  safeUrl('../images/user/act800x257.png'),
  '/geolocation/images/user/act800x257.png',
  '../images/user/act800x257.png'
];

// RAF 유틸 & 마커 DOM 준비 대기
function raf(){ return new Promise(r=>requestAnimationFrame(r)); }
async function ensureMarkerEl(playerMarker, tries=15){
  for (let i=0;i<tries;i++){
    const el = playerMarker?.getElement?.();
    if (el) return el;
    await raf();
  }
  return null;
}

// 래퍼 강제 생성(이펙트 부착 안정화)
function ensureWrap(root){
  let wrap = root.querySelector?.('.player-wrap');
  if (!wrap){
    wrap = document.createElement('div');
    wrap.className = 'player-wrap';
    while (root.firstChild) wrap.appendChild(root.firstChild);
    root.appendChild(wrap);
  }
  return wrap;
}

// 스프라이트 경로 해석(아이콘 옆 경로도 고려하려면 확장 가능)
async function resolveSpriteUrl(){
  // 모듈 프리로드에서 성공한 값이 있으면 우선 사용
  if (SPRITE_URL_RESOLVED && await imgOk(SPRITE_URL_RESOLVED)) return SPRITE_URL_RESOLVED;
  // 후보 순회
  for (const u of SPRITE_CANDIDATES){
    if (await imgOk(u)) { SPRITE_URL_RESOLVED = u; return u; }
  }
  return null;
}

// 미리 로드(논블로킹 워밍업)
function preloadSpriteOnce(){
  if (SPRITE_PRELOAD_DONE) return;
  SPRITE_PRELOAD_DONE = true;
  (async()=>{
    for (const u of SPRITE_CANDIDATES){
      if (await imgOk(u)){ SPRITE_URL_RESOLVED=u; return; }
    }
    SPRITE_URL_RESOLVED = null; // 전부 실패
  })();
}

/* 시트 스펙 */
const SHEET_W=800, SHEET_H=257, FRAMES=4; // 4컷(200x257)
const FRAME_W=SHEET_W/FRAMES, FRAME_H=SHEET_H;
const DURATION_MS=600;

let cssInjected=false;
function injectCSS(){
  if (cssInjected) return; cssInjected=true;
  const css = `
  .leaflet-marker-icon{ overflow: visible !important; }
  .player-wrap{ position: relative; }

  /* 🔴 붉은 칼바람: 캐릭터 테두리에서 시작하도록 안쪽 반지름을 변수로 제어 */
  .player-wrap .slash{
    position:absolute; left:50%; top:50%;
    transform: translate(-50%,-50%) rotate(var(--angle,0deg));
    width: var(--slashSize, 160px); height: var(--slashSize, 160px);
    pointer-events:none; opacity:0;

    /* 붉은 웨지 (가시성 높임) */
    background: conic-gradient(
      from 0deg,
      rgba(244, 63, 94, 0)   0deg,
      rgba(244, 63, 94, .98) 42deg,
      rgba(244, 63, 94, 0)   92deg
    );

    /* 안쪽을 뚫어 "아이콘 테두리"에서 시작 */
    -webkit-mask: radial-gradient(circle at 50% 50%,
                  rgba(0,0,0,0) var(--innerR, 24px),
                  rgba(0,0,0,1) calc(var(--innerR, 24px) + 1px));
            mask: radial-gradient(circle at 50% 50%,
                  rgba(0,0,0,0) var(--innerR, 24px),
                  rgba(0,0,0,1) calc(var(--innerR, 24px) + 1px));

    filter:
      drop-shadow(0 0 10px rgba(244,63,94,.55))
      drop-shadow(0 2px 10px rgba(0,0,0,.35));
    z-index:10000;
    will-change: transform, opacity;
  }
  .player-wrap .slash.on{ animation: pf_slash .24s ease-out 1 forwards; }
  @keyframes pf_slash{
    0%   { opacity:0; transform: translate(-50%,-50%) rotate(calc(var(--angle,0deg) - 16deg)) scale(.94); }
    25%  { opacity:1; }
    100% { opacity:0; transform: translate(-50%,-50%) rotate(calc(var(--angle,0deg) + 54deg)) scale(1.02); }
  }

  /* (옵션) 스프라이트 4컷 공격: 끝 위치를 변수로 둬서 스케일 대응 */
  @keyframes pf_attack_once {
    from { background-position: 0px 0; }
    to   { background-position: var(--pf-endX, -600px) 0; }
  }
  .pf-attack-sprite{
    position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    background-repeat:no-repeat; image-rendering:pixelated; pointer-events:none;
    will-change: background-position; z-index:10001;
  }
  .pf-hide{ visibility:hidden; }

  /* 마스크 미지원 폴백(선택) */
  @supports not (mask: radial-gradient(black, transparent)) {
    .player-wrap .slash{
      -webkit-mask:none; mask:none;
      background: rgba(244,63,94,.9);
      clip-path: polygon(50% 50%, 100% 38%, 100% 62%);
    }
  }
  `;
  const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s);
  preloadSpriteOnce();
}

/* 유틸: slash 보장 & 아이콘 크기 */
function ensureSlashEl(playerMarker){
  const root=playerMarker?.getElement(); if(!root) return null;
  const wrap=ensureWrap(root);
  let slash=wrap.querySelector('.slash');
  if(!slash){ slash=document.createElement('div'); slash.className='slash'; wrap.appendChild(slash); }
  return slash;
}
function getPlayerIconSize(playerMarker){
  const root=playerMarker?.getElement(); if(!root) return [48,48];
  const img=root.querySelector('.player-img');
  if (img) return [img.offsetWidth||48, img.offsetHeight||48];
  const r=root.getBoundingClientRect(); return [r.width||48, r.height||48];
}

/* ✅ 붉은 칼바람: 시작 경계 = 유저 아이콘 테두리 */
export async function swingSwordAt(map, playerMarker, targetLat, targetLon, withSound=true){
  injectCSS();
  const el = await ensureMarkerEl(playerMarker);
  if (!el) return; // DOM 타이밍 가드

  const slash=ensureSlashEl(playerMarker); if(!slash) return;

  // 이전 애니가 남아 있어도 항상 리셋되도록
  slash.classList.remove('on'); slash.style.animation='none'; void slash.offsetWidth; slash.style.animation='';

  // 타겟 각도 (Leaflet 레이어 좌표 기준)
  const p1=map.latLngToLayerPoint(playerMarker.getLatLng());
  const p2=map.latLngToLayerPoint(L.latLng(targetLat, targetLon));
  const angleDeg = Math.atan2(p2.y-p1.y, p2.x-p1.x)*180/Math.PI;

  // 아이콘 실제 픽셀 크기 → 반지름(원 경계와 싱크)
  const [iconW, iconH]=getPlayerIconSize(playerMarker);
  const radius = Math.min(iconW, iconH) / 2;     // 테두리 안쪽에 붙임
  const thickness = Math.max(10, Math.round(Math.max(iconW, iconH)*0.28)); // 고리 두께
  const slashSize = radius*2 + thickness*2;

  // 변수 세팅
  slash.style.setProperty('--innerR', `${radius}px`);
  slash.style.setProperty('--slashSize', `${slashSize}px`);
  slash.style.setProperty('--angle', `${angleDeg}deg`);

  // 트리거
  slash.classList.remove('on'); void slash.offsetWidth; // reflow
  slash.classList.add('on');

  if (withSound){ try{ swordWhoosh(); }catch{} }
}

/* (옵션) 4컷 스프라이트: 아이콘 크기로 스케일 — 레이스/잔여물 방지 */
export async function playPlayerAttackOnce(playerMarker, opts = {}) {
  injectCSS();
  const el = await ensureMarkerEl(playerMarker);
  if (!el) return;

  const [iconW, iconH] = getPlayerIconSize(playerMarker);
  const scaleX = iconW / 200, scaleY = iconH / 257; // 200x257 프레임 기준
  const scaledSheetW = SHEET_W * scaleX, scaledSheetH = SHEET_H * scaleY;
  const lastOffsetX = -(SHEET_W - FRAME_W) * scaleX; // -600 * scaleX

  const { durationMs = DURATION_MS, frames = FRAMES } = opts;

  const root = playerMarker.getElement();
  const wrap = ensureWrap(root);
  const img  = root.querySelector('.player-img');

  // 잔여 스프라이트/상태 정리
  wrap.querySelectorAll('.pf-attack-sprite').forEach(n=>n.remove());
  img?.classList?.remove('pf-hide');

  if (img) img.classList.add('pf-hide');

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

  const startAnim = () => {
    sp.style.animation='none'; void sp.offsetWidth;
    sp.style.animation = `pf_attack_once ${durationMs}ms steps(${frames}) 1 forwards`;
  };

  // 스프라이트 URL 확보/디코드 후 시작
  let url = await resolveSpriteUrl();
  if (!url){
    console.warn('[playerFx] sprite not found in candidates:', SPRITE_CANDIDATES);
    sp.remove(); img?.classList?.remove('pf-hide'); return;
  }
  await imgOk(url);
  sp.style.backgroundImage = `url("${url}")`;
  requestAnimationFrame(startAnim);

  // 종료 시 정리 + 폴백(혹시 animationend 누락)
  const safeUnhide = () => { try{ img?.classList?.remove('pf-hide'); }catch{}; };
  const tid = setTimeout(safeUnhide, durationMs + 240);
  sp.addEventListener('animationend', () => {
    clearTimeout(tid);
    sp.remove();
    safeUnhide();
  }, { once: true });
}

/* 두 효과 동시 실행 */
export async function attackOnceToward(map, playerMarker, targetLat, targetLon){
  await swingSwordAt(map, playerMarker, targetLat, targetLon, true);
  await playPlayerAttackOnce(playerMarker);
}

// 모듈 임포트 즉시 프리로드(캐시 워밍업)
preloadSpriteOnce();
