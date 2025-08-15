// /geolocation/js/playerFx.js
// 플레이어 공격 연출 통합본: 칼바람(.slash) + 스프라이트 1회 모션
// 사용법:
//  - swingSwordAt(map, playerMarker, lat, lon)          // 칼바람 + 소리
//  - playPlayerAttackOnce(playerMarker[, opts])          // 스프라이트 모션 1회
//  - attackOnceToward(map, playerMarker, lat, lon)       // 둘 다 한번에
// 주의: playerMarker는 utils.makePlayerDivIcon()으로 만든 divIcon을 사용해야 .slash 요소가 존재합니다.

import { swordWhoosh } from './audio.js';

// === 스프라이트 시트 경로를 모듈 기준으로 절대 경로로 계산 ===
const SPRITE_URL = new URL('../images/user/act800x257.png', import.meta.url).toString();
const FRAME_W     = 200;  // 800 / 4
const FRAME_H     = 257;
const FRAMES      = 4;
const DURATION_MS = 600;

let cssInjected = false;
const DEBUG = true;
function injectCSS(){
  if (cssInjected) return;
    const css = `
  .player-wrap .slash{
    position:absolute; left:50%; top:50%;
    width:160px; height:160px; transform:translate(-50%,-50%) rotate(var(--angle,0deg));
    opacity:0; pointer-events:none;
    background: conic-gradient(from 0deg, rgba(255,255,255,.00) 0deg, rgba(255,255,255,.7) 40deg, rgba(255,255,255,.0) 85deg);
    -webkit-mask: radial-gradient(circle at 60% 50%, #000 45%, transparent 62%);
            mask: radial-gradient(circle at 60% 50%, #000 45%, transparent 62%);
    filter: drop-shadow(0 0 6px rgba(255,255,255,.45));
    border-radius:50%;
    z-index: 10000;               /* ← 위로 띄우기 */
  }
  .player-wrap .slash.on{ animation: pf_slash .25s ease-out 1 forwards; }
  @keyframes pf_slash{
    0%   { opacity:.0; transform: translate(-50%,-50%) rotate(var(--angle,0deg)) scale(.7); }
    25%  { opacity:1; }
    100% { opacity:0; transform: translate(-50%,-50%) rotate(calc(var(--angle,0deg) + 55deg)) scale(1.05); }
  }

  /* 스프라이트 1회 공격 */
  @keyframes pf_attack_once {
    from { background-position:    0px 0; }
    to   { background-position: -${FRAME_W*FRAMES}px 0; }
  }
  .pf-attack-sprite{
    position:absolute; left:50%; top:50%;
    width:${FRAME_W}px; height:${FRAME_H}px;
    transform:translate(-50%,-50%);
    background-image:url("${SPRITE_URL}");
    background-repeat:no-repeat;
    background-size:${FRAME_W*FRAMES}px ${FRAME_H}px;
    image-rendering:pixelated;
    pointer-events:none;
    z-index: 10001;               /* ← slash보다 위 */
  }
  .pf-hide{ visibility:hidden; }
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
  cssInjected = true;
}

/** 내부 유틸: .slash 엘리먼트 보장 */
function ensureSlashEl(playerMarker){
  const root = playerMarker?.getElement();
  if (!root) return null;
  const wrap = root.querySelector('.player-wrap') || root;
  let slash = wrap.querySelector('.slash');
  if (!slash){
    slash = document.createElement('div');
    slash.className = 'slash';
    wrap.appendChild(slash);
  }
  return slash;
}

/**
 * 플레이어 칼질(칼바람) 연출 + (선택)소리
 */
export function swingSwordAt(map, playerMarker, targetLat, targetLon, withSound = true){
  injectCSS();
  const el = playerMarker?.getElement();
  if (!el) return;
  const slash = el.querySelector('.slash');
  if (!slash) return;

  const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
  const p2 = map.latLngToLayerPoint(L.latLng(targetLat, targetLon));
  const angleDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;

  slash.style.setProperty('--angle', `${angleDeg - 90}deg`);
  slash.classList.remove('on'); void slash.offsetWidth;
  slash.classList.add('on');

  if (withSound) { try { swordWhoosh(); } catch {} }
  if (DEBUG) console.log('[playerFx] slash on', { angle: angleDeg });
}

/**
 * 스프라이트 시트를 사용한 1회 공격 모션
 * (원래 플레이어 이미지(.player-img)는 잠깐 숨기고, 애니 끝나면 자동 복원)
 */
export function playPlayerAttackOnce(playerMarker, opts = {}){
  injectCSS();
  const {
    durationMs = DURATION_MS,
    frames = FRAMES,
    frameW = FRAME_W,
    frameH = FRAME_H,
    spriteUrl = SPRITE_URL,
  } = opts;

  const root = playerMarker?.getElement();
  if (!root) return;
  const wrap = root.querySelector('.player-wrap') || root;
  const img  = root.querySelector('.player-img');

  if (img) img.classList.add('pf-hide');

  const sp = document.createElement('div');
  sp.className = 'pf-attack-sprite';
  sp.style.width = frameW + 'px';
  sp.style.height = frameH + 'px';
  sp.style.backgroundImage = `url("${spriteUrl}")`;
  sp.style.backgroundSize = `${frameW*frames}px ${frameH}px`;
  sp.style.animation = `pf_attack_once ${durationMs}ms steps(${frames}) 1 forwards`;

  wrap.appendChild(sp);
  if (DEBUG) console.log('[playerFx] sprite create', sp);

  sp.addEventListener('animationend', ()=>{
    if (DEBUG) console.log('[playerFx] sprite end/remove');
    sp.remove();
    if (img) img.classList.remove('pf-hide');
  }, { once:true });
}

export function attackOnceToward(map, playerMarker, targetLat, targetLon){
  swingSwordAt(map, playerMarker, targetLat, targetLon, true);
  playPlayerAttackOnce(playerMarker);
}