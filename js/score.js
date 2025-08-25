// /geolocation/js/score.js
// SSOT: Firestore 문서 키 = wallet(lower) > uid > guest:xxxx
import { auth, db } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { playReward, playDeath } from './audio.js';

export const Score = (() => {
  let _hud=null, _toast=(m)=>console.log('[toast]', m), _playFail=()=>{}, _unsub=null;
  const _listeners = new Set();

  // 세션 로컬 상태
  let _stats = {
    key:null, level:1, hp:1000, exp:0, attack:1, defense:10,
    distanceM:0, maxHp:1000, cp:0
  };

  /* ───────── 키/레퍼런스 유틸 ───────── */
  const _lower = (s)=>String(s||'').toLowerCase();
  const _today = ()=> new Date().toISOString().slice(0,10);

  function _ensureGuestId(){
    let gid = localStorage.getItem('guest_id');
    if (!gid){ gid = 'guest:' + Math.random().toString(36).slice(2); localStorage.setItem('guest_id', gid); }
    return gid;
  }
  async function _passiveWallet(){
    try{
      if (window.ethereum?.selectedAddress) return _lower(window.ethereum.selectedAddress);
      const a = await window.ethereum?.request?.({ method:'eth_accounts' }) || [];
      return _lower(a[0]||'') || null;
    }catch{ return null; }
  }
  async function _resolveKey(){
    const s = sessionStorage.getItem('GH_WALLET'); if (s) return _lower(s);
    const w = await _passiveWallet(); if (w){ sessionStorage.setItem('GH_WALLET', w); return w; }
    const uid = auth?.currentUser?.uid; if (uid) return uid;
    return _ensureGuestId();
  }
  function _userRef(){
    const key = _stats.key || sessionStorage.getItem('GH_WALLET') || auth?.currentUser?.uid || _ensureGuestId();
    return doc(db,'users', _lower(key));
  }

  /* ───────── 내부 뷰 유틸 ───────── */
  const _maxHP = () => {
    const explicit = Number(_stats.maxHp);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const lv = Math.max(1, Number(_stats.level||1));
    return lv * 1000;
  };

  const _updateHPDom = () => {
    const hp  = Math.max(0, Number(_stats.hp||0));
    const max = _maxHP();
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));
    const fill = document.querySelector('.hud-hp-fill') || document.querySelector('#hud #hudHPFill') || document.querySelector('#hud .bar .fill');
    const text = document.querySelector('.hud-hp-text') || document.querySelector('#hud #hudHPText') || document.querySelector('#hud .hp-text');
    if (fill) fill.style.setProperty('width', `${pct}%`, 'important');
    if (text) text.textContent = `${hp} / ${max}`;
  };

  const _emit = () => { _listeners.forEach(fn => { try { fn({..._stats}); } catch {} }); };

  const _syncHUD = () => {
    try {
      const hpMax = _maxHP();
      const hp    = Math.max(0, Math.min(Number(_stats.hp||0), hpMax));
      const hpPct = hpMax>0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0;
      _stats.hp = hp;
      _hud?.set?.({
        level:_stats.level, hp, hpMax, hpPct,
        exp:_stats.exp, attack:_stats.attack, defense:_stats.defense,
        distanceM:_stats.distanceM, cp:_stats.cp
      });
    } catch {}
    _updateHPDom();
    _emit();
  };

  const _save = async (partial) => {
    try {
      await updateDoc(_userRef(), { ...partial, updatedAt: serverTimestamp() });
    } catch {
      try {
        await setDoc(_userRef(), {
          ...partial,
          key:_stats.key, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        }, { merge:true });
      } catch (e2){ console.warn('[Score] save fail', e2); }
    }
  };

  /* ───────── DB 구독 ───────── */
  const _subscribeUser = async () => {
    const key = await _resolveKey();
    _stats.key = key;

    const ref = _userRef();
    if (_unsub) { try{_unsub();}catch{} _unsub=null; }

    _unsub = onSnapshot(ref, async (ss)=>{
      if (!ss.exists()){
        await setDoc(ref, {
          key,
          level:1, hp:1000, exp:0, attack:1, defense:10,
          maxHp:1000, distanceM:0, cp:0, lastDate:_today(),
          createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        }, { merge:true });
        return;
      }
      const p = ss.data() || {};

      // 기본 스탯
      _stats.level     = Number(p.level ?? 1);
      _stats.exp       = Number(p.exp ?? 0);
      _stats.attack    = Number(p.attack ?? _stats.level);
      _stats.defense   = Number(p.defense ?? 10);
      _stats.distanceM = Number(p.distanceM ?? 0);

      // HP / MaxHP — DB 우선
      const dbMax = Number(p.maxHp);
      _stats.maxHp = Number.isFinite(dbMax) && dbMax > 0 ? dbMax : (_stats.maxHp ?? 1000);
      const dbHp  = Number(p.hp);
      _stats.hp   = Number.isFinite(dbHp) ? dbHp : (_stats.hp ?? _stats.maxHp);

      // CP: cp가 정의되어 있으면 그대로, 없으면 chainPoint로 1회 보정
      if (Object.prototype.hasOwnProperty.call(p, 'cp')) {
        _stats.cp = Math.max(0, Number(p.cp) || 0);
      } else {
        const legacy = Number(p.chainPoint);
        _stats.cp = Number.isFinite(legacy) ? Math.max(0, legacy) : 0;
        try { await _save({ cp:_stats.cp }); } catch (e) { console.warn('[Score] cp migrate(save) fail', e); }
      }

      _syncHUD();
    }, (e)=>console.warn('[Score] onSnapshot error', e));
  };

  // 지갑/체인 변경 시 재구독
  if (window.ethereum?.on){
    window.ethereum.on('accountsChanged', ()=>{ _subscribeUser(); });
    window.ethereum.on('chainChanged',    ()=>{ _subscribeUser(); });
  }

  /* ───────── 공개 API ───────── */
  return {
    async init({ toast, playFail } = {}) {
      if (typeof toast === 'function') _toast = toast;
      if (typeof playFail === 'function') _playFail = playFail;
      await _subscribeUser();
      _syncHUD();
    },

    attachToHUD(hud){ _hud = hud; _syncHUD(); },
    onChange(fn){ if (typeof fn==='function') _listeners.add(fn); return ()=>_listeners.delete(fn); },
    getStats(){ return _stats; },

    /* ===== HP ===== */
    async setHP(next){
      const hpMax = _maxHP();
      _stats.hp = Math.max(0, Math.min(Number(next || 0), hpMax));
      _syncHUD();
      await _save({ hp:_stats.hp });
    },

    async deductHP(amount=1){
      const dmg = Math.max(1, Math.floor(amount));
      const after = Math.max(0, Number(_stats.hp||0) - dmg);
      await this.setHP(after);

      if (_stats.hp <= 0){
        // 사망 패널티: CP 즉시 0
        try { await this.setCP(0); } catch (e) { console.warn('[Score] death cp reset fail', e); }

        try { playDeath(); } catch {}
        try { _playFail?.(); } catch {}
        _toast?.('기절했습니다. (HP 0)');

        // 리스폰(HP 풀)
        const respawnHP = _maxHP();
        await this.setHP(respawnHP);
        _toast?.(`HP가 ${respawnHP}로 회복되었습니다.`);
      }
    },

    updateHPUI(){ _syncHUD(); },
    updateEnergyUI(){},

    /* ===== EXP / Level ===== */
    async addExp(amount=0){
      const add = Math.max(0, Math.floor(amount));
      let newExp = Number(_stats.exp||0) + add, leveled=false;
      const need = (_stats.level + 1) * 20000;
      if (newExp >= need){
        _stats.level += 1;
        _stats.attack = _stats.level;
        _stats.hp = _maxHP();
        newExp = 0;
        leveled = true;
        try { playReward(); } catch {}
      }
      _stats.exp = newExp;
      _syncHUD();
      await _save({ exp:_stats.exp, level:_stats.level, attack:_stats.attack, hp:_stats.hp, maxHp:_stats.maxHp });
      if (add>0) _toast?.(`EXP +${add}${leveled?' (레벨업!)':''}`);
    },

    /* ===== CP ===== */
    getCP(){ return Number(_stats.cp||0); },

    async setCP(next){
      _stats.cp = Math.max(0, Math.floor(Number(next||0)));
      _syncHUD();
      // 호환성: chainPoint도 동일값으로 저장
      await _save({ cp:_stats.cp, chainPoint:_stats.cp });
    },

    async addCP(delta=0){
      const add = Math.max(0, Math.floor(delta));
      if (add<=0) return this.getCP();
      return await this.setCP(this.getCP()+add);
    },

    async spendCP(amount=0){
      const need = Math.max(0, Math.floor(amount));
      if (need<=0) return true;
      const cur=this.getCP();
      if (cur<need) return false;
      await this.setCP(cur-need);
      return true;
    },

    /** 걷기 적립(하위호환): awardGP → CP로 누적 */
    async awardGP(gp=0){
      const add=Math.max(0,Math.floor(gp));
      if(add<=0) return this.getCP();
      return await this.addCP(add);
    },

    /* 체인 포인트(모의) — 유지(별도 표시용) */
    getChainTotal(){ return Number(localStorage.getItem('chain_total')||0); },
    setChainTotal(v){ localStorage.setItem('chain_total', String(Math.max(0, Math.floor(v||0)))); },
    async saveToChainMock(delta=0){
      const tot=this.getChainTotal()+Math.max(0,Math.floor(delta));
      this.setChainTotal(tot);
      return { total: tot };
    }
  };
})();

export default Score;
