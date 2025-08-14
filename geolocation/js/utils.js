// /js/utils.js
export const DEFAULT_ICON_PX = 96;
export const DEFAULT_IMG = "https://puppi.netlify.app/images/mon/1.png";

export function makeImageDivIcon(url, sizePx){
  const s = Math.round(Math.max(24, Math.min(Number(sizePx)||DEFAULT_ICON_PX, 256)));
  const safe = (url && String(url).trim()) ? String(url).trim() : DEFAULT_IMG;
  const html = `
    <div class="mon-wrap" style="width:${s}px; height:${s}px;">
      <img class="mon-img" src="${safe}" alt="monster"
           onerror="this.onerror=null; this.src='${DEFAULT_IMG}';" />
    </div>`;
  return L.divIcon({ className: '', html, iconSize: [s, s], iconAnchor: [s/2, s] });
}

export function makePlayerDivIcon(src="../images/mon/user.png"){
  const html = `
    <div class="player-wrap" style="width:48px;height:48px;position:relative;">
      <img class="player-img" src="${src}" alt="player" style="width:100%;height:100%;display:block;"/>
      <div class="slash"></div>
    </div>`;
  return L.divIcon({ className:'', html, iconSize:[48,48], iconAnchor:[24,24] });
}

export function getChallengeDurationMs(power){
  if (power === 40) return 10_000;
  if (power === 20) return 5_000;
  if (power === 10) return 2_000;
  const sec = Math.max(0.5, power / 4);
  return Math.round(sec * 1000);
}

export function getGuestId(){
  let id = localStorage.getItem('guestId');
  if(!id){ id = 'guest-' + Math.random().toString(36).slice(2,8); localStorage.setItem('guestId', id); }
  return id;
}

export function haversineM(lat1, lon1, lat2, lon2){
  const R = 6371000; const toRad = d => d * Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
export function isInRange(userLat, userLon, targetLat, targetLon, maxMeters = 10){
  const u = L.latLng(userLat, userLon); const t = L.latLng(targetLat, targetLon);
  return u.distanceTo(t) <= maxMeters;
}
export function distanceToM(userLat, userLon, targetLat, targetLon){
  return L.latLng(userLat, userLon).distanceTo(L.latLng(targetLat, targetLon));
}
