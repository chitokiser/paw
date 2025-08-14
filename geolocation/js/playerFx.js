// /js/playerFx.js
import { swordWhoosh } from './audio.js';

/**
 * 플레이어 칼질 연출
 * @param {L.Map} map
 * @param {L.Marker} playerMarker
 * @param {number} targetLat
 * @param {number} targetLon
 * @param {boolean} withSound
 */
export function swingSwordAt(map, playerMarker, targetLat, targetLon, withSound = true){
  const el = playerMarker?.getElement();
  if (!el) return;
  const slash = el.querySelector('.slash');
  if (!slash) return;

  const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
  const p2 = map.latLngToLayerPoint(L.latLng(targetLat, targetLon));
  const angleDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;

  slash.style.setProperty('--angle', `${angleDeg - 90}deg`);
  slash.classList.remove('on'); void slash.offsetWidth;
  slash.classList.add('on');

  if (withSound) { try { swordWhoosh(); } catch {} }
}
