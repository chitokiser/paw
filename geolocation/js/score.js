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
// await Score.deductGP(1, towerLat, towerLon);
// const stats = Score.getStats();  // { totalGP, totalDistanceM }

import {
  getDoc, setDoc, updateDoc, addDoc, increment, serverTimestamp,
  collection, doc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ---------------- 내부 상태 ---------------- */
const _state = {
  db: null,
  getGuestId: null,
  toast: (msg)=>console.log('[toast]', msg),
  playFail: ()=>{},
  stats: { totalGP: 0, totalDistanceM: 0 },
  energyMax: Number(localStorage.getItem('energyMax') || 100),
  isDead: false,
  hudEl: null,
  onChainChanged: null,   // 체인 변경시 HUD 반영용 콜백
  _chainCache: Number(localStorage.getItem('chainTotal') || 0),
};

/* ---------------- 유틸 ---------------- */
function _setEnergyMax(v){
  _state.energyMax = Math.max(10, Number(v)||100);
  localStorage.setItem('energyMax', String(_state.energyMax));
}

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

/* ---------------- 공개 API ---------------- */
export const Score = {
  /* 초기화 */
  async init({ db, getGuestId, toast, playFail }){
    _state.db = db;
    _state.getGuestId = getGuestId;
    if (toast) _state.toast = toast;
    if (playFail) _state.playFail = playFail;

    _injectCSS();
    _ensureDeathOverlay();

    // 유저 문서 보장 + 로드
    await this.ensureUserDoc();

    // 체인 변경시 HUD 반영
    _state.onChainChanged = (val)=>{
      try { window.setHUD?.({ chain: val }); } catch {}
    };

    // 최초 체인 표시 갱신
    _state.onChainChanged?.(this.getChainTotal());

    this.updateEnergyUI();
  },

  /* HUD 연결 (에너지바 주입) */
  attachToHUD(hudEl){
    _state.hudEl = hudEl;
    if (!hudEl) return;
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
      const chainRow = hudEl.querySelector('#hudChain')?.closest('.row');
      if (chainRow?.parentElement) chainRow.parentElement.insertBefore(box, chainRow);
      else hudEl.appendChild(box);
    }
  },

  /* 부활 버튼 동작 연결 */
  wireRespawn(){
    const btn = document.getElementById('btnRespawn');
    const ov  = document.getElementById('deathOverlay');
    if (!btn || !ov) return;
    btn.addEventListener('click', ()=>{
      this._refillEnergy();          // 풀 회복
      this.updateEnergyUI();
      _state.isDead = false;
      ov.style.display = 'none';
      _state.toast('부활했습니다!');
    }, { once: false });
  },

  /* Firestore: 유저 문서 확보/조회 */
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
    return { totalDistanceM: _state.stats.totalDistanceM, totalGP: _state.stats.totalGP };
  },

  /* 점수 지급 (걷기/몬스터 승리 등) */
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

    _state.stats.totalGP        += gpUnits;
    _state.stats.totalDistanceM += gpUnits*10;

    this.updateEnergyUI();
  },

  /* 점수 차감 (타워 피격 등) + 사망 판정 */
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
    if (_state.stats.totalGP < 0) _state.stats.totalGP = 0;

    this.updateEnergyUI();

    // 피격 사운드 + 토스트
    try { _state.playFail(); } catch {}
    _state.toast(`-${points} GP (망루)`);

    // 사망 체크
    this._checkAndMaybeDie();
  },

  /* ------------ 체인(모의) ------------ */
  getChainTotal(){ return _state._chainCache; },
  setChainTotal(v){
    _state._chainCache = Number(v) || 0;
    try { localStorage.setItem('chainTotal', String(_state._chainCache)); } catch {}
    _state.onChainChanged?.(_state._chainCache);
  },
  async saveToChainMock(delta){
    const after = this.getChainTotal() + Number(delta||0);
    this.setChainTotal(after);
    const tx = '0x'+Math.random().toString(16).slice(2,10)+Math.random().toString(16).slice(2,10);
    return { txHash: tx, total: after };
  },

  /* ------------ 에너지 UI ------------ */
  updateEnergyUI(){
    // 최대 에너지 자동 성장(원한다면 고정으로 바꿔도 됨)
    if (_state.stats.totalGP > _state.energyMax) _setEnergyMax(_state.stats.totalGP);

    const fill = document.getElementById('hudEnergyFill');
    const txt  = document.getElementById('hudEnergyText');

    const cur = Math.max(0, _state.stats.totalGP);
    const pct = Math.max(0, Math.min(100, (cur / _state.energyMax) * 100));

    if (fill) fill.style.width = pct.toFixed(1) + '%';
    if (txt)  txt.textContent  = `${cur} / ${_state.energyMax}`;
  },

  /* ------------ 사망/부활 ------------ */
  _refillEnergy(){
    // 사망 후 부활 시: 에너지(=totalGP) 풀회복 → 현재 max로 채움
    _state.stats.totalGP = _state.energyMax;
    // Firestore 반영
    const uid = _state.getGuestId?.();
    if (uid){
      updateDoc(doc(_state.db, 'users', uid), {
        totalGP: _state.stats.totalGP,
        updatedAt: serverTimestamp()
      }).catch(()=>{});
    }
  },

  async _killPlayer(){
    if (_state.isDead) return;
    _state.isDead = true;

    try { _state.playFail(); } catch {}

    // 1) 체인 점수 0으로 리셋
    this.setChainTotal(0);

    // 2) Firestore totalGP 0으로 리셋
    try{
      const uid = _state.getGuestId();
      await updateDoc(doc(_state.db, 'users', uid), {
        totalGP: 0, updatedAt: serverTimestamp()
      });
    }catch(e){ console.warn('death reset fail:', e); }

    // 3) 로컬 상태 0
    _state.stats.totalGP = 0;
    this.updateEnergyUI();

    // 4) 사망 오버레이 노출
    const ov = document.getElementById('deathOverlay');
    if (ov) ov.style.display = 'flex';
  },

  _checkAndMaybeDie(){
    if (_state.stats.totalGP <= 0) this._killPlayer();
  },
};
