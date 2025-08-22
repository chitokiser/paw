// /geolocation/js/score.js — 유저 점수/에너지/사망/체인 관리 (통합판)

import {
  getDoc, setDoc, updateDoc, addDoc, increment, serverTimestamp,
  collection, doc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/** 🔒 이벤트 로그 쓰기 비활성화 스위치
 *  - walk_logs / tower_hits 같은 DB 로그를 기본 비활성화하여 쓰기량 절감
 *  - 필요 시 true로 변경
 */
const ENABLE_DB_LOGS = false;

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
  onChainChanged: null,
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

    await this.ensureUserDoc();

    _state.onChainChanged = (val)=>{
      try { window.setHUD?.({ chain: val }); } catch {}
    };
    _state.onChainChanged?.(this.getChainTotal());

    this.updateEnergyUI();
  },

  /* 외부에서 게스트ID 필요할 때 쓰는 헬퍼(Shops 등 호환용) */
  getGuestId(){ return _state.getGuestId?.(); },

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

  wireRespawn(){
    const btn = document.getElementById('btnRespawn');
    const ov  = document.getElementById('deathOverlay');
    if (!btn || !ov) return;
    btn.addEventListener('click', ()=>{
      this._refillEnergy();
      this.updateEnergyUI();
      _state.isDead = false;
      ov.style.display = 'none';
      _state.toast('부활했습니다!');
    }, { once: false });
  },

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

  /* 아이템(예: 빨간약)로 에너지 늘리기 — Firestore 로그 생성 없이 users.totalGP 만 증가 */
  async addEnergy(delta = 10){
    if (!Number.isFinite(delta) || delta <= 0) return;

    // 로컬 상태 갱신
    _state.stats.totalGP = Math.max(0, Number(_state.stats.totalGP || 0) + delta);
    this.updateEnergyUI();

    // Firestore users.totalGP 증가
    try{
      const uid = _state.getGuestId?.();
      if (uid){
        await updateDoc(doc(_state.db, 'users', uid), {
          totalGP: increment(delta),
          updatedAt: serverTimestamp()
        });
      }
    }catch(e){ console.warn('addEnergy failed:', e); }

    try { _state.toast?.(`에너지 +${delta}`); } catch {}
  },

  /* ✅ 프로젝트 전반 호환용 alias: addGP → awardGP */
  async addGP(gpUnits, lat, lon, totalDistanceM = 0){
    return this.awardGP(gpUnits, lat, lon, totalDistanceM);
  },

  /* 점수 지급(도보 보상/전투 보상 등) */
  async awardGP(gpUnits, lat, lon, totalDistanceM){
    if (gpUnits <= 0) return;
    const uid = _state.getGuestId();

    // (옵션) walk_logs 기록 — 기본 비활성화로 DB 낭비 방지
    if (ENABLE_DB_LOGS) {
      try {
        await addDoc(collection(_state.db, 'walk_logs'), {
          address: uid, gp: gpUnits, metersCounted: gpUnits*10,
          lat, lon, totalDistanceM, createdAt: serverTimestamp()
        });
      } catch {}
    }

    await updateDoc(doc(_state.db, 'users', uid), {
      totalGP: increment(gpUnits),
      totalDistanceM: increment(gpUnits*10),
      updatedAt: serverTimestamp()
    });

    _state.stats.totalGP        += gpUnits;
    _state.stats.totalDistanceM += gpUnits*10;

    this.updateEnergyUI();
  },

  /* 점수 차감(피해 등) */
  async deductGP(points, fromLat, fromLon){
    if (points <= 0) return;
    const uid = _state.getGuestId();

    // (옵션) tower_hits 로그 — 기본 비활성화
    if (ENABLE_DB_LOGS) {
      try {
        await addDoc(collection(_state.db, 'tower_hits'), {
          address: uid, gp: -points, fromLat, fromLon, createdAt: serverTimestamp()
        });
      } catch {}
    }

    await updateDoc(doc(_state.db, 'users', uid), {
      totalGP: increment(-points),
      updatedAt: serverTimestamp()
    });

    _state.stats.totalGP = Math.max(0, _state.stats.totalGP - points);

    this.updateEnergyUI();

    try { _state.playFail(); } catch {}
    _state.toast(`-${points} HP(damage)`);

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
    _state.stats.totalGP = _state.energyMax;
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

    // 체인 누적 리셋
    this.setChainTotal(0);

    // 서버 점수 0으로
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

export default Score;
