// /geolocation/js/score.js  (지갑주소 기반 · 게임 레벨 전용 SoT)
// - 블록체인 티어는 사용하지 않음(표시·저장 X)
// - 게임 레벨만 표시/저장하며, 파생값을 DB에 항상 주입:
//   HP = level * 1000, attack = level, maxHp = level * 1000

import { db } from './firebase.js';
import {
  doc, setDoc, updateDoc, onSnapshot,
  serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export const Score = (() => {
  let _hud = null;
  let _toast = (m)=>console.log('[toast]', m);
  const _listeners = new Set();
  let _unsub = null;

  // 세션 상태( uid = 지갑주소 소문자 )
  let _stats = {
    uid: null,          // <= wallet address (lowercase)
    level: 1,           // ✅ 게임 레벨 (티어 아님)
    hp: 1000,
    exp: 0,
    attack: 1,
    defense: 10,
    distanceM: 0,
    maxHp: 1000,
    cp: 0,              // 체인 포인트(오프체인 카운트)
  };

  /* ---------------- 공통 유틸 ---------------- */
  const keyOf = a => String(a||'').toLowerCase();

  async function getPassiveAddress(){
    try{
      if (window.ethereum?.selectedAddress) return keyOf(window.ethereum.selectedAddress);
      const accts = await window.ethereum?.request?.({ method:'eth_accounts' }) || [];
      return keyOf(accts[0]||'') || null;
    }catch{ return null; }
  }
  function getStoredAddress(){
    try{
      const s = sessionStorage.getItem('GH_WALLET') || localStorage.getItem('pf_wallet') || '';
      return keyOf(s) || null;
    }catch{ return null; }
  }
  async function resolveWalletAddress(){
    return getStoredAddress() || await getPassiveAddress();
  }

  function _derivedMaxHp(lv){ return Math.max(1, lv|0) * 1000; }
  function _getMaxHP(){
    const lv = Math.max(1, Number(_stats.level||1));
    const explicit = Number(_stats.maxHp);
    return Number.isFinite(explicit) && explicit > 0 ? explicit : _derivedMaxHp(lv);
  }

  function _syncHUDAndNotify(){
    try{
      const hpMax = _getMaxHP();
      const hpPct = Math.max(0, Math.min(100, (_stats.hp / hpMax) * 100));
      // ✅ HUD에는 게임 레벨만 전달 (혼동 방지)
      _hud?.set?.({
        gameLevel: _stats.level,    // 새 키
        level: _stats.level,        // 하위호환(기존 코드가 level 읽을 수 있게)
        hp: _stats.hp,
        hpMax,
        hpPct,
        exp: _stats.exp,
        attack: _stats.attack,
        defense: _stats.defense,
        distanceM: _stats.distanceM,
        cp: _stats.cp,
      });
    }catch{}
    _listeners.forEach(fn=>{ try{ fn({..._stats}); }catch{} });

    // (옵션) HP 바 DOM
    const fill = document.querySelector('.hud-hp-fill');
    const text = document.querySelector('.hud-hp-text');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, (_stats.hp/_getMaxHP())*100))}%`;
    if (text) text.textContent = `${_stats.hp} / ${_getMaxHP()}`;
  }

  /* ---------------- 게임 레벨 규칙 강제 주입 ---------------- */
  async function _enforceGameDerivedFields(addressLower, snapshotData){
    const ref = doc(db, 'users', addressLower);
    const d  = snapshotData || {};
    const lv = Math.max(1, Number(d.level ?? _stats.level ?? 1));

    const wantMaxHp = _derivedMaxHp(lv);
    const wantAtk   = lv;

    const curHp     = Number.isFinite(d.hp) ? Number(d.hp) : wantMaxHp;
    const curMaxHp  = Number.isFinite(d.maxHp) ? Number(d.maxHp) : wantMaxHp;
    const curAtk    = Number.isFinite(d.attack) ? Number(d.attack) : wantAtk;

    const need = {};
    if (curMaxHp !== wantMaxHp) need.maxHp = wantMaxHp;
    if (curAtk   !== wantAtk)   need.attack = wantAtk;

    // HP는 초과 시 컷, 미정의면 wantMaxHp
    const nextHp = Math.min(curHp, wantMaxHp);
    if (!Number.isFinite(d.hp) || nextHp !== curHp) need.hp = nextHp;

    if (Object.keys(need).length){
      need.updatedAt = serverTimestamp();
      try{ await updateDoc(ref, need); }catch(e){ console.warn('[Score] enforce save fail', e); }
    }

    // 로컬도 동기화
    _stats.level  = lv;
    _stats.maxHp  = wantMaxHp;
    _stats.attack = wantAtk;
    _stats.hp     = nextHp;
  }

  /* ---------------- Firestore I/O ---------------- */
  async function _ensureUserDoc(addrLower){
    const ref = doc(db, 'users', addrLower);
    const snap = await getDoc(ref);
    if (!snap.exists()){
      const lv = 1;
      await setDoc(ref, {
        address: addrLower,
        level: lv,
        hp: lv * 1000,          // ✔ HP = 레벨×1000
        maxHp: lv * 1000,
        exp: 0,
        attack: lv,             // ✔ 공격력 = 레벨
        defense: 10,
        distanceM: 0,
        cp: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge:true });
    } else {
      await _enforceGameDerivedFields(addrLower, snap.data()||{});
    }
  }

  async function _save(partial){
    if (!_stats.uid) return;
    try{
      await updateDoc(doc(db,'users', _stats.uid), { ...partial, updatedAt: serverTimestamp() });
    }catch{
      await setDoc(
        doc(db,'users', _stats.uid),
        { ...partial, address:_stats.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge:true }
      );
    }
  }

  function _subscribe(addrLower){
    if (_unsub){ try{_unsub();}catch{} _unsub=null; }
    if (!addrLower) return;
    const ref = doc(db, 'users', addrLower);
    _unsub = onSnapshot(ref, async (ss)=>{
      const p = ss.data?.() || ss.data() || {};
      // 먼저 규칙 주입/보정
      await _enforceGameDerivedFields(addrLower, p);

      // 파생 반영된 _stats 기준으로 나머지 필드 동기화
      _stats.uid       = addrLower;
      _stats.exp       = Number(p.exp ?? _stats.exp ?? 0);
      _stats.defense   = Number(p.defense ?? 10);
      _stats.distanceM = Number(p.distanceM ?? 0);
      _stats.cp        = Number(p.cp ?? 0);

      _syncHUDAndNotify();
    }, (e)=>console.warn('[Score] onSnapshot error', e));
  }

  async function _bindTo(addr){
    const a = keyOf(addr);
    if (!a) return null;
    _stats.uid = a;
    await _ensureUserDoc(a);
    _subscribe(a);
    return a;
  }

  // EVM 이벤트에 맞춰 자동 리바인딩
  try{
    if (window.ethereum?.on){
      window.ethereum.on('accountsChanged', async (list=[])=>{
        const a = keyOf(list[0]||'');
        if (!a) return;
        await _bindTo(a);
      });
      window.ethereum.on('chainChanged', async ()=>{ /* 필요 시 체인 검사 */ });
    }
    window.addEventListener?.('pf:modeChanged', async ()=>{
      const a = keyOf(sessionStorage.getItem('GH_WALLET') || '');
      if (a) await _bindTo(a);
    });
  }catch{}

  /* ---------------- 공개 API ---------------- */
  return {
    /** 지갑주소 기반 초기화(지갑 미연결 시에도 호출 OK) */
    async init({ toast } = {}){
      if (typeof toast === 'function') _toast = toast;
      const a = await resolveWalletAddress();
      if (a) await _bindTo(a);
      else _toast?.('지갑을 연결해 주세요.');
      _syncHUDAndNotify();
    },

    /** Connect 후 외부에서 바인딩 */
    async bindWallet(address){
      return await _bindTo(address || await resolveWalletAddress());
    },

    attachToHUD(hud){ _hud = hud; _syncHUDAndNotify(); },
    onChange(fn){ if (typeof fn==='function') _listeners.add(fn); return ()=>_listeners.delete(fn); },
    getStats(){ return _stats; },

    /* ===== 게임 레벨 직접 설정(관리자/디버그용) ===== */
    async setGameLevel(nextLevel){
      const lv = Math.max(1, Number(nextLevel||1));
      const wantMaxHp = _derivedMaxHp(lv);
      await _save({
        level: lv,
        attack: lv,           // ✔ 공격력=레벨
        maxHp: wantMaxHp,     // ✔ HP/MaxHp = 레벨×1000
        hp: wantMaxHp
      });
    },

    /* ===== HP ===== */
    async setHP(next){
      const max = _getMaxHP();
      _stats.hp = Math.max(0, Math.min(Number(next||0), max));
      _syncHUDAndNotify();
      await _save({ hp:_stats.hp, maxHp:max });
    },
    async deductHP(amount=1){
      const dmg = Math.max(1, Math.floor(amount));
      await this.setHP(Math.max(0, Number(_stats.hp||0) - dmg));
      if (_stats.hp <= 0){
        try{ await this.setCP(0); _toast?.('사망: CP가 0으로 리셋되었습니다.'); }catch{}
        const respawnHP = _getMaxHP();
        await this.setHP(respawnHP);
      }
    },

    /* ===== EXP & LV (레벨업 시 규칙 자동 주입) ===== */
    async addExp(amount=0){
      const add = Math.max(0, Math.floor(amount));
      let newExp = Number(_stats.exp||0) + add;

      const need = (_stats.level + 1) * 20000;   // 다음 레벨 × 20000
      let leveled = false;
      if (newExp >= need){
        const lv = _stats.level + 1;
        const wantMaxHp = _derivedMaxHp(lv);
        _stats.level = lv;
        _stats.attack = lv;                      // ✔ 공격력=레벨
        _stats.maxHp  = wantMaxHp;               // ✔ HP/MaxHp = 레벨×1000
        _stats.hp     = wantMaxHp;               // 레벨업 시 풀 회복
        newExp = 0;
        leveled = true;
      }

      _stats.exp = newExp;
      _syncHUDAndNotify();
      await _save({
        exp: _stats.exp, level: _stats.level,
        attack: _stats.attack, hp: _stats.hp, maxHp: _stats.maxHp
      });

      if (add>0) _toast?.(`EXP +${add}${leveled?' (레벨업!)':''}`);
    },

    /* ===== CP ===== */
    getCP(){ return Number(_stats.cp||0); },
    async setCP(next){
      _stats.cp = Math.max(0, Math.floor(Number(next||0)));
      _syncHUDAndNotify();
      await _save({ cp:_stats.cp });
    },
    async addCP(delta=0){
      const add = Math.max(0, Math.floor(delta));
      if (add<=0) return this.getCP();
      return await this.setCP(this.getCP() + add);
    },
    async spendCP(amount=0){
      const need = Math.max(0, Math.floor(amount));
      if (this.getCP() < need) return false;
      await this.setCP(this.getCP() - need);
      return true;
    },

    // 하위호환: 걷기 GP = CP 적립
    async awardGP(gp=0){ return await this.addCP(gp|0); }
  };
})();
export default Score;
