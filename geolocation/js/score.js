import { auth, db } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export const Score = (() => {
  let _hud = null, _toast = (m)=>console.log('[toast]', m), _playFail = ()=>{};
  let _stats = { uid:null, level:1, hp:1000, exp:0, attack:1, defense:10, distanceM:0 };

  function _getMaxHP(){
    const lv = Math.max(1, Number(_stats.level||1));
    const explicit = Number(_stats.maxHp);
    return Number.isFinite(explicit) && explicit > 0 ? explicit : lv * 1000;
  }

  function _updateHPDom(){
    const hp  = Math.max(0, Number(_stats.hp||0));
    const max = _getMaxHP();
    const pct = Math.max(0, Math.min(100, (hp/max)*100));

    const fill =
      document.querySelector('.hud-hp-fill') ||
      document.getElementById('hudHPFill') ||
      document.querySelector('#hud .bar .fill');

    const text =
      document.querySelector('.hud-hp-text') ||
      document.getElementById('hudHPText') ||
      document.querySelector('#hud .hp-text');

    if (fill) fill.style.width = `${pct}%`;
    if (text) text.textContent = `${hp} / ${max}`;
  }

  function _syncHUD(){
    try{
      const hpMax = _getMaxHP();
      const hpPct = Math.max(0, Math.min(100, (_stats.hp/hpMax)*100));
      _hud?.set?.({
        level:_stats.level, hp:_stats.hp, hpMax, hpPct,
        exp:_stats.exp, attack:_stats.attack, defense:_stats.defense, distanceM:_stats.distanceM
      });
    }catch{}
    _updateHPDom();
  }

  async function _save(partial){
    const uid = auth.currentUser?.uid; if (!uid) return;
    try{ await updateDoc(doc(db,'users',uid), { ...partial, updatedAt: serverTimestamp() }); }
    catch{
      try{ await setDoc(doc(db,'users',uid), { ...partial, uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge:true }); }
      catch(e2){ console.warn('[Score] save fail', e2); }
    }
  }

  async function _loadProfile(){
    const uid = auth.currentUser?.uid; if (!uid) return; _stats.uid = uid;
    try{
      const ref = doc(db,'users',uid); const ss = await getDoc(ref);
      if (ss.exists()){
        const p = ss.data() || {};
        _stats.level     = Number(p.level ?? 1);
        _stats.hp        = Number(p.hp ?? (_stats.level*1000));
        _stats.exp       = Number(p.exp ?? 0);
        _stats.attack    = Number(p.attack ?? _stats.level);
        _stats.defense   = Number(p.defense ?? 10);
        _stats.distanceM = Number(p.distanceM ?? 0);
        if (Number.isFinite(p.maxHp)) _stats.maxHp = Number(p.maxHp);
      }else{
        await setDoc(ref, { uid, level:1, hp:1000, exp:0, attack:1, defense:10, distanceM:0,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge:true });
      }
    }catch(e){ console.warn('[Score] load profile fail', e); }
  }

  return {
    async init({ toast, playFail } = {}) {
      if (typeof toast === 'function') _toast = toast;
      if (typeof playFail === 'function') _playFail = playFail;
      await _loadProfile();
      _syncHUD();
    },
    attachToHUD(hud){ _hud = hud; _syncHUD(); },
    getStats(){ return _stats; },

    async setHP(next){
      const maxHP = _getMaxHP();
      _stats.hp = Math.max(0, Math.min(Number(next||0), maxHP));
      _syncHUD();
      await _save({ hp:_stats.hp });
    },

    async deductHP(amount = 1){
      const dmg = Math.max(1, Math.floor(amount));
      const after = Math.max(0, Number(_stats.hp||0) - dmg);
      await this.setHP(after);

      if (_stats.hp <= 0){
        try{ _playFail?.(); }catch{}
        _toast?.('기절했습니다. (HP 0)');
        const respawnHP = _getMaxHP();
        await this.setHP(respawnHP);
        _toast?.(`HP가 ${respawnHP}로 회복되었습니다.`);
      }
    },

    updateHPUI(){ _syncHUD(); },
    updateEnergyUI(){},

    async addExp(amount = 0){
      const add = Math.max(0, Math.floor(amount));
      _stats.exp = Number(_stats.exp||0) + add;

      let leveled = false;
      while (true){
        const need = (_stats.level + 1) * 20000;
        if (_stats.exp >= need){
          _stats.level += 1;
          _stats.attack = _stats.level;
          _stats.hp     = _getMaxHP();
          leveled = true;
        } else break;
      }

      _syncHUD();
      await _save({ exp:_stats.exp, level:_stats.level, attack:_stats.attack, hp:_stats.hp });
      if (add > 0) _toast?.(`EXP +${add}${leveled ? ' (레벨업!)' : ''}`);
    },

    getChainTotal(){ return Number(localStorage.getItem('chain_total') || 0); },
    setChainTotal(v){ localStorage.setItem('chain_total', String(Math.max(0, Math.floor(v||0)))); },
    async saveToChainMock(delta = 0){
      const tot = this.getChainTotal() + Math.max(0, Math.floor(delta));
      this.setChainTotal(tot);
      return { total: tot };
    }
  };
})();

export default Score;
