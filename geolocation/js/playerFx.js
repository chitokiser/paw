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
let SPRITE_URL_RESOLVED = null, SPRITE_PRELOAD_DONE = false;
const SPRITE_CANDIDATES = [
  safeUrl('../images/user/act800x257.png'),
  '/geolocation/images/user/act800x257.png',
  '/images/user/act800x257.png',
  '../images/user/act800x257.png'
];
function preloadSpriteOnce(){
  if (SPRITE_PRELOAD_DONE) return;
  SPRITE_PRELOAD_DONE = true;
  (async()=>{
    for (const u of SPRITE_CANDIDATES){
      if (await imgOk(u)){ SPRITE_URL_RESOLVED=u; return; }
    }
    SPRITE_URL_RESOLVED=SPRITE_CANDIDATES.at(-1);
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
      rgba(244, 63, 94, 0)   0deg,    /* #f43f5e */
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
  `;
  const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s);
  preloadSpriteOnce();
}

/* 유틸: slash 보장 & 아이콘 크기 */
function ensureSlashEl(playerMarker){
  const root=playerMarker?.getElement(); if(!root) return null;
  const wrap=root.querySelector('.player-wrap')||root;
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
export function swingSwordAt(map, playerMarker, targetLat, targetLon, withSound=true){
  injectCSS();
  const slash=ensureSlashEl(playerMarker); if(!slash) return;

  // 타겟 각도 (Leaflet 레이어 좌표 기준)
  const p1=map.latLngToLayerPoint(playerMarker.getLatLng());
  const p2=map.latLngToLayerPoint(L.latLng(targetLat, targetLon));
  const angleDeg = Math.atan2(p2.y-p1.y, p2.x-p1.x)*180/Math.PI;

  // 아이콘 실제 픽셀 크기 → 반지름(원 경계와 싱크)
  const [iconW, iconH]=getPlayerIconSize(playerMarker);
  const radius = Math.min(iconW, iconH) / 2;     // ⬅️ 테두리 "안쪽"에 딱 붙임
  const thickness = Math.max(10, Math.round(Math.max(iconW, iconH)*0.28)); // 고리 두께
  const slashSize = radius*2 + thickness*2;

  // 변수 세팅
  slash.style.setProperty('--innerR', `${radius}px`);
  slash.style.setProperty('--slashSize', `${slashSize}px`);
  // 🔁 웨지의 0deg가 "오른쪽(동쪽)"을 가리키므로, angleDeg 그대로 사용 (불필요한 -90 제거)
  slash.style.setProperty('--angle', `${angleDeg}deg`);

  // 트리거
  slash.classList.remove('on'); void slash.offsetWidth; // reflow
  slash.classList.add('on');

  if (withSound){ try{ swordWhoosh(); }catch{} }
}

/* (옵션) 4컷 스프라이트: 아이콘 크기로 스케일 */
export function playPlayerAttackOnce(playerMarker, opts={}){
  injectCSS();
  const [iconW, iconH]=getPlayerIconSize(playerMarker);
  const scaleX=iconW/200, scaleY=iconH/257;                 // 200x257 프레임 기준
  const scaledSheetW=SHEET_W*scaleX, scaledSheetH=SHEET_H*scaleY;   // 시트 전체 스케일
  const lastOffsetX=-(SHEET_W-FRAME_W)*scaleX;                      // -600 * scaleX

  const { durationMs=DURATION_MS, frames=FRAMES, spriteUrl=SPRITE_URL_RESOLVED||'' } = opts;

  const root=playerMarker?.getElement(); if(!root) return;
  const wrap=root.querySelector('.player-wrap')||root;
  const img= root.querySelector('.player-img');
  if (img) img.classList.add('pf-hide');

  const sp=document.createElement('div');
  sp.className='pf-attack-sprite';
  sp.style.width = iconW+'px'; sp.style.height = iconH+'px';
  sp.style.setProperty('--pf-endX', `${lastOffsetX}px`);
  sp.style.backgroundSize = `${scaledSheetW}px ${scaledSheetH}px`;
  if (spriteUrl) sp.style.backgroundImage = `url("${spriteUrl}")`;
  sp.style.animation = `pf_attack_once ${durationMs}ms steps(${frames}) 1 forwards`;
  wrap.appendChild(sp);

  if (!spriteUrl){
    (async()=>{ while(!SPRITE_URL_RESOLVED){ await new Promise(r=>setTimeout(r,50)); }
      sp.style.backgroundImage=`url("${SPRITE_URL_RESOLVED}")`;
    })();
  }
  sp.addEventListener('animationend', ()=>{ sp.remove(); if(img) img.classList.remove('pf-hide'); }, { once:true });
}

/* 두 효과 동시 실행 */
export function attackOnceToward(map, playerMarker, targetLat, targetLon){
  swingSwordAt(map, playerMarker, targetLat, targetLon, true);
  playPlayerAttackOnce(playerMarker);
}
