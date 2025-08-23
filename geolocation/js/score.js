// /geolocation/js/score.js  (Single SoT + CP 통합)
import { auth, db } from './firebase.js';
import {
  doc, setDoc, updateDoc, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { playReward, playDeath } from './audio.js';

export const Score = (() => {
  let _hud = null;
  let _toast = (m)=>console.log('[toast]', m);
  let _playFail = ()=>{};
  let _unsub = null;
  const _listeners = new Set();

  // 세션 로컬 상태
  let _stats = {
    uid: null,
    level: 1,
    hp: 1000,
    exp: 0,
    attack: 1,
    defense: 10,
    distanceM: 0,
    maxHp: 1000,
    cp: 0, // ✅ 블록체인 포인트
  };

  /* ───────── 내부 유틸 ───────── */
  function _getMaxHP(){
    const lv = Math.max(1, Number(_stats.level||1));
    const explicit = Number(_stats.maxHp);
    return Number.isFinite(explicit) && explicit > 0 ? explicit : lv * 1000;
  }

  function _updateHPDom(){
    const hp  = Math.max(0, Number(_stats.hp||0));
    const max = _getMaxHP();
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));

    const fill =
      document.querySelector('.hud-hp-fill') ||
      document.querySelector('#hud #hudHPFill') ||
      document.querySelector('#hud .bar .fill');

    const text =
      document.querySelector('.hud-hp-text') ||
      document.querySelector('#hud #hudHPText') ||
      document.querySelector('#hud .hp-text');

    if (fill) fill.style.setProperty('width', `${pct}%`, 'important');
    if (text) text.textContent = `${hp} / ${max}`;
  }

  function _syncHUDAndNotify() {
    try {
      const hpMax = _getMaxHP();
      const hpPct = Math.max(0, Math.min(100, (_stats.hp / hpMax) * 100));
      _hud?.set?.({
        level: _stats.level,
        hp: _stats.hp,
        hpMax,
        hpPct,
        exp: _stats.exp,
        attack: _stats.attack,
        defense: _stats.defense,
        distanceM: _stats.distanceM,
        // 필요 시 HUD 쪽에서 CP도 보여주려면 set() 내부에서 처리
        cp: _stats.cp,
      });
    } catch {}
    _updateHPDom();
    _listeners.forEach(fn => { try { fn({..._stats}); } catch {} });
  }

  async function _save(partial) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'users', uid), { ...partial, updatedAt: serverTimestamp() });
    } catch {
      try {
        await setDoc(doc(db, 'users', uid), { ...partial, uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge:true });
      } catch (e2) { console.warn('[Score] save fail', e2); }
    }
  }

  function _startUserSubscription(){
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    _stats.uid = uid;

    const ref = doc(db, 'users', uid);
    if (_unsub) { try { _unsub(); } catch {} _unsub = null; }

    _unsub = onSnapshot(ref, async (ss) => {
      if (!ss.exists()) {
        await setDoc(ref, {
          uid,
          level: 1, hp: 1000, exp: 0, attack: 1, defense: 10,
          maxHp: 1000, distanceM: 0, chainPoint: 0,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        }, { merge:true });
        return;
      }
      const p = ss.data() || {};
      _stats.level     = Number(p.level ?? 1);
      _stats.exp       = Number(p.exp ?? 0);
      _stats.attack    = Number(p.attack ?? _stats.level);
      _stats.defense   = Number(p.defense ?? 10);
      _stats.distanceM = Number(p.distanceM ?? 0);
      _stats.maxHp     = Number.isFinite(p.maxHp) ? Number(p.maxHp) : (_stats.level * 1000);
      _stats.hp        = Number(p.hp ?? _stats.maxHp);
      _stats.cp        = Number(p.chainPoint ?? p.cp ?? 0);  // ✅ CP 동기화

      _syncHUDAndNotify();
    }, (e) => console.warn('[Score] onSnapshot error', e));
  }

  /* ───────── 공개 API ───────── */
  return {
    async init({ toast, playFail } = {}) {
      if (typeof toast === 'function') _toast = toast;
      if (typeof playFail === 'function') _playFail = playFail;
      _startUserSubscription();      // getDoc 없이 바로 구독
      _syncHUDAndNotify();           // 기본값으로 HUD 초기화
    },

    attachToHUD(hud) { _hud = hud; _syncHUDAndNotify(); },

    onChange(fn){ if (typeof fn === 'function') _listeners.add(fn); return ()=>_listeners.delete(fn); },

    getStats() { return _stats; },

    /* ===== HP ===== */
    async setHP(next) {
      const maxHP = _getMaxHP();
      _stats.hp = Math.max(0, Math.min(Number(next || 0), maxHP));
      _syncHUDAndNotify();
      await _save({ hp: _stats.hp, maxHp: maxHP });
    },

    async deductHP(amount = 1) {
      const dmg = Math.max(1, Math.floor(amount));
      const after = Math.max(0, Number(_stats.hp || 0) - dmg);
      await this.setHP(after);

      if (_stats.hp <= 0) {
        try { playDeath(); } catch {}
        try { _playFail?.(); } catch {}
        _toast?.('기절했습니다. (HP 0)');

        const respawnHP = _getMaxHP();
        await this.setHP(respawnHP);
        _toast?.(`HP가 ${respawnHP}로 회복되었습니다.`);
      }
    },

    updateHPUI(){ _syncHUDAndNotify(); },
    updateEnergyUI(){},

    /* ===== EXP / Level ===== */
    async addExp(amount = 0) {
      const add = Math.max(0, Math.floor(amount));
      let newExp = Number(_stats.exp || 0) + add;

      let leveled = false;
      const need = (_stats.level + 1) * 20000;
      if (newExp >= need) {
        _stats.level += 1;
        _stats.attack = _stats.level;
        _stats.maxHp  = _getMaxHP();
        _stats.hp     = _stats.maxHp;
        newExp = 0;
        leveled = true;
        try { playReward(); } catch {}
      }

      _stats.exp = newExp;
      _syncHUDAndNotify();
      await _save({
        exp: _stats.exp, level: _stats.level,
        attack: _stats.attack, hp: _stats.hp, maxHp: _stats.maxHp
      });

      if (add > 0) _toast?.(`EXP +${add}${leveled ? ' (레벨업!)' : ''}`);
    },

    /* ===== CP(Chain Point) ===== */
    getCP(){ return Number(_stats.cp || 0); },

    async setCP(next){
      _stats.cp = Math.max(0, Math.floor(Number(next||0)));
      _syncHUDAndNotify();
      await _save({ chainPoint: _stats.cp, cp: _stats.cp });
    },

    async addCP(delta = 0){
      const add = Math.max(0, Math.floor(delta));
      if (add <= 0) return this.getCP();
      return await this.setCP(this.getCP() + add);
    },

    /** 상점 결제 등: CP 차감 (성공 시 true) */
    async spendCP(amount = 0, meta = {}){
      const need = Math.max(0, Math.floor(amount));
      if (need <= 0) return true;
      const cur = this.getCP();
      if (cur < need) return false;
      await this.setCP(cur - need);
      // 필요하면 메타 정보를 별도 로그 컬렉션에 적재(선택):
      // await addDoc(collection(db,'cp_logs'), { uid:_stats.uid, ...meta, delta:-need, createdAt:serverTimestamp() })
      return true;
    },

    /** 걷기 적립(하위호환): awardGP → CP로 누적 */
    async awardGP(gp = 0 /*, lat, lon, distM */){
      const add = Math.max(0, Math.floor(gp));
      if (add <= 0) return this.getCP();
      return await this.addCP(add);
    },

    /* 체인 포인트(모의) — 유지(별도 표시용) */
    getChainTotal(){ return Number(localStorage.getItem('chain_total') || 0); },
    setChainTotal(v){ localStorage.setItem('chain_total', String(Math.max(0, Math.floor(v || 0)))); },
    async saveToChainMock(delta = 0) {
      const tot = this.getChainTotal() + Math.max(0, Math.floor(delta));
      this.setChainTotal(tot);
      return { total: tot };
    }
  };
})();

export default Score;
