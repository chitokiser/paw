// /js/app.js
import { db } from './firebase.js';
import { ensureAudio, playFail, playDeath, playAttackImpact } from './audio.js';
import { injectCSS, toast, ensureHUD, setHUD, addStartGate } from './ui.js';
import {
  DEFAULT_IMG, makeImageDivIcon, makePlayerDivIcon,
  getChallengeDurationMs, getGuestId, haversineM, isInRange, distanceToM
} from './utils.js';

import { TowerGuard } from "./tower.js";
import { Score } from "./score.js";
import { WalkPoints } from "./walk.js";
import { MonsterGuard } from "./monster.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

import { ensureImpactCSS, spawnImpactAt, shakeMap, attachHPBar } from './fx.js';
import { swingSwordAt } from './playerFx.js';

injectCSS();
ensureImpactCSS();

let map, playerMarker;

async function main(){
  await Score.init({ db, getGuestId, toast, playFail });

  // HUD
  Score.attachToHUD(ensureHUD());
  setHUD({ chain: Score.getChainTotal() });
  Score.updateEnergyUI();
  Score.wireRespawn();

  // 지도
  map = L.map('map',{maxZoom:22}).setView([37.5665,126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  // 위치
  let userLat=null, userLon=null;
  await new Promise((res)=>{
    if (!navigator.geolocation){ res(); return; }
    navigator.geolocation.getCurrentPosition(
      p=>{ userLat=p.coords.latitude; userLon=p.coords.longitude; res(); },
      ()=>res(), {enableHighAccuracy:true, timeout:7000}
    );
  });
  if (userLat==null){ userLat=37.5665; userLon=126.9780; }

  // 플레이어 마커
  playerMarker = L.marker([userLat,userLon],{ icon: makePlayerDivIcon('../images/mon/user.png') }).addTo(map);
  map.setView([userLat,userLon], 19);

  const flashPlayer = () => {
    const el = playerMarker.getElement();
    if (!el) return;
    el.classList.remove('player-hit'); void el.offsetWidth;
    el.classList.add('player-hit');
  };

  // 이동 경로/거리
  const walkPath = L.polyline([[userLat,userLon]], { weight: 3, opacity: 0.9 }).addTo(map);
  let lastLat = userLat, lastLon = userLon;
  let totalWalkedM = Number(localStorage.getItem('ui_total_walk_m') || 0);
  setHUD({ distanceM: totalWalkedM });

  if (navigator.geolocation){
    navigator.geolocation.watchPosition(p=>{
      userLat=p.coords.latitude; userLon=p.coords.longitude;
      playerMarker.setLatLng([userLat,userLon]);

      walkPath.addLatLng([userLat, userLon]);
      if (Number.isFinite(lastLat) && Number.isFinite(lastLon)){
        const seg = haversineM(lastLat, lastLon, userLat, userLon);
        if (seg >= 0.5){
          totalWalkedM += seg;
          localStorage.setItem('ui_total_walk_m', String(totalWalkedM));
          setHUD({ distanceM: totalWalkedM });
        }
      }
      lastLat = userLat; lastLon = userLon;
    },()=>{}, {enableHighAccuracy:true});
  }

  // 걷기 적립
  const walker = new WalkPoints({ toast });
  walker.start();
  window.addEventListener('pagehide', ()=> walker?.stop());

  // 게이트
  let towers, monstersGuard;
  const IS_ADMIN = location.search.includes('admin=1') || localStorage.getItem('isAdmin') === '1';

  addStartGate(() => {
    try { ensureAudio(); } catch {}
    try { towers?.setUserReady(true); } catch {}
    try { monstersGuard?.setUserReady(true); } catch {}
  });

  // 타워
  towers = new TowerGuard({
    map, db,
    iconUrl: "https://puppi.netlify.app/images/mon/tower.png",
    rangeDefault: 60,
    fireCooldownMs: 1500,
    getUserLatLng: ()=>[userLat, userLon],
    onUserHit: (damage, towerInfo)=>{
      flashPlayer();
      Score.deductGP(damage, towerInfo.lat, towerInfo.lon);
      // spawnImpactAt(map, userLat, userLon);
      // playAttackImpact({ intensity: 0.9 });
    },
    isAdmin: IS_ADMIN
  });

  // 첫 포인터 시 오디오
  window.addEventListener('pointerdown', ()=>{
    try { ensureAudio(); } catch {}
    try { towers.resumeAudio(); } catch {}
    try { monstersGuard.resumeAudio(); } catch {}
  }, { once:true, passive:true });

  // 몬스터 자동 공격
  monstersGuard = new MonsterGuard({
    map, db,
    iconUrl: "https://puppi.netlify.app/images/mon/monster.png",
    rangeDefault: 50,
    fireCooldownMs: 1800,
    getUserLatLng: ()=>[userLat, userLon],
    onUserHit: (damage, mon)=>{
      flashPlayer();
      Score.deductGP(damage, mon.lat, mon.lon);
      // spawnImpactAt(map, userLat, userLon);
      // playAttackImpact({ intensity: 0.9 });
    },
    isAdmin: IS_ADMIN
  });

  // 클릭 전투용 몬스터 배치
  const monsters=[];
  try{
    const qs = await getDocs(collection(db,'monsters'));
    qs.forEach(s=>{
      const d=s.data();
      const sizePx = (()=>{ const n = Number(d.size); return Number.isNaN(n) ? 96 : Math.max(24, Math.min(n, 256)); })();
      monsters.push({
        id: s.id,
        mid: Number(d.mid),
        lat: Number(d.lat),
        lon: Number(d.lon),
        url: (d.imagesURL ?? d.imageURL ?? d.iconURL ?? DEFAULT_IMG),
        size: sizePx,
        power: Math.max(1, Number(d.power ?? 20))
      });
    });
  }catch(e){ console.warn('monsters load fail:', e); }

  if (monsters.length===0){
    monsters.push({ id:'test', mid:23, lat:userLat, lon:userLon, url:DEFAULT_IMG, size:96, power:20 });
  }

  monsters.forEach(m=>{
    const icon = makeImageDivIcon(m.url, m.size);
    const marker = L.marker([m.lat, m.lon], { icon, interactive: true }).addTo(map);

    // HP 바 초기화
    let hpLeft = Math.max(1, m.power);
    let hpUI = { set: ()=>{} };
    const initHP = ()=>{ hpUI = attachHPBar(marker, hpLeft); hpUI.set(hpLeft); };
    setTimeout(initHP, 0);

    let chal = null; // {remain, deadline, timer}
    let imgEl = null;

    const getImg = ()=>{
      if (imgEl && document.body.contains(imgEl)) return imgEl;
      const root = marker.getElement();
      imgEl = root ? root.querySelector('.mon-img') : null;
      return imgEl;
    };
    const stopChallenge = ()=>{
      if (chal?.timer){ clearInterval(chal.timer); }
      chal = null;
      setHUD({ timeLeft:'-', hitsLeft:'-', earn:m.power, chain: Score.getChainTotal() });
    };
    const updateHUD = ()=>{
      if (!chal) return;
      const leftMs = Math.max(0, chal.deadline - Date.now());
      const left = (leftMs/1000).toFixed(1) + 's';
      setHUD({ timeLeft:left, hitsLeft: chal.remain, earn: m.power });
    };

    async function win(){
      stopChallenge();
      const el = getImg(); if (el){ el.classList.add('mon-death'); }
      playDeath();
      const distM = Math.round(Score.getStats().totalDistanceM);
      await Score.awardGP(m.power, m.lat, m.lon, distM);
      Score.updateEnergyUI();
      const tx = await Score.saveToChainMock(m.power);
      setHUD({ chain: tx.total });
      toast(`+${m.power} GP! (tx: ${tx.txHash.slice(0,10)}…)`);
      setTimeout(()=>{ try{ map.removeLayer(marker); }catch{}; }, 900);
    }
    function fail(){
      stopChallenge(); playFail(); toast('실패… 다시 시도하세요');
    }

    marker.on('click', async ()=>{
      // 오디오 컨텍스트 보장
      let ac; try { ac = ensureAudio(); } catch {}

      // 사거리 가드
      if (!isInRange(userLat, userLon, m.lat, m.lon, 25)) {
        const d = Math.round(distanceToM(userLat, userLon, m.lat, m.lon));
        toast(`가까이 가세요! (현재 약 ${d}m)`); 
        playFail();
        return;
      }

      // 비주얼
      swingSwordAt(map, playerMarker, m.lat, m.lon, true);
      spawnImpactAt(map, m.lat, m.lon);
      shakeMap();

      // 사운드 (다음 프레임에)
      try {
        const runImpact = () => playAttackImpact({ intensity: 1.15 });
        if (ac && ac.state === 'running') requestAnimationFrame(runImpact);
        else setTimeout(runImpact, 40);
      } catch (e) { console.warn('attack SFX error:', e); }

      // 몬스터 히트 플래시
      const el = getImg();
      if (el){ el.classList.remove('mon-hit'); void el.offsetWidth; el.classList.add('mon-hit'); }

      // 전투 진행 로직
      if (!chal){
        const durationMs = getChallengeDurationMs(m.power);
        chal = { remain: Math.max(1, m.power), deadline: Date.now() + durationMs, timer: null };
        updateHUD();
        chal.timer = setInterval(()=>{
          if (!chal) return;
          if (Date.now() >= chal.deadline) fail();
          else updateHUD();
        }, 80);
      }

      if (Date.now() >= chal.deadline){ fail(); return; }

      // 데미지 적용 (HP/UI & HUD)
      chal.remain = Math.max(0, chal.remain - 1);
      hpLeft = Math.max(0, hpLeft - 1);
      hpUI.set(hpLeft);

      if (hpLeft <= 0) { await win(); }
      else { updateHUD(); }
    });
  });
}

main();
