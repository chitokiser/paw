// /geolocation/js/score.js — 유저 점수/HP/사망/체인 관리 (HP 전용)

import {
  getDoc, setDoc, updateDoc, serverTimestamp, doc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ---------------- 내부 상태 ---------------- */
const _state = {
  db: null,
  getGuestId: null,
  toast: (msg)=>console.log('[toast]', msg),
  playFail: ()=>{},
  // 기본값은 서버 문서로 덮어씌워짐
  stats: { hp: 1000, attack: 1, defense: 10, level: 1, exp: 0, nextLevelExp: 20000, chainPoint: 0 },
  isDead: false,
  onChainChanged: null,
  _chainCache: Number(localStorage.getItem('chainTotal') || 0),
  weaponAttack: 0, // 무기 공격력 (HUD 가산)
};

/* ---------------- 스타일 & 오버레이 ---------------- */
function _injectCSS(){
  if (document.getElementById('score-css')) return;
  const css = `
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
    <div class="desc">HP가 0이 되었습니다. 블록체인 누적 점수가 리셋됩니다.</div>
    <button id="btnRespawn">부활하고 계속하기</button>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

/* ---------------- 공개 API ---------------- */
export const Score = {
  /** 초기화 */
  async init({ db, getGuestId, toast, playFail }){
    _state.db = db;
    _state.getGuestId = getGuestId;
    if (toast) _state.toast = toast;
    if (playFail) _state.playFail = playFail;

    _injectCSS();
    _ensureDeathOverlay();

    await this.ensureUserDoc();

    _state.onChainChanged = (val)=>{ try { window.setHUD?.({ chain: val }); } catch {} };
    _state.onChainChanged?.(this.getChainTotal());

    this._pushHUD();
    this.wireRespawn();
  },

  /** 게스트ID 공유 */
  getGuestId(){ return _state.getGuestId?.(); },

  /** 유저 문서 보장/동기화 */
  async ensureUserDoc(){
    const uid = _state.getGuestId();
    await setDoc(doc(_state.db, 'users', uid), { updatedAt: serverTimestamp() }, { merge: true });
    const snap = await getDoc(doc(_state.db, 'users', uid));
    if (snap.exists()){
      Object.assign(_state.stats, snap.data());
    }
    // nextLevelExp 없으면 규칙으로 세팅
    if (!Number.isFinite(_state.stats.nextLevelExp)) {
      _state.stats.nextLevelExp = (_state.stats.level + 1) * 20000;
    }
    return { ..._state.stats };
  },

  /** 현재 상태 */
  getStats(){ return { ..._state.stats }; },

  /** HP 차감 (몬스터/함정 등) */
  async deductHP(points){
    const dmg = Math.max(0, Number(points)||0);
    if (dmg <= 0) return;

    _state.stats.hp = Math.max(0, (_state.stats.hp||0) - dmg);

    try{
      const uid = _state.getGuestId();
      await updateDoc(doc(_state.db, 'users', uid), { hp: _state.stats.hp, updatedAt: serverTimestamp() });
    }catch(e){ console.warn('[Score] deductHP fail', e); }

    _state.toast(`-${dmg} HP`);
    this._pushHUD();
    this._checkAndMaybeDie();
  },

  /** HP 회복 */
  async healHP(points){
    const heal = Math.max(0, Number(points)||0);
    if (heal <= 0) return;

    _state.stats.hp = (_state.stats.hp||0) + heal;

    try{
      const uid = _state.getGuestId();
      await updateDoc(doc(_state.db, 'users', uid), { hp: _state.stats.hp, updatedAt: serverTimestamp() });
    }catch(e){ console.warn('[Score] healHP fail', e); }

    _state.toast(`+${heal} HP`);
    this._pushHUD();
  },

  /** 무기 공격력(장검 등) 반영: HUD에 즉시 표시됨 */
  setWeaponAttack(v){
    _state.weaponAttack = Math.max(0, Number(v)||0);
    this._pushHUD();
  },

  /* ------------ 블록체인 포인트(체인) ------------ */
  getChainTotal(){ return _state._chainCache; },
  setChainTotal(v){
    _state._chainCache = Number(v) || 0;
    try { localStorage.setItem('chainTotal', String(_state._chainCache)); } catch {}
    _state.onChainChanged?.(_state._chainCache);
  },

  /* ------------ HUD 동기화 ------------ */
  _pushHUD(){
    const lvl = Number(_state.stats.level)||1;
    const hp  = Math.max(0, Number(_state.stats.hp)||0);
    const hpMax = Math.max(hp, lvl*1000); // 규칙: 레벨*1000
    const attackShown = lvl + (_state.weaponAttack||0);

    try{
      window.setHUD?.({
        level: lvl,
        attack: attackShown,
        defense: Number(_state.stats.defense)||0,
        exp: Number(_state.stats.exp)||0,
        hp, hpMax,
        chain: this.getChainTotal()
      });
    }catch(e){ console.warn('[Score] pushHUD err', e); }
  },

  /** 레벨업 (버튼은 ui.js → window.__hudLevelUp 로 연결) */
  async levelUp(){
    const before = Number(_state.stats.level)||1;
    _state.stats.level = before + 1;
    _state.stats.nextLevelExp = (_state.stats.level + 1) * 20000;
    // HP는 레벨 기준으로 갱신(가득 채움)
    _state.stats.hp = _state.stats.level * 1000;

    try{
      const uid = _state.getGuestId();
      await updateDoc(doc(_state.db, 'users', uid), {
        level:_state.stats.level,
        hp:_state.stats.hp,
        nextLevelExp:_state.stats.nextLevelExp,
        updatedAt: serverTimestamp()
      });
    }catch(e){ console.warn('[Score] levelUp fail', e); }

    _state.toast('레벨 업!');
    this._pushHUD();
  },

  /* ------------ 사망/부활 ------------ */
  _refillHP(){
    const lvl = Number(_state.stats.level)||1;
    _state.stats.hp = lvl * 1000;
    const uid = _state.getGuestId?.();
    if (uid){
      updateDoc(doc(_state.db, 'users', uid), { hp: _state.stats.hp, updatedAt: serverTimestamp() }).catch(()=>{});
    }
  },

  async _killPlayer(){
    if (_state.isDead) return;
    _state.isDead = true;
    try { _state.playFail(); } catch {}
    // 체인 누적 리셋
    this.setChainTotal(0);

    try{
      const uid = _state.getGuestId();
      await updateDoc(doc(_state.db, 'users', uid), { hp:0, updatedAt: serverTimestamp() });
    }catch(e){ console.warn('[Score] death reset fail', e); }

    const ov = document.getElementById('deathOverlay');
    if (ov) ov.style.display = 'flex';
  },

  _checkAndMaybeDie(){ if ((_state.stats.hp||0) <= 0) this._killPlayer(); },

  wireRespawn(){
    const btn = document.getElementById('btnRespawn');
    const ov  = document.getElementById('deathOverlay');
    if (!btn || !ov) return;
    btn.addEventListener('click', ()=>{
      this._refillHP();
      this._pushHUD();
      _state.isDead = false;
      ov.style.display = 'none';
      _state.toast('부활했습니다!');
    });
  },
};

export default Score;
