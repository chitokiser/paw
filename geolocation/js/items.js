// /geolocation/js/items.js
import { spawnLightningAt, spawnRadialFlamesAt, spawnImpactAt } from './fx.js';
import { playThunderBoom, playAttackImpact } from './audio.js';
import { haversineM } from './utils.js';
import { getCurrentBattleTarget as _getCurrentBattleTarget } from './battle.js';
import { Score } from './score.js';

// rec(문서/마커/임시객체) → 전투 ctrl 해석
function resolveCtrl(rec, map){
  if (!rec) return null;
  // 1) 이미 ctrl이면
  if (rec.hit?.call) return rec;
  if (rec.battleCtrl?.hit) return rec.battleCtrl;

  // 2) ID로 전역 맵에서 찾기
  const keys = ['id','uid','docId','monsterId','_id'];
  for (const k of keys){
    const v = rec[k]; if (!v) continue;
    const c = window.__battleCtrlById?.get?.(v);
    if (c?.hit) return c;
  }

  // 3) 좌표 근접(<= 2m)로 추정
  const ll = rec.getLatLng?.() || (Number.isFinite(rec.lat)&&Number.isFinite(rec.lng)?{lat:rec.lat,lng:rec.lng}:null);
  if (ll && window.__battleCtrlById instanceof Map){
    for (const c of window.__battleCtrlById.values()){
      try {
        if (!c || c.isDead?.()) continue;
        const cll = c.getLatLng?.(); if (!cll) continue;
        const d = map?.distance?.(ll, cll) ?? haversineM(ll.lat, ll.lng, cll.lat, cll.lng);
        if (d <= 2) return c;
      } catch {}
    }
  }
  return null;
}

export async function useItem(id, ctx = {}) {
  const {
    map, inv, toast,
    getCurrentBattleTarget = _getCurrentBattleTarget,
    player,               // {lat,lng} (옵션)
    getNearbyHostiles,    // (옵션) radiusM => rec[] 반환
    damageEach,           // (옵션) 오버라이드
    radiusM               // (옵션) 오버라이드
  } = ctx;

  /* ─────────────────────────── ⚡ 번개 소환 ─────────────────────────── */
  if (id === 'lightning_summon' || id === 'lightning_talisman' || id === '벼락소환') {
    try {
      const tgt =
        (typeof getCurrentBattleTarget === 'function' ? getCurrentBattleTarget() : null) ||
        window.__currentBattleTarget || window.__battleCtrlLast || null;

      if (!tgt || tgt.isDead?.()) { toast?.('대상이 없습니다. 몬스터를 먼저 지정하세요.'); return false; }

      const ll = tgt.getLatLng?.();
      if (!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) {
        toast?.('대상 좌표를 찾지 못했습니다.'); return false;
      }

      try { spawnLightningAt(map, ll.lat, ll.lng, { flashScreen: true, shake: true }); } catch {}
      try { playThunderBoom({ intensity: 1.2 }); } catch {}

      await tgt.hit?.(1000, { lightning: true, crit: true });
      await inv?.useItem?.('lightning_summon', 1);
      toast?.('⚡ 벼락소환! 대상에게 1000 데미지');
      return true;
    } catch (e) {
      console.warn('[lightning item] use error', e);
      toast?.('아이템 사용에 실패했습니다.');
      return false;
    }
  }
/* ─────────────────────────── ❤️ 빨간물약(HP +50) ─────────────────────────── */
  if (id === 'red_potion' || id === 'hp_potion' || id === '빨간물약') {
    try {
      const s = Score.getStats?.() || {};
      const hpMax = Number(s.maxHp ?? s.hpMax ?? (s.level ? s.level * 1000 : 1000));
      const curHP = Math.max(0, Number(s.hp ?? 0));
      const HEAL  = 50;
      const newHP = Math.min(hpMax, curHP + HEAL);

      await Score.setHP?.(newHP);
      try { Score.updateHPUI?.(); } catch {}

      // 작게 임팩트(플레이어 위치)
      try {
        const pLL = (player && Number.isFinite(player.lat) && Number.isFinite(player.lng))
          ? player
          : (window.__playerMarker?.getLatLng?.()
              ? { lat: window.__playerMarker.getLatLng().lat, lng: window.__playerMarker.getLatLng().lng }
              : null);
        if (pLL) spawnImpactAt?.(map, pLL.lat, pLL.lng);
      } catch {}

      await inv?.useItem?.(id, 1);
      toast?.(`빨간물약 사용! (+${newHP - curHP} HP)`);
      return true;
    } catch (e) {
      console.warn('[red_potion] fail', e);
      toast?.('물약 사용에 실패했습니다.');
      return false;
    }
  }


  /* ─────────────────────────── 💥 마제스틱 볼 ─────────────────────────── */
  if (id === 'majestic_ball' || id === 'majestic_orb' || id === '마제스틱볼') {
    try {
      const DMG = Number.isFinite(damageEach) ? Math.max(1, damageEach|0) : 500;   // 요구: -500
      const R   = Number.isFinite(radiusM) ? Math.max(1, radiusM|0) : 10;         // 요구: 10m

      // 0) 플레이어 위치
      const pLL = (player && Number.isFinite(player.lat) && Number.isFinite(player.lng))
        ? player
        : (window.__playerMarker?.getLatLng?.()
             ? { lat: window.__playerMarker.getLatLng().lat, lng: window.__playerMarker.getLatLng().lng }
             : (map?.getCenter?.() ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : null));
      if (!pLL) { toast?.('Player position not found.'); return false; }

      // 1) 이펙트 + 사운드
      try { await spawnRadialFlamesAt(map, pLL.lat, pLL.lng, { count: 18, radiusPx: 150, durationMs: 560, shake: true }); } catch {}
      try { playAttackImpact?.({ intensity: 1.35 }); } catch {}

      // 2) 대상군 수집
      const victims = []; const uniq = new Set();
      const pushVictim = (recOrCtrl) => {
        if (!recOrCtrl) return;
        const c = resolveCtrl(recOrCtrl, map) || null;
        if (c) {
          const key = c.id || c.uid || c.docId || c._leaflet_id;
          if (key && !uniq.has(key)) { uniq.add(key); victims.push({ ref:c, key }); }
          return;
        }
        const idKey = recOrCtrl.id || recOrCtrl.uid || recOrCtrl.docId || recOrCtrl.monsterId || recOrCtrl._id;
        if (idKey && !uniq.has(idKey)) { uniq.add(idKey); victims.push({ idOnly:idKey }); }
      };

      // (a) 제공된 근접검색 우선
      if (typeof getNearbyHostiles === 'function') {
        try { (getNearbyHostiles(R) || []).forEach(pushVictim); } catch {}
      }

      // (b) 폴백: 전역 ctrl 맵에서 거리 필터
      if (victims.length === 0 && (window.__battleCtrlById instanceof Map)) {
        const center = { lat: pLL.lat, lng: pLL.lng };
        for (const c of window.__battleCtrlById.values()) {
          if (!c || c.isDead?.()) continue;
          const ll = c.getLatLng?.(); if (!ll) continue;
          const d = map?.distance?.(center, ll) ?? haversineM(center.lat, center.lng, ll.lat, ll.lng);
          if (d <= R) pushVictim(c);
        }
      }

      // (c) 그래도 없으면 현재 타겟
      if (victims.length === 0) {
        const t = (typeof getCurrentBattleTarget === 'function' ? getCurrentBattleTarget() : null)
               || window.__currentBattleTarget || window.__lastHitMonster || null;
        pushVictim(t);
      }

      // 3) 피해 적용
      for (const v of victims) {
        try {
          if (v.ref?.hit) {
            await v.ref.hit(DMG, { aoe:true, fire:true });
          } else if (v.idOnly && typeof window.applyDamageToMonster === 'function') {
            await window.applyDamageToMonster(v.idOnly, DMG, { aoe:true, fire:true });
          } else {
            console.warn('Majestic Ball: rec.battleCtrl or hit method not found for monster', v.key || v.idOnly);
          }
        } catch (e) {
          console.warn('Majestic Ball: damage apply error', e);
        }
      }

      await inv?.useItem?.('majestic_ball', 1);
      toast?.(`💥 Majestic Flames! (-${DMG} to ${victims.length} target${victims.length>1?'s':''}, ${R}m)`);
      return true;
    } catch (e) {
      console.error('[majestic]', e);
      toast?.('Majestic Ball failed. Try again.');
      return false;
    }
  }

  // 기본(그 외 아이템)
  try { await inv?.useItem?.(id, 1); } catch {}
  return true;
}
