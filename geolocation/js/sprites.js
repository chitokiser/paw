// js/sprites.js
/* 스프라이트 CSS 1회 주입 */
(function injectSpriteCSS(){
  const css = `
  .sprite{position:relative;width:var(--fw,80px);height:var(--fh,80px);background-image:var(--img);background-repeat:no-repeat;background-position:0 0;image-rendering:pixelated;will-change:transform,background-position;transform-origin:50% 50%}
  .sprite.mon-bob{animation:bob 2.2s ease-in-out infinite}
  .sprite.mon-chase{filter:drop-shadow(0 0 6px rgba(255,80,80,.65))}
  .sprite.play{animation-timing-function:steps(var(--frames));animation-iteration-count:infinite;animation-name:var(--anim-name);animation-duration:var(--dur,800ms)}
  .sprite.play-once{animation-timing-function:steps(var(--frames));animation-iteration-count:1;animation-fill-mode:forwards;animation-name:var(--anim-name);animation-duration:var(--dur,600ms)}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
})();

/* X축 프레임 애니메이션 키프레임 생성 */
export function registerSpriteAnim(frameWidth, frames) {
  const animName = `spr_${frameWidth}x${frames}_${Math.random().toString(36).slice(2)}`;
  const totalX = -(frameWidth * frames);
  const css = `@keyframes ${animName}{from{background-position:0 0}to{background-position:${totalX}px 0}}`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  return animName;
}

export function createMonsterSpriteDOM(cfg) {
  const el = document.createElement('div');
  el.className = 'sprite mon-bob';
  el.style.setProperty('--fw', `${cfg.frameW}px`);
  el.style.setProperty('--fh', `${cfg.frameH}px`);
  const walkAnim = registerSpriteAnim(cfg.frameW, cfg.walkFrames);
  const atkAnim  = registerSpriteAnim(cfg.frameW, cfg.atkFrames);
  el._sprite = {
    cfg, walkAnim, atkAnim, state:'walk',
    rotOffset:(cfg.rotOffset||0),
    walkOffsetY: Number(cfg.walkOffsetY ?? 0),
    atkOffsetY:  Number(cfg.atkOffsetY  ?? cfg.frameH)
  };
  setMonsterSpriteState(el, 'walk');
  return el;
}

export function setMonsterSpriteState(el, next) {
  if (!el || !el._sprite) return;
  const s = el._sprite;
  if (s.state === next) return;

  if (next === 'walk') {
    el.classList.remove('play-once');
    el.classList.add('play');
    el.style.setProperty('--img', `url(${s.cfg.walkImg})`);
    el.style.setProperty('--frames', s.cfg.walkFrames);
    el.style.setProperty('--anim-name', s.walkAnim);
    el.style.setProperty('--dur', `${Math.round(1000 * (s.cfg.walkFrames / s.cfg.walkFps))}ms`);
    el.style.backgroundPositionY = `-${s.walkOffsetY}px`;
    el.style.backgroundPositionX = `0px`;
  } else if (next === 'attack') {
    el.classList.remove('play');
    el.classList.add('play-once');
    el.style.setProperty('--img', `url(${s.cfg.atkImg})`);
    el.style.setProperty('--frames', s.cfg.atkFrames);
    el.style.setProperty('--anim-name', s.atkAnim);
    el.style.setProperty('--dur', `${Math.round(1000 * (s.cfg.atkFrames / s.cfg.atkFps))}ms`);
    el.style.backgroundPositionY = `-${s.atkOffsetY}px`;
    el.style.backgroundPositionX = `0px`;
    const onEnd = () => { el.removeEventListener('animationend', onEnd); setMonsterSpriteState(el, 'walk'); };
    el.addEventListener('animationend', onEnd, { once:true });
  }
  s.state = next;
}

export function rotateSprite(el, bearingDeg) {
  if (!el || !el._sprite) return;
  const deg = bearingDeg + (el._sprite.rotOffset || 0);
  el.style.transform = `rotate(${deg}deg)`;
}
export function updateSpriteFacingFromMove(el, prevLat, prevLon, nextLat, nextLon) {
  if (!el) return;
  const dy = nextLat - prevLat, dx = nextLon - prevLon;
  if (dx === 0 && dy === 0) return;
  const rad = Math.atan2(dy, dx);
  const deg = rad * 180 / Math.PI; // 0=동쪽
  rotateSprite(el, deg);
}
