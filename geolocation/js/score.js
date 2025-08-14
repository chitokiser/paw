// score.js — 유저 점수/에너지/사망/체인 관리 모듈
// 사용법 (main.js):
// import { Score } from "./score.js";
// await Score.init({ db, getGuestId, toast, playFail });
// Score.attachToHUD(ensureHUD());   // HUD 안에 에너지바/오버레이 주입
// Score.updateEnergyUI();           // 초기 표시
// Score.wireRespawn();              // 부활 버튼 활성화
//
// 사용 중:
// await Score.awardGP(power, lat, lon, totalDistanceM);
// await Score.deductGP(1, towerLat, towerLon); // 필요 시
// const stats = Score.getStats();  // { totalGP, totalDistanceM }

import {
  getDoc, setDoc, updateDoc, addDoc, increment, serverTimestamp,
  collection, doc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const _state = {
  db: null,
  getGuestId: null,
  toast: (msg)=>console.log('[toast]', msg),
  playFail: ()=>{},
  stats: { totalGP: 0, totalDistanceM: 0 },
  energyMax: Number(localStorage.getItem('energyMax') || 100),
  isDead: false,
  hudEl: null,
};

function _setEnergyMax(v){
  _state.energyMax = Math.max(10, Number(v)||100);
  localStorage.setItem('energyMax', String(_state.energyMax));
}

/* ---------- UI 주입 (에너지바 + 사망 오버레이) ---------- */
function _injectCSS(){
  if (document.getElementById('score-css')) return;
  const css = `
  /* ----- Energy Bar ----- */
  .energy-box{margin-top:6px}
  .energy-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
  .energy-label{font-weight:700}
  .energy-val{font-variant-numeric:tabular-nums}
  .energy-wrap{
    position:relative;height:12px;border-radius:999px;overflow:hidden;background:#1f2937;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
  }
  .energy-fill{
    position:absolute;left:0;top:0;height:100%;
    background:linear-gradient(90deg,#22c55e,#f59e0b,#ef4444);
    width:0%; transition:width .25s ease;
  }

  /* ----- Death Overlay ----- */
  #deathOverlay{
    position:fixed; inset:0; z-index:3000; background:rgba(0,0,0,.8);
    color:#fff; display:none; align-items:center; justify-content:center; text-align:center;
    padding:24px; font-weight:800;
  }
  #deathOverlay .inner{max-width:520px}
  #deathOverlay .title{font-size:28px;margin-bottom:8px}
  #deathOverlay .desc{opacity:.9;margin-bottom:16px}
  #deathOverlay button{
    background:#ef4444; color:#fff; font-weight:800; border:none; border-radius:12px;
    padding:12px 16px; cursor:pointer;
  }`;
  const s = document.createElement('style');
  s.id = 'score-css';
  s.textContent = css;
  document.head.appendChild(s);
}

function _ensureDeathOverlay(){
  if (document.getElementById('deathOverlay')) return;
  const html = `
  <div id="deathOverlay"><div class="inner">
    <div class="title">💀 사망</div>
    <div class="desc">에너지가 0이 되었습니다. 블록체인 누적 점수가 리셋됩니다.</div>
    <button id="btnRespawn">부활하고 계속하기</button>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

/* ---------- 공개 API ---------- */
export const Score = {
  async init({ db, getGuestId, toast, playFail }){
    _state.db = db;
    _state.getGuestId = getGuestId;
    if (toast) _state.toast = toast;
    if (playFail) _state.playFail = playFail;

    _injectCSS();
    _ensureDeathOverlay();

    // 유저 문서 보장 + 로드
    await this.ensureUserDoc();
    this.updateEnergyUI();
  },

  attachToHUD(hudEl){
    _state.hudEl = hudEl;
    if (!hudEl) return;
    // HUD 내부에 에너지 섹션이 없으면 삽입
    if (!hudEl.querySelector('.energy-box')){
      const box = document.createElement('div');
      box.className = 'energy-box';
      box.innerHTML = `
        <div class="energy-top">
          <div class="energy-label">에너지</div>
          <div id="hudEnergyText" class="energy-val">0 / 0</div>
        </div>
        <div class="energy-wrap"><div id="hudEnergyFill" class="energy-fill"></div></div>
      `;
      // 기본 HUD 구조에 맞춰 적절한 위치에 삽입 (블록체인 점수 위에 삽입 시도)
      const chainRow = hudEl.querySelector('#hudChain')?.closest('.row');
      if (chainRow?.parentElement) chainRow.parentElement.insertBefore(box, chainRow);
      else hudEl.appendChild(box);
    }
  },

  wireRespawn(){
    const btn = document.getElementById('btnRespawn');
    const ov  = document.getElementById('deathOverlay');
    if (!btn || !ov) return;
    btn.addEventListener('click', ()=>{
      _state.isDead = false;
      // 0에서 재시작 (원하면 기본 회복 수치 넣을 수 있음)
      this.updateEnergyUI();
      ov.style.display = 'none';
      _state.toast('부활했습니다!');
    });
  },

  /* ---- Firestore User ---- */
  async ensureUserDoc(){
    const uid = _state.getGuestId();
    await setDoc(doc(_state.db, 'users', uid), {
      address: uid,
      updatedAt: serverTimestamp()
    }, { merge: true });

    const snap = await getDoc(doc(_state.db, 'users', uid));
    if (snap.exists()){
      const d = snap.data();
      _state.stats.totalDistanceM = Number(d.totalDistanceM || 0);
      _state.stats.totalGP        = Number(d.totalGP || 0);
    }
    return this.getStats();
  },

  getStats(){
    // 얕은 복사로 외부 변경 방지
    return { totalDistanceM: _state.stats.totalDistanceM, totalGP: _state.stats.totalGP };
  },

  /* ---- Award / Deduct ---- */
  async awardGP(gpUnits, lat, lon, totalDistanceM){
    if (gpUnits <= 0) return;
    const uid = _state.getGuestId();
    await addDoc(collection(_state.db, 'walk_logs'), {
      address: uid, gp: gpUnits, metersCounted: gpUnits*10,
      lat, lon, totalDistanceM, createdAt: serverTimestamp()
    });
    await updateDoc(doc(_state.db, 'users', uid), {
      totalGP: increment(gpUnits),
      totalDistanceM: increment(gpUnits*10),
      updatedAt: serverTimestamp()
    });
    _state.stats.totalGP += gpUnits;
    _state.stats.totalDistanceM += gpUnits*10;

    this.updateEnergyUI();
  },

  async deductGP(points, fromLat, fromLon){
    if (points <= 0) return;
    const uid = _state.getGuestId();
    await addDoc(collection(_state.db, 'tower_hits'), {
      address: uid, gp: -points, fromLat, fromLon, createdAt: serverTimestamp()
    });
    await updateDoc(doc(_state.db, 'users', uid), {
      totalGP: increment(-points),
      updatedAt: serverTimestamp()
    });
    _state.stats.totalGP -= points;

    this.updateEnergyUI();
    this._checkAndMaybeDie();
    try { _state.playFail(); } catch {}
    _state.toast(`-${points} GP (망루)`);
  },

  /* ---- Chain (mock) ---- */
  getChainTotal(){ return Number(localStorage.getItem('chainTotal') || 0); },
  setChainTotal(v){ localStorage.setItem('chainTotal', String(v)); },
  async saveToChainMock(delta){
    const before = this.getChainTotal();
    const after  = before + delta;
    this.setChainTotal(after);
    const tx = '0x'+Math.random().toString(16).slice(2,10)+Math.random().toString(16).slice(2,10);
    return { txHash: tx, total: after };
  },

  /* ---- Energy UI ---- */
  updateEnergyUI(){
    // 최대 에너지 자동 성장
    if (_state.stats.totalGP > _state.energyMax) _setEnergyMax(_state.stats.totalGP);

    const fill = document.getElementById('hudEnergyFill');
    const txt  = document.getElementById('hudEnergyText');
    if (fill){
      const pct = Math.max(0, Math.min(100, (_state.stats.totalGP / _state.energyMax) * 100));
      fill.style.width = pct.toFixed(1) + '%';
    }
    if (txt){
      txt.textContent = `${Math.max(0, _state.stats.totalGP)} / ${_state.energyMax}`;
    }
  },

  /* ---- Death ---- */
  async _killPlayer(){
    if (_state.isDead) return;
    _state.isDead = true;

    try { _state.playFail(); } catch {}

    // 체인 리셋
    this.setChainTotal(0);
    // Firestore 누적 점수 리셋
    try{
      const uid = _state.getGuestId();
      await updateDoc(doc(_state.db, 'users', uid), {
        totalGP: 0, updatedAt: serverTimestamp()
      });
    }catch(e){ console.warn('death reset fail:', e); }

    _state.stats.totalGP = 0;
    this.updateEnergyUI();

    const ov = document.getElementById('deathOverlay');
    if (ov) ov.style.display = 'flex';
  },

  _checkAndMaybeDie(){
    if (_state.stats.totalGP <= 0) this._killPlayer();
  },
};
