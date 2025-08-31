// /geolocation/js/audio.js
/* ============================================================
 * Audio Core (정리본)
 * - 합성 임팩트 + mp3 재생 혼용
 * - 번개/천둥 합성, 크리티컬 강화, 무기 휘두름 등
 * - MID 기반 히트/데스 mp3 지원
 * - 마제스틱볼 전용 SFX 지원 (/sounds/hit/maje.mp3)
 * - 캐싱/폴백/자동 resume 포함
 * ============================================================ */

let audioCtx;

/* ─────────── 공통 ─────────── */
export function ensureAudio(){
  audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch {} }
  return audioCtx;
}

export function createNoise(){
  const ac = ensureAudio();
  const sr = ac.sampleRate, len = sr * 0.5;
  const buf = ac.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i=0;i<len;i++) data[i] = Math.random()*2-1;
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = false;
  return src;
}

export function applyADSR(g, t, {a=0.01, d=0.12, s=0.4, r=0.25, peak=0.9, sus=0.25} = {}){
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t+a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, sus), t+a+d);
  g.gain.setTargetAtTime(0.0001, t+a+d, r);
}

export function blip(freq=300, dur=0.07, type='square', startGain=0.35){
  const ac = ensureAudio(), t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  o.connect(g); g.connect(ac.destination);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(startGain, t+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  o.start(t); o.stop(t + dur + 0.03);
}
export const playHit = ()=>blip();

/* ─────────── 강한 합성(크리티컬 레이어) ─────────── */
function _deathSynthStrong(){
  const ac = ensureAudio(), t = ac.currentTime;
  const freqs = [523.25, 659.25, 783.99];
  const groupGain = ac.createGain(); groupGain.connect(ac.destination);
  groupGain.gain.setValueAtTime(0.0001, t);
  groupGain.gain.exponentialRampToValueAtTime(0.9, t+0.02);
  groupGain.gain.exponentialRampToValueAtTime(0.0001, t+0.6);

  const lfo = ac.createOscillator(); const lfoGain = ac.createGain();
  lfo.frequency.setValueAtTime(6, t); lfoGain.gain.setValueAtTime(5, t); lfo.connect(lfoGain);

  freqs.forEach((f,i)=>{
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
    lfoGain.connect(o.frequency);
    o.connect(g); g.connect(groupGain);
    applyADSR(g, t + i*0.02, {a:0.01, d:0.12, s:0.5, r:0.25, peak:0.9, sus:0.2});
    o.start(t + i*0.02); o.stop(t + 0.6);
  });

  const nz = createNoise(); const bp = ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.setValueAtTime(3500, t); bp.Q.value = 3;
  const ng = ac.createGain(); ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.35, t+0.02);
  ng.gain.exponentialRampToValueAtTime(0.0001, t+0.25);
  nz.connect(bp); bp.connect(ng); ng.connect(ac.destination);
  nz.start(t); nz.stop(t+0.25);

  lfo.start(t); lfo.stop(t+0.6);
}

/* ─────────── 휘두름 ─────────── */
export function swordWhoosh(){
  const ac = ensureAudio(), t = ac.currentTime;
  const nz = createNoise();
  const bp = ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.setValueAtTime(900, t); bp.Q.value = 2;
  const g  = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
  nz.connect(bp); bp.connect(g); g.connect(ac.destination);
  g.gain.exponentialRampToValueAtTime(0.35, t+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.16);
  bp.frequency.linearRampToValueAtTime(2200, t+0.14);
  nz.start(t); nz.stop(t+0.18);
}

/* ─────────── 임팩트 합성 ─────────── */
function _impactCore(kind = 'player', { intensity = 1.0, includeWhoosh = false } = {}) {
  const ac = ensureAudio();
  const t  = ac.currentTime;

  const master = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-16, t);
  comp.knee.setValueAtTime(20, t);
  comp.ratio.setValueAtTime(6, t);
  comp.attack.setValueAtTime(0.002, t);
  comp.release.setValueAtTime(0.12, t);

  const gainBase = kind === 'player' ? 0.95 : 0.85;
  master.gain.setValueAtTime(Math.min(1, gainBase * intensity), t);
  master.connect(comp); comp.connect(ac.destination);

  if (kind === 'player' && includeWhoosh) { try { swordWhoosh(); } catch {} }

  // crack
  const crack = createNoise();
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(kind==='player'? 2200 : 1600, t);
  const cg = ac.createGain();
  cg.gain.setValueAtTime(0.0001, t);
  cg.gain.exponentialRampToValueAtTime((kind==='player'? 0.7 : 0.45) * intensity, t + 0.008);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + (kind==='player'? 0.06 : 0.08));
  crack.connect(hp); hp.connect(cg); cg.connect(master);
  crack.start(t); crack.stop(t + (kind==='player'? 0.08 : 0.1));

  // metallic harmonics
  const pannerOk = typeof ac.createStereoPanner === 'function';
  const pan = pannerOk ? ac.createStereoPanner() : null;
  if (pan) pan.pan.setValueAtTime(kind==='player'? 0.18 : -0.05, t);
  const dest = pan ? pan : master;
  if (pan) pan.connect(master);

  const partials = (kind==='player') ? [920, 1270, 1820] : [320, 560, 820];
  partials.forEach((f, i) => {
    const o = ac.createOscillator(); o.type = (kind==='player' ? 'triangle' : 'sawtooth');
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (kind==='player'? 0.92 : 0.88), t + (kind==='player'? 0.10 : 0.14));
    g.gain.exponentialRampToValueAtTime((kind==='player'? (0.45 - i*0.12) : (0.55 - i*0.15)) * intensity, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind==='player'? 0.18 : 0.24) + i*0.02);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + (kind==='player'? 0.22 : 0.28) + i*0.02);
  });

  // low thump
  const thump = ac.createOscillator(); thump.type = 'sine';
  thump.frequency.setValueAtTime(kind==='player'? 110 : 75, t);
  thump.frequency.linearRampToValueAtTime(kind==='player'? 70 : 55, t + (kind==='player'? 0.12 : 0.18));
  const thumpPan = pannerOk ? ac.createStereoPanner() : null;
  if (thumpPan) thumpPan.pan.setValueAtTime(kind==='player'? -0.12 : 0.0, t);
  const tg = ac.createGain();
  tg.gain.setValueAtTime(0.0001, t);
  tg.gain.exponentialRampToValueAtTime((kind==='player'? 0.9 : 1.1) * intensity, t + 0.012);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + (kind==='player'? 0.18 : 0.26));
  thump.connect(tg); tg.connect(thumpPan || master);
  if (thumpPan) thumpPan.connect(master);
  thump.start(t); thump.stop(t + (kind==='player'? 0.2 : 0.28));

  // sparkle (player only)
  if (kind==='player'){
    const sparkle = createNoise();
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(6000, t); bp.Q.value = 3;
    const sg = ac.createGain(); sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.25 * intensity, t + 0.005);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    sparkle.connect(bp); bp.connect(sg); sg.connect(master);
    sparkle.start(t); sparkle.stop(t + 0.06);
  }
}

export function playPlayerAttackImpact(opts = {}) { _impactCore('player', opts); }
export function playMonsterAttackImpact(opts = {}) { _impactCore('monster', opts); }

/* 크리티컬 (강화판) */
export function playCriticalImpact({ intensity = 1.0, includeWhoosh = true } = {}) {
  try { _deathSynthStrong(); } catch {}
  _impactCore('player', { intensity: Math.max(1, 1.2*intensity), includeWhoosh });
}

/* 하위 호환 */
export function playAttackImpact(opts = {}) {
  const { critical = false, ...rest } = opts || {};
  if (critical) return playCriticalImpact(rest);
  return playPlayerAttackImpact(rest);
}

/* ─────────── 번개/천둥 ─────────── */
export function playLightning(){
  try{
    const ac = ensureAudio();
    const dur = 0.6;
    const buffer = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i=0;i<data.length;i++){
      const white = Math.random()*2 - 1;
      lastOut = (lastOut + (0.02 * white)) / 1.02;
      data[i] = lastOut * 2.5;
    }
    const src = ac.createBufferSource(); src.buffer = buffer;
    const lp = ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 800;
    const gain = ac.createGain(); gain.gain.value = 0.9;
    src.connect(lp); lp.connect(gain); gain.connect(ac.destination);
    const now = ac.currentTime;
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.9, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.start();
  } catch {}
}

export function playThunderBoom({ intensity = 1.0 } = {}){
  const ac = ensureAudio();
  const t  = ac.currentTime;
  const master = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-24, t);
  comp.ratio.setValueAtTime(8, t);
  comp.attack.setValueAtTime(0.003, t);
  comp.release.setValueAtTime(0.25, t);
  master.gain.setValueAtTime(Math.min(1, 1.0 * intensity), t);
  master.connect(comp); comp.connect(ac.destination);

  const crack = createNoise();
  const hp = ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.setValueAtTime(2500, t);
  const cg = ac.createGain(); cg.gain.setValueAtTime(0.0001, t);
  cg.gain.exponentialRampToValueAtTime(0.9 * intensity, t+0.008);
  cg.gain.exponentialRampToValueAtTime(0.0001, t+0.06);
  crack.connect(hp); hp.connect(cg); cg.connect(master);
  crack.start(t); crack.stop(t+0.07);

  const boom = ac.createOscillator(); boom.type='sine';
  boom.frequency.setValueAtTime(65, t);
  boom.frequency.exponentialRampToValueAtTime(45, t+0.9);
  const lpN = ac.createBiquadFilter(); lpN.type='lowpass'; lpN.frequency.setValueAtTime(500, t);
  const noise = createNoise(); noise.connect(lpN);

  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.8 * intensity, t+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t+1.2);
  boom.connect(g); lpN.connect(g); g.connect(master);
  boom.start(t); boom.stop(t+1.25);
  noise.start(t+0.02); noise.stop(t+1.0);
}

export function playLightningImpact({ intensity = 1.0, withBoom = true, delayMs = 110 } = {}) {
  try { ensureAudio(); } catch {}
  try { playLightning(); } catch {}
  if (withBoom) {
    try { setTimeout(() => { try { playThunderBoom({ intensity }); } catch {} }, Math.max(0, delayMs | 0)); } catch {}
  }
}

/* ─────────── MP3 헬퍼 + 캐시 ─────────── */
const _cache = new Map();
function _getCachedAudio(url){
  let a = _cache.get(url);
  if (!a) { a = new Audio(url); a.preload = 'auto'; _cache.set(url, a); }
  return a;
}
export function playMp3(url, { volume = 1.0 } = {}) {
  try { ensureAudio(); } catch {}
  try {
    const a = _getCachedAudio(url);
    a.volume = Math.max(0, Math.min(1, volume));
    a.currentTime = 0;
    a.play().catch(()=>{});
    return a;
  } catch { return null; }
}

/* ─────────── 효과음 (고정 MP3) ───────────
   ※ 배포 구조가 /sounds/... 인 경우에 맞춘 절대경로.
   경로가 다르면 setMajesticSfxUrl 처럼 직접 playMp3로 호출하세요.
----------------------------------------------------------------- */
const deathSound  = _getCachedAudio('/sounds/death.mp3');
const rewardSound = _getCachedAudio('/sounds/reward.mp3');
const critSound   = _getCachedAudio('/sounds/crit.mp3');

export function playDeath() { try { deathSound.currentTime = 0; deathSound.play(); } catch {} }
export function playReward(){ try { rewardSound.currentTime = 0; rewardSound.play(); } catch {} }
export function playCrit()   { try { critSound.currentTime = 0;   critSound.play();   } catch {} }

/* ─────────── MID 기반 사운드 ─────────── */
export function playMonsterHitForMid(mid, { volume = 0.95 } = {}) {
  if (mid == null) return;
  try {
    const url = `/sounds/hit/${encodeURIComponent(mid)}.mp3`;
    const a = _getCachedAudio(url);
    a.volume = Math.max(0, Math.min(1, volume));
    a.currentTime = 0;
    a.play().catch(() => {
      try {
        const f = _getCachedAudio('/sounds/hit/default.mp3');
        f.volume = a.volume;
        f.currentTime = 0;
        f.play().catch(()=>{});
      } catch {}
    });
  } catch (e) { console.warn('[audio] playMonsterHitForMid fail', e); }
}

export function playDeathForMid(mid, { volume = 0.9 } = {}){
  if (mid == null) return;
  try {
    const url = `/sounds/death/${encodeURIComponent(mid)}.mp3`;
    const a = _getCachedAudio(url);
    a.volume = Math.max(0, Math.min(1, volume));
    a.currentTime = 0;
    a.play().catch(()=>{});
  } catch(e){ console.warn('[audio] playDeathForMid fail', e); }
}

/* ─────────── 실패 효과 ─────────── */
export function playFail(){
  const ac = ensureAudio(), t = ac.currentTime;
  const o1 = ac.createOscillator(), o2 = ac.createOscillator();
  const g  = ac.createGain();
  const lp = ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(1200, t);
  o1.type='sawtooth'; o2.type='sawtooth';
  o1.frequency.setValueAtTime(320, t); o2.frequency.setValueAtTime(320*0.98, t);
  o1.frequency.exponentialRampToValueAtTime(70, t+0.7);
  o2.frequency.exponentialRampToValueAtTime(65, t+0.7);
  const nz = createNoise();
  nz.connect(lp); o1.connect(g); o2.connect(g); lp.connect(g); g.connect(ac.destination);
  applyADSR(g, t, {a:0.005, d:0.1, s:0.2, r:0.35, peak:0.9, sus:0.15});
  o1.start(t); o2.start(t); nz.start(t);
  o1.stop(t+0.75); o2.stop(t+0.75); nz.stop(t+0.5);
}

/* ─────────── 마제스틱볼 전용 SFX ─────────── */
let _majesticUrl = '/sounds/hit/maje.mp3'; // 배포 루트 기준. 필요 시 아래 setter로 변경 가능.
export function setMajesticSfxUrl(url){ if (url) _majesticUrl = url; }
/** 마제스틱볼 폭발 시 전용 효과음 */
export function playMajesticBallSfx({ volume = 1 } = {}) {
  try { ensureAudio?.(); } catch {}
  try {
    const a = _getCachedAudio(_majesticUrl);
    a.volume = Math.max(0, Math.min(1, volume));
    a.currentTime = 0;
    a.play().catch(()=>{ /* 모바일 정책 등으로 실패 시 무시 */ });
  } catch (e) {
    console.warn('[audio] majestic sfx fail', e);
  }
}

/* ─────────── 직접 호출용 헬퍼 ─────────── */
export const playRewardMP3 = (v=1)=> playMp3('/sounds/reward.mp3', { volume:v });
export const playDeathMP3  = (v=1)=> playMp3('/sounds/death.mp3',  { volume:v });
