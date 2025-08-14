// /js/audio.js
let audioCtx;
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

/* ===== 공격 임팩트 사운드 (명중 순간 전용) ===== */
export function playAttackImpact({ intensity = 1.0, includeWhoosh = false } = {}) {
  const ac = ensureAudio();
  const t  = ac.currentTime;

  // 마스터 체인 (Gain -> Compressor -> Destination)
  const master = ac.createGain();
  master.gain.setValueAtTime(Math.min(1, 0.9 * intensity), t);

  const comp = ac.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-16, t);
  comp.knee.setValueAtTime(20, t);
  comp.ratio.setValueAtTime(6, t);
  comp.attack.setValueAtTime(0.002, t);
  comp.release.setValueAtTime(0.12, t);

  master.connect(comp);
  comp.connect(ac.destination);

  // 필요 시 휘두르는 소리도 같이 (보통 swingSwordAt에서 이미 호출)
  if (includeWhoosh) { try { swordWhoosh(); } catch {} }

  // 1) "크랙!" (하이패스 노이즈)
  const crack = createNoise();
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(2200, t);
  const cg = ac.createGain();
  cg.gain.setValueAtTime(0.0001, t);
  cg.gain.exponentialRampToValueAtTime(0.7 * intensity, t + 0.008);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  crack.connect(hp); hp.connect(cg); cg.connect(master);
  crack.start(t); crack.stop(t + 0.08);

  // 2) 금속성 클랭 (삼각파 3중) + 약한 스테레오
  const pannerOk = typeof ac.createStereoPanner === 'function';
  const clangPan = pannerOk ? ac.createStereoPanner() : null;
  if (clangPan) clangPan.pan.setValueAtTime(0.18, t);
  const clangDest = clangPan ? clangPan : master;
  if (clangPan) clangPan.connect(master);

  [920, 1270, 1820].forEach((f, i) => {
    const o = ac.createOscillator(); o.type = 'triangle';
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.1);
    g.gain.exponentialRampToValueAtTime((0.45 - i*0.12) * intensity, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + i*0.01);
    o.connect(g); g.connect(clangDest);
    o.start(t); o.stop(t + 0.22 + i*0.02);
  });

  // 3) 저역 "퍽" (배에 오는 타격감)
  const thump = ac.createOscillator(); thump.type = 'sine';
  thump.frequency.setValueAtTime(110, t);
  thump.frequency.linearRampToValueAtTime(70, t + 0.12);

  const thumpPan = pannerOk ? ac.createStereoPanner() : null;
  if (thumpPan) thumpPan.pan.setValueAtTime(-0.12, t);
  const tg = ac.createGain();
  tg.gain.setValueAtTime(0.0001, t);
  tg.gain.exponentialRampToValueAtTime(0.9 * intensity, t + 0.012);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

  thump.connect(tg); tg.connect(thumpPan || master);
  if (thumpPan) thumpPan.connect(master);
  thump.start(t); thump.stop(t + 0.2);

  // 4) 스파클 하이라이트 (밴드패스 6k)
  const sparkle = createNoise();
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(6000, t); bp.Q.value = 3;
  const sg = ac.createGain(); sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.25 * intensity, t + 0.005);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  sparkle.connect(bp); bp.connect(sg); sg.connect(master);
  sparkle.start(t); sparkle.stop(t + 0.06);
}
