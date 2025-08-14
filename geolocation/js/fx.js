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
  }`;
  const s = document.createElement('style');
  s.id = 'impactfx-css';
  s.textContent = css;
  document.head.appendChild(s);
}

/* 적에게 꽂히는 임팩트 FX */
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
