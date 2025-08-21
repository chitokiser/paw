// /geolocation/js/audio.js

let audioCtx;

/* ───────────────── 기본 유틸 ───────────────── */
export function ensureAudio(){
  audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function createNoise(){
  const ac = ensureAudio();
  const sr = ac.sampleRate, len = sr * 0.5;
  const buf = ac.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i=0;i<len;i++) data[i] = Math.random()*2-1;
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = false; return src;
}

export function applyADSR(g, t, {a=0.01, d=0.12, s=0.4, r=0.25, peak=0.9, sus=0.25}={}){
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

/* ─────────────── 실패/사망 효과 ─────────────── */
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

export function playDeath(){
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

/* ─────────────── 휘두름(선택) ─────────────── */
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

/* ───────────────── 임팩트 코어 ─────────────────
   - player: 둔탁/묵직(저역+거친 노이즈)
   - monster: 날카로움(메탈+스파클) */
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

/* ────────────── 공개 API (정책 매핑) ────────────── */
export function playPlayerAttackImpact(opts = {}) { _impactCore('player', opts); }
export function playMonsterAttackImpact(opts = {}) { _impactCore('monster', opts); }

/* ──────── 크리티컬(강화판) ──────── */
export function playCriticalImpact({ intensity = 1.0, includeWhoosh = true } = {}) {
  const ac = ensureAudio();
  const t  = ac.currentTime;
  const CRIT_GAIN = 1.35 * intensity;

  const pre = ac.createGain(); pre.gain.setValueAtTime(Math.min(1.6, CRIT_GAIN), t);

  // soft clipper
  const shaper = ac.createWaveShaper();
  const curve = new Float32Array(44100);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.8 * x);
  }
  shaper.curve = curve; shaper.oversample = '4x';

  const comp = ac.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-12, t);
  comp.knee.setValueAtTime(18, t);
  comp.ratio.setValueAtTime(12, t);
  comp.attack.setValueAtTime(0.0012, t);
  comp.release.setValueAtTime(0.14, t);

  pre.connect(shaper); shaper.connect(comp); comp.connect(ac.destination);

  if (includeWhoosh) { try { swordWhoosh(); } catch {} }

  // high crack
  const crack = createNoise();
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(3100, t);
  const cg = ac.createGain(); cg.gain.setValueAtTime(0.0001, t);
  cg.gain.exponentialRampToValueAtTime(1.05 * CRIT_GAIN, t + 0.006);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);
  crack.connect(hp); hp.connect(cg); cg.connect(pre);
  crack.start(t); crack.stop(t + 0.1);

  // metallic stack (w/ tiny FM & detune)
  const lfo = ac.createOscillator(); const lfoG = ac.createGain();
  lfo.frequency.setValueAtTime(7, t); lfoG.gain.setValueAtTime(6, t); lfo.connect(lfoG);

  const pans = [ -0.2, 0.0, 0.2 ];
  [1500, 2000, 2600].forEach((f, i) => {
    const o = ac.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'square';
    o.frequency.setValueAtTime(f, t);
    o.detune.setValueAtTime(i === 1 ? +8 : (i === 2 ? -8 : 0), t);
    lfoG.connect(o.frequency);

    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((0.65 - i*0.12) * CRIT_GAIN, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16 + i*0.015);

    const p = typeof ac.createStereoPanner === 'function' ? ac.createStereoPanner() : null;
    if (p) p.pan.setValueAtTime(pans[i], t);

    o.connect(g); g.connect(p || pre); if (p) p.connect(pre);
    o.start(t); o.stop(t + 0.2 + i*0.02);
  });
  lfo.start(t); lfo.stop(t + 0.22);

  // sub thump
  const th = ac.createOscillator(); th.type = 'sine';
  th.frequency.setValueAtTime(105, t);
  th.frequency.linearRampToValueAtTime(60, t + 0.14);
  const thG = ac.createGain(); thG.gain.setValueAtTime(0.0001, t);
  thG.gain.exponentialRampToValueAtTime(1.25 * CRIT_GAIN, t + 0.012);
  thG.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  th.connect(thG); thG.connect(pre);
  th.start(t); th.stop(t + 0.26);

  // sparkle
  const sp = createNoise();
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(7600, t); bp.Q.value = 3.2;
  const spG = ac.createGain(); spG.gain.setValueAtTime(0.0001, t);
  spG.gain.exponentialRampToValueAtTime(0.45 * CRIT_GAIN, t + 0.006);
  spG.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  sp.connect(bp); bp.connect(spG); spG.connect(pre);
  sp.start(t); sp.stop(t + 0.08);

  // subtle stereo delay thickness
  if (ac.createDelay) {
    const dL = ac.createDelay(); dL.delayTime.setValueAtTime(0.012, t);
    const dG = ac.createGain(); dG.gain.setValueAtTime(0.25, t);
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (pan) pan.pan.setValueAtTime(0.25, t);
    pre.connect(dL); dL.connect(dG); dG.connect(pan || comp); if (pan) pan.connect(comp);
  }
}

/* ───────────── 하위호환 래퍼 ─────────────
   - 기본: 플레이어 둔탁
   - critical:true → 크리 전용 */
export function playAttackImpact(opts = {}) {
  const { critical = false, ...rest } = opts || {};
  if (critical) return playCriticalImpact(rest);
  return playPlayerAttackImpact(rest);
}



let _audioUnlocked = false;


// audio.js (추가)
let _ac;
function _ctx(){ return _ac || (_ac = new (window.AudioContext||window.webkitAudioContext)()); }

// 간단한 천둥소리: 노이즈 + 로패스 + 감쇄
export function playLightning(){
  try{
    const ac = _ctx();
    const dur = 0.6;
    const buffer = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const data = buffer.getChannelData(0);
    // 브라운 노이즈 풍 (적당히 감쇠)
    let lastOut = 0;
    for (let i=0;i<data.length;i++){
      const white = Math.random()*2 - 1;
      lastOut = (lastOut + (0.02 * white)) / 1.02;
      data[i] = lastOut * 2.5;
    }
    const src = ac.createBufferSource(); src.buffer = buffer;

    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
    const gain = ac.createGain(); gain.gain.value = 0.9;

    src.connect(lp); lp.connect(gain); gain.connect(ac.destination);
    // 짧은 이닝/아웃 엔벨롭
    const now = ac.currentTime;
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.9, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.start();
  } catch(e){ /* 사일런트 폴백 */ }
}

export function playThunderBoom({ intensity = 1.0 } = {}){
  const ac = ensureAudio();
  const t  = ac.currentTime;

  // 마스터 (컴프 + 리미트 느낌)
  const master = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-24, t);
  comp.ratio.setValueAtTime(8, t);
  comp.attack.setValueAtTime(0.003, t);
  comp.release.setValueAtTime(0.25, t);
  master.gain.setValueAtTime(Math.min(1, 1.0 * intensity), t);
  master.connect(comp); comp.connect(ac.destination);

  // 번개 크랙(아주 짧게) + 저역 우르릉
  // 1) 크랙
  const crack = createNoise();
  const hp = ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.setValueAtTime(2500, t);
  const cg = ac.createGain(); cg.gain.setValueAtTime(0.0001, t);
  cg.gain.exponentialRampToValueAtTime(0.9 * intensity, t+0.008);
  cg.gain.exponentialRampToValueAtTime(0.0001, t+0.06);
  crack.connect(hp); hp.connect(cg); cg.connect(master);
  crack.start(t); crack.stop(t+0.07);

  // 2) 우르릉(저역 + 노이즈 저역통과)
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
    try {
      setTimeout(() => {
        try { playThunderBoom({ intensity }); } catch {}
      }, Math.max(0, delayMs | 0));
    } catch {}
  }
}