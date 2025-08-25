// /js/utils.js — 공용 유틸 (중복 선언/전역 의존 제거)


// ===== 기본 상수 =====
export const DEFAULT_ICON_PX  = 96;
export const DEFAULT_IMG      = "https://puppi.netlify.app/images/mon/1.png";   // 몬스터 기본
export const DEFAULT_USER_IMG = "../images/user/1.png";            // 평소
export const ATTACK_SPRITE_URL = "../images/user/act800x257.png";  // 공격(4프레임)

// ===== 내부 상태(플레이어 마커 바인딩) =====
let _playerMarker = null;
let _playerCSSInjected = false;

/** 플레이어 마커 등록: main.js에서 마커 생성 직후 1회 호출 */
export function bindPlayerMarker(marker) {
  _playerMarker = marker;

  // 회전/방향 전환용 스타일 (중복 주입 방지)
  if (!_playerCSSInjected) {
    const css = `
      .player-wrap { position: relative; }
      .player-wrap.face-right { transform: scaleX(1); }
      .player-wrap.face-left  { transform: scaleX(-1); }

      /* 회전 애니메이션이 필요한 경우 */
      .player-img { transition: transform .15s ease; will-change: transform; }

      /* (선택) 베기 이펙트용 가이드 */
      .player-wrap .slash{
        position:absolute; inset:0; pointer-events:none; display:none;
      }
    `;
    const s = document.createElement('style');
    s.id = 'utils-player-facing-css';
    s.textContent = css;
    document.head.appendChild(s);
    _playerCSSInjected = true;
  }

  // divIcon의 루트에 class 부여
  queueMicrotask(() => {
    const el = _playerMarker?._icon;
    if (el) {
      el.classList.add('player-icon-root');
    }
  });
}

// ===== 아이콘 생성 =====
/** 몬스터 아이콘(divIcon) */
export function makeImageDivIcon(url, sizePx) {
  const s = Math.round(Math.max(24, Math.min(Number(sizePx) || DEFAULT_ICON_PX, 256)));
  const safe = (url && String(url).trim()) ? String(url).trim() : DEFAULT_IMG;
  const html = `
    <div class="mon-wrap" style="width:${s}px; height:${s}px;">
      <img class="mon-img" src="${safe}" alt="monster"
           onerror="this.onerror=null; this.src='${DEFAULT_IMG}';" />
    </div>`;
  return L.divIcon({ className: '', html, iconSize: [s, s], iconAnchor: [s/2, s] });
}

/** 플레이어 아이콘(divIcon) */
export function makePlayerDivIcon(src = DEFAULT_USER_IMG, size = 48){
  const s = Math.max(32, Math.min(size, 128));
  const safe = (src && String(src).trim()) ? String(src).trim() : DEFAULT_USER_IMG;
  const html = `
    <div class="player-wrap face-right" style="width:${s}px;height:${s}px;position:relative;">
      <!-- 평소 이미지 -->
      <img class="player-img" src="${safe}" alt="player"
           onerror="this.onerror=null; this.src='${DEFAULT_USER_IMG}';"
           style="width:100%;height:100%;display:block;"/>

      <!-- 공격 스프라이트(기본 숨김) -->
      <div class="attack-sprite" 
           style="position:absolute;inset:0;display:none;"></div>

      <!-- 이펙트(SVG slash 등 쓰는 경우) -->
      <div class="slash"></div>
    </div>`;
  return L.divIcon({ className:'', html, iconSize:[s,s], iconAnchor:[s/2,s/2] });
}

// ===== 시간/ID/거리 유틸 =====
export function getChallengeDurationMs(power) {
  if (power === 40) return 10_000;
  if (power === 20) return 5_000;
  if (power === 10) return 2_000;
  const sec = Math.max(0.5, power / 4);
  return Math.round(sec * 1000);
}

export function getGuestId() {
  let id = localStorage.getItem('guestId');
  if (!id) {
    id = 'guest-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('guestId', id);
  }
  return id;
}

export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Leaflet이 있을 때는 이 쪽이 빠르고 정확
export function distanceToM(userLat, userLon, targetLat, targetLon) {
  return L.latLng(userLat, userLon).distanceTo(L.latLng(targetLat, targetLon));
}
export function isInRange(userLat, userLon, targetLat, targetLon, maxMeters = 10) {
  return distanceToM(userLat, userLon, targetLat, targetLon) <= maxMeters;
}

// ===== 바라보기(방향/회전) =====
/** 타깃(lat, lon)을 바라보도록 '좌/우 뒤집기' (픽셀/도트 스프라이트용) */
export function setFacingByTarget(map, playerMarker, targetLat, targetLon, spriteDefault='right') {
  const root = playerMarker?.getElement();
  if (!root) return;
  const wrap = root.querySelector('.player-wrap') || root;

  const p1 = map.latLngToLayerPoint(playerMarker.getLatLng());
  const p2 = map.latLngToLayerPoint(L.latLng(targetLat, targetLon));
  const towardRight = (p2.x - p1.x) > 2; // 좌/우 스냅

  const shouldFaceRight = (spriteDefault === 'right') ? towardRight : !towardRight;
  wrap.classList.toggle('face-right', shouldFaceRight);
  wrap.classList.toggle('face-left',  !shouldFaceRight);
}

/** latlng 객체 버전 */
export function setFacingByLatLng(map, playerMarker, latlng, spriteDefault='right') {
  setFacingByTarget(map, playerMarker, latlng.lat, latlng.lng, spriteDefault);
}

/** 내부: 방위각(도) — 북=0°, 시계방향 */
function _bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * 플레이어 아이콘을 '회전'시켜 타깃을 바라보게 함.
 * - bindPlayerMarker(marker)로 등록이 선행되어야 함
 * - PNG의 기본 방향이 오른쪽/위쪽일 때는 DEG 보정값을 써도 됨(아래 adjustDeg)
 */
export function setPlayerFacingTo(targetLat, targetLon, adjustDeg = 0) {
  if (!_playerMarker || !_playerMarker._icon) return;
  const cur = _playerMarker.getLatLng?.();
  if (!cur) return;
  const deg = _bearingDeg(cur.lat, cur.lng, targetLat, targetLon) + adjustDeg;
  const img = _playerMarker._icon.querySelector('.player-img');
  if (img) img.style.transform = `rotate(${deg}deg)`;
}

/** 플레이어 회전 초기화 */
export function resetPlayerFacing() {
  if (!_playerMarker || !_playerMarker._icon) return;
  const img = _playerMarker._icon.querySelector('.player-img');
  if (img) img.style.transform = '';
}
