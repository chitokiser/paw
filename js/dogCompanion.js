// /geolocation/js/dogCompanion.js
import { makeImageDivIcon } from './utils.js';

export default class DogCompanion {
  constructor({
    map,
    lat,
    lon,
    dogUrl = '../images/user/dog.png',
    dogSize = 26,
    offsetM = 0.5,
    zIndexOffset = -5,
    barkUrl = '../sounds/puppybark.mp3',
    barkVolume = 0.9
  }){
    // 위치/지도
    this.map = map;
    this.userLat = lat;
    this.userLon = lon;
    this.facingDeg = 90; // 기본: 동쪽

    // 비주얼
    this.dogUrl = dogUrl;
    this.dogSize = dogSize;
    this.offsetM = offsetM;

    // 오디오
    this.barkUrl = barkUrl;
    this.barkVolume = barkVolume;
    this._barkAudio = null;

    // 마커 생성
    this.marker = L.marker([lat, lon], {
      icon: makeImageDivIcon(this.dogUrl, this.dogSize),
      interactive: false,
      zIndexOffset
    }).addTo(this.map);

    this._reposition();
  }

  /* === Public APIs === */
  update(lat, lon){
    this.userLat = lat;
    this.userLon = lon;
    this._reposition();
  }

  setFacingDeg(deg){
    this.facingDeg = ((deg % 360) + 360) % 360;
    this._reposition();
  }

  setFacingByTarget(userLat, userLon, targetLat, targetLon){
    const deg = bearingDeg(userLat, userLon, targetLat, targetLon);
    this.setFacingDeg(deg);
  }

  getMarker(){
    return this.marker;
  }

  warmBark(){
    try {
      this._ensureBark();
      this._barkAudio.play().then(()=>{
        this._barkAudio.pause();
        this._barkAudio.currentTime = 0;
      }).catch(()=>{ /* 사용자 제스처 전 재생 제한 무시 */ });
    } catch {}
  }

  playBark(){
    try {
      this._ensureBark();
      this._barkAudio.currentTime = 0;
      this._barkAudio.play();
    } catch {}
  }

  destroy(){
    try { this.map.removeLayer(this.marker); } catch {}
    this.marker = null;
    this._barkAudio = null;
  }

  /* === Internal === */
  _ensureBark(){
    if (!this._barkAudio){
      this._barkAudio = new Audio(this.barkUrl);
      this._barkAudio.preload = 'auto';
      this._barkAudio.volume = this.barkVolume;
    }
    return this._barkAudio;
  }

  _reposition(){
    if (this.userLat == null || this.userLon == null) return;
    const θ = (this.facingDeg + 90) * Math.PI/180; // ‘오른쪽’ = +90°
    const dx = Math.cos(θ) * this.offsetM;
    const dy = Math.sin(θ) * this.offsetM;
    const p = offsetLatLng(this.userLat, this.userLon, dx, dy);
    this.marker.setLatLng([p.lat, p.lon]);
  }
}

/* ===== Helpers ===== */
function offsetLatLng(lat, lon, dxM, dyM){
  const rad = Math.PI/180;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(lat*rad);
  return { lat: lat + (dyM / mPerDegLat), lon: lon + (dxM / mPerDegLon) };
}

function bearingDeg(lat1, lon1, lat2, lon2){
  const toRad = x=>x*Math.PI/180, toDeg = x=>x*180/Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ)*Math.cos(φ2);
  const x = Math.cos(φ1)*sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;

  function sin(v){ return Math.sin(v); } // inlined helper to keep style parity
}
