// js/map_demo.js
import {
  db, userAddress, soundOn, SPEED_MIN_WALK, SPEED_MAX_WALK, SPEED_VEHICLE,
  RESUME_REQUIRE_SLOW_SAMPLES, PAUSE_REQUIRE_FAST_SAMPLES,
  bindUI, showEvent, getDistance, stepTowards, randInCircleMeters,
  pauseFor, clickSound, successSound, failureSound, barkSound
} from './config.js';

import {
  ensureUserDoc, awardGP, isCaught, setCaught, userStats
} from './db.js';

import {
  createMonsterSpriteDOM, setMonsterSpriteState, updateSpriteFacingFromMove
} from './sprites.js';

import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/* ───────────── Icons ───────────── */
const angryIcon = L.divIcon({ className:'angry-mon', html:'😡', iconSize:[32,32], iconAnchor:[16,16] });
const bunkerIcon= L.divIcon({ className:'bunker',   html:'🏰', iconSize:[28,28], iconAnchor:[14,14] });
const arrowIcon = L.divIcon({ className:'arrow',    html:'➳', iconSize:[24,24], iconAnchor:[12,12] });

/* ───────────── Projectiles ───────────── */
function fireArrow(map, from, targetLat, targetLon, durationMs=800){
  const start = { lat: from.lat, lon: from.lon };
  const end   = { lat: targetLat,  lon: targetLon };
  const marker = L.marker([start.lat, start.lon], { icon: arrowIcon, interactive:false }).addTo(map);
  const begin = Date.now();
  const timer = setInterval(()=>{
    const t = Math.min(1, (Date.now() - begin) / durationMs);
    const lat = start.lat + (end.lat - start.lat) * t;
    const lon = start.lon + (end.lon - start.lon) * t;
    marker.setLatLng([lat, lon]);
    if (t >= 1) {
      clearInterval(timer);
      const u = map.userMarker?.getLatLng();
      if (u){
        const dist = getDistance(lat, lon, u.lat, u.lng);
        if (dist <= 2){
          try{ failureSound.play().catch(()=>{});}catch{}
          pauseFor(5000, '💥 Monster hit — GP paused 5s');
        } else {
          showEvent('reward', '💨 Attack missed', 0);
        }
      }
      map.removeLayer(marker);
    }
  }, 30);
}

/* ───────────── Main initialize ───────────── */
async function initialize(){
  await ensureUserDoc();
  bindUI();

  const map=L.map('map',{maxZoom:22}).setView([41.6955932,44.8357820],19);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  // UI handlers
  const locateBtn=document.getElementById('locateBtn');
  if(locateBtn){ locateBtn.onclick=()=>navigator.geolocation.getCurrentPosition(p=>map.setView([p.coords.latitude,p.coords.longitude],19)); }
  const homeBtn=document.getElementById('homeBtn'); if(homeBtn){ homeBtn.onclick=()=>location.href='/geolocation/geohome.html'; }
  const soundToggle=document.getElementById('soundToggle'); if(soundToggle){ soundToggle.onclick=()=>{ window._soundOn=!window._soundOn; soundToggle.textContent=window._soundOn?'🔊':'🔇'; }; }
  window._soundOn = soundOn;

  // Bunkers
  const bunkers=[]; try{
    const bq = await getDocs(collection(db,'bunkers'));
    if (!bq.empty){
      bq.forEach(s=>{
        const b = s.data();
        bunkers.push({
          lat:Number(b.lat), lon:Number(b.lon),
          range:Number(b.range ?? 5), cooldownMs:Number(b.cooldownMs ?? 4000),
          arrowSpeed:Number(b.arrowSpeed ?? 40), lastShot:0, marker:null
        });
      });
    }
  }catch(e){ console.warn('bunkers read failed', e); }
  if(bunkers.length===0){
    bunkers.push(
      { lat:41.69560, lon:44.83578, range:5, cooldownMs:4000, arrowSpeed:40, lastShot:0, marker:null },
      { lat:41.69565, lon:44.83583, range:5, cooldownMs:4000, arrowSpeed:40, lastShot:0, marker:null }
    );
  }
  bunkers.forEach(b=>{
    b.marker = L.marker([b.lat,b.lon],{icon:bunkerIcon}).addTo(map).bindPopup('🏰 Bunker');
    L.circle([b.lat,b.lon],{radius:b.range,color:'#ff3b30',fillOpacity:0.08}).addTo(map);
  });

  // Monsters
  const monsters=[];
  (await getDocs(collection(db,'monsters'))).forEach(s=>{
    const d=s.data();
    d.marker=null; d.caught=false; d._busy=false; d.angryUntil=0;
    d.baseLat=Number(d.lat); d.baseLon=Number(d.lon); d.lat=d.baseLat; d.lon=d.baseLon;
    d.patrolRadius=Number(d.patrolRadius ?? 8);
    d.speed=Number(d.speed ?? 1.2);
    d.aggroRange=Number(d.aggroRange ?? 12);
    d.attackRange=Number(d.attackRange ?? 6);
    d.attackCooldownMs=Number(d.attackCooldownMs ?? 3000);
    d.attackType=(d.attackType || 'melee');
    d.lastAttack=0;

    // 스프라이트 (단일 시트 사용 가능)
    const defaultSheet='/geolocation/sprites/1.png'; // puppi.netlify.app 기준
    d.walkImg=d.walkImg||defaultSheet; d.atkImg=d.atkImg||defaultSheet;
    d.walkFrames=Number(d.walkFrames ?? 6); d.walkFps=Number(d.walkFps ?? 8);
    d.atkFrames=Number(d.atkFrames ?? 4);   d.atkFps=Number(d.atkFps ?? 10);
    d.frameW=Number(d.frameW ?? 80);       d.frameH=Number(d.frameH ?? 80);
    d.rotOffset=Number(d.rotOffset ?? 0);
    d.walkOffsetY=Number(d.walkOffsetY ?? 0);
    d.atkOffsetY =Number(d.atkOffsetY  ?? d.frameH);

    d.state='patrol';
    d.patrolTarget=randInCircleMeters(d.baseLat,d.baseLon,d.patrolRadius);
    monsters.push(d);
  });

  // Center to first monster (if exists)
  if (monsters.length) map.setView([monsters[0].lat, monsters[0].lon], 18);

  /* user marker & path */
  let userCircle, first=true;
  let lastLat=null,lastLon=null,lastTs=null;
  let totalDistanceM=0, pendingForGP=0;
  const pathLatLngs=[]; const pathLine=L.polyline(pathLatLngs,{weight:5,opacity:0.8}).addTo(map);
  function updateUserMarker(lat,lon){
    const icon=L.icon({iconUrl:'/geolocation/sprites/face.png',iconSize:[80,80],iconAnchor:[16,16]});
    if(!map.userMarker){
      map.userMarker=L.marker([lat,lon],{icon}).addTo(map).bindPopup(`${userAddress}`);
      map.userMarker.on('click',()=>{ try{ barkSound.play().catch(()=>{});}catch{} });
    }else map.userMarker.setLatLng([lat,lon]);
    if(first){ map.setView([lat,lon],19); first=false; }
    if(userCircle) map.removeLayer(userCircle);
    userCircle=L.circle([lat,lon],{radius:50,color:'blue',fillOpacity:0.2}).addTo(map);
  }

  // Create monster marker (sprite)
  function ensureMonsterMarker(m){
    if (m.marker) return;
    const cfg = {
      walkImg:m.walkImg, walkFrames:m.walkFrames, walkFps:m.walkFps,
      atkImg:m.atkImg,   atkFrames:m.atkFrames,   atkFps:m.atkFps,
      frameW:m.frameW,   frameH:m.frameH,         rotOffset:m.rotOffset,
      walkOffsetY:m.walkOffsetY, atkOffsetY:m.atkOffsetY
    };
    const sprEl = createMonsterSpriteDOM(cfg);
    if (m.state === 'chase') sprEl.classList.add('mon-chase');
    const icon = L.divIcon({ className:'', html: sprEl.outerHTML, iconSize:[cfg.frameW,cfg.frameH], iconAnchor:[cfg.frameW/2,cfg.frameH/2] });
    m.marker = L.marker([m.lat, m.lon], { icon }).addTo(map);
    const root = m.marker.getElement(); m._spr = root ? root.querySelector('.sprite') : null;

    // click fight
    m._busy=false;
    m.marker.on('click', async ()=>{
      if(m.caught){ showEvent('lost','Monsters already caught',0); try{failureSound.play().catch(()=>{});}catch{}; return; }
      if(m._busy) return;
      m._busy=true;
      try{ clickSound.play().catch(()=>{});}catch{}
      try{
        if (await isCaught(m.mid)) {
          showEvent('lost','Monsters already caught',0);
          try{failureSound.play().catch(()=>{});}catch{};
          m.caught=true;
          if(m.marker){ map.removeLayer(m.marker); m.marker=null; }
        } else {
          const passed = await import('./config.js').then(mod => mod.tapChallenge(m.mid));
          if (!passed) {
            try{failureSound.play().catch(()=>{});}catch{}
            showEvent('lost','Not enough hits',0);
            m.angryUntil = Date.now() + 60_000;
            m._busy=false; return;
          }
          const myP = Math.max(1, Math.floor(userStats.totalGP*0.5 + (userStats.totalDistanceM||0)/1000));
          const enemyP = Math.max(1, Math.floor(Number(m.power??m.level??m.difficulty??((m.mid%10)+1))));
          const p = 1/(1+Math.exp(-(myP-enemyP)/3)); const pWin=Math.min(0.9,Math.max(0.1,p));
          const baseMin=Math.max(1,enemyP*2), baseMax=Math.max(baseMin,enemyP*6);
          const diff=myP-enemyP, scale= diff>=0 ? Math.max(0.8,1-diff*0.03) : Math.min(1.2,1-diff*0.01);
          const minR=Math.floor(baseMin*Math.min(1.1,Math.max(0.9,scale)));
          const maxR=Math.floor(baseMax*Math.min(1.1,Math.max(0.8,(diff<0?1.05:scale))));
          const success = Math.random()<pWin;
          const reward = success ? (minR + Math.floor(Math.random()*(maxR-minR+1))) : 0;
          if(success){
            const u = map.userMarker?.getLatLng();
            await awardGP(reward, u?.lat??m.lat, u?.lng??m.lon, Math.round((userStats.totalDistanceM||0)));
            await setCaught(m.mid);
            try{successSound.play().catch(()=>{});}catch{}
            showEvent('reward', `+${reward} GP (my ${myP} vs ${enemyP})`, reward);
            m.caught=true; if(m.marker){ map.removeLayer(m.marker); m.marker=null; }
          } else {
            try{failureSound.play().catch(()=>{});}catch{}
            showEvent('lost', `Failed (my ${myP} vs ${enemyP})`, 0);
          }
        }
      }catch(e){ console.warn(e); showEvent('lost','error occurred',0); try{failureSound.play().catch(()=>{});}catch{} }
      finally{ m._busy=false; }
    });
  }

  /* Geolocation */
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(p=>{
      lastLat=p.coords.latitude; lastLon=p.coords.longitude; lastTs=(typeof p.timestamp==='number')?p.timestamp:Date.now();
      updateUserMarker(lastLat,lastLon);
      pathLatLngs.push([lastLat,lastLon]); pathLine.setLatLngs(pathLatLngs);
    });
  }
  navigator.geolocation.watchPosition(async p=>{
    const {latitude:lat, longitude:lon, accuracy, speed:gpsSpeed}=p.coords;
    const ts=(typeof p.timestamp==='number')?p.timestamp:Date.now();
    if(typeof accuracy==='number' && accuracy>50) return;

    updateUserMarker(lat,lon);

    // speed filter
    let step=0, dt=0, calcSpeed=null;
    if(lastLat!==null && lastLon!==null && lastTs!==null){
      step=getDistance(lastLat,lastLon,lat,lon);
      dt=Math.max(0.001,(ts-lastTs)/1000);
      calcSpeed=step/dt;
    }
    const v=(typeof gpsSpeed==='number' && gpsSpeed>=0)?gpsSpeed:calcSpeed;
    if(v!==null){
      if(v>=SPEED_VEHICLE){
        window.fastStreak=(window.fastStreak||0)+1; window.slowStreak=0;
        if(!window.pausedBySpeed && window.fastStreak>=PAUSE_REQUIRE_FAST_SAMPLES){
          window.pausedBySpeed=true; showEvent('lost','🚫 Vehicle detected — GP paused',0);
        }
      }else if(v>=SPEED_MIN_WALK && v<=SPEED_MAX_WALK){
        window.slowStreak=(window.slowStreak||0)+1; window.fastStreak=0;
        if(window.pausedBySpeed && window.slowStreak>=RESUME_REQUIRE_SLOW_SAMPLES){
          window.pausedBySpeed=false; showEvent('reward','✅ Walking detected — GP resumed',0);
        }
      }else{ window.slowStreak=0; window.fastStreak=0; }
    }

    // bunkers
    const now=Date.now();
    bunkers.forEach(b=>{
      const dist=getDistance(lat,lon,b.lat,b.lon);
      if(dist<=b.range){
        if(now-(b.lastShot||0)>= (b.cooldownMs||4000)){
          b.lastShot=now;
          try{ clickSound.play().catch(()=>{});}catch{}
          showEvent('lost','🏹 Bunker fired!',0);
          const durationMs=Math.max(300,Math.min(1800,(dist/(b.arrowSpeed||40))*1000));
          fireArrow(map,{lat:b.lat,lon:b.lon},lat,lon,durationMs);
        }
      }
    });

    // path & GP
    if(lastLat!==null && lastLon!==null){
      if(step>0 && step<200){
        pathLatLngs.push([lat,lon]); pathLine.setLatLngs(pathLatLngs);
        if(!window.pausedBySpeed && Date.now() >= (window.pausedUntil||0)){
          totalDistanceM+=step; pendingForGP+=step;
          const units=Math.floor(pendingForGP/10);
          if(units>=1){
            try{
              await awardGP(units,lat,lon,Math.round(totalDistanceM));
              showEvent('reward',`+${units} GP (이동 ${units*10}m)`,units);
              pendingForGP=pendingForGP%10;
            }catch(e){ console.warn("GP award fail:",e); showEvent('lost','GP 적립 실패',0); }
          }
        }
      }
    }else{
      pathLatLngs.push([lat,lon]); pathLine.setLatLngs(pathLatLngs);
    }
    lastLat=lat; lastLon=lon; lastTs=ts;
  }, err=>console.error(err), {enableHighAccuracy:true});

  // ─────────── Game tick ───────────
  let lastTick=Date.now();
  setInterval(()=>{
    const now = Date.now();
    const dt = Math.min(0.25, (now - lastTick) / 1000); lastTick=now;
    const u = map.userMarker?.getLatLng(); const userLat=u?.lat, userLon=u?.lng;

    monsters.forEach(m=>{
      if(m.caught){ if(m.marker){ map.removeLayer(m.marker); m.marker=null; } return; }

      // distance to user
      let distToUser=Infinity; if(userLat!=null) distToUser = getDistance(m.lat,m.lon,userLat,userLon);
      if (distToUser <= 40) ensureMonsterMarker(m);
      if (distToUser > 50 && m.marker && !m._busy) { map.removeLayer(m.marker); m.marker=null; }

      const angry = m.angryUntil && now < m.angryUntil;
      if (angry) m.state='chase';
      else m.state = (distToUser <= m.aggroRange) ? 'chase' : 'patrol';

      const speed=m.speed; let prevPos=null; if(m.marker) prevPos=m.marker.getLatLng();
      if(m.state==='patrol'){
        const toTarget = getDistance(m.lat,m.lon,m.patrolTarget.lat,m.patrolTarget.lon);
        if (toTarget<1) m.patrolTarget=randInCircleMeters(m.baseLat,m.baseLon,m.patrolRadius);
        else { const step=stepTowards(m.lat,m.lon,m.patrolTarget.lat,m.patrolTarget.lon,speed*dt); m.lat=step.lat; m.lon=step.lon; }
      } else if (m.state==='chase' && userLat!=null){
        const step=stepTowards(m.lat,m.lon,userLat,userLon,speed*dt*1.5);
        m.lat=step.lat; m.lon=step.lon;
        if(distToUser <= m.attackRange && (now-(m.lastAttack||0)>=m.attackCooldownMs)){
          m.lastAttack=now; m._didAttackThisTick=true;
          if(m.attackType==='projectile'){
            const dur=Math.max(300,Math.min(1500,(distToUser/20)*1000));
            fireArrow(map,{lat:m.lat,lon:m.lon},userLat,userLon,dur);
            showEvent('lost',`💢 Monster #${m.mid} shoots!`,0);
          }else{
            try{failureSound.play().catch(()=>{});}catch{}
            pauseFor(5000,`💥 Monster #${m.mid} hit — GP paused 5s`);
          }
        }
      }
      if(m.marker){
        m.marker.setLatLng([m.lat,m.lon]);
        if(m._spr && prevPos){
          updateSpriteFacingFromMove(m._spr, prevPos.lat, prevPos.lng, m.lat, m.lon);
          if(m.state==='chase') m._spr.classList.add('mon-chase'); else m._spr.classList.remove('mon-chase');
          if(m._didAttackThisTick){ setMonsterSpriteState(m._spr,'attack'); m._didAttackThisTick=false; }
        }
      }
    });
  },100);
}

initialize();
