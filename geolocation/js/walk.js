// walk.js — 걷기 적립 전용 모듈 (10m 당 1점, 차량 이동 필터)
// 사용법 (main.js):
// import { WalkPoints } from "./walk.js";
// const walker = new WalkPoints({ toast });  // toast는 선택
// walker.start(); // 시작
// walker.stop();  // 중지(선택)

import { Score } from "./score.js";

export class WalkPoints {
  constructor({
    awardEveryMeters = 10,          // 10m 당 1점
    minSegmentMeters = 3,           // GPS 소음 제거: 3m 미만은 무시
    maxAccuracyMeters = 25,         // 정확도(오차 원) 25m 초과는 무시
    vehicleSpeedMs = 6.0,           // 6 m/s (~21.6 km/h) 초과는 차량 간주
    insaneSpeedMs = 12.0,           // 12 m/s 초과는 이상치(점프)로 폐기
    minDtSec = 1.0,                 // 샘플 간 최소 시간 간격(초)
    maxDtSec = 60.0,                // 너무 오래된 간격은 리셋
    geolocationOptions = { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
    toast = (msg)=>{},              // UI 토스트(선택)
  } = {}){
    this.cfg = {
      awardEveryMeters,
      minSegmentMeters,
      maxAccuracyMeters,
      vehicleSpeedMs,
      insaneSpeedMs,
      minDtSec,
      maxDtSec,
      geolocationOptions,
    };
    this.toast = toast;

    // 내부 상태
    this._watchId = null;
    this._prev = null;            // {lat, lon, t, acc}
    this._accumM = Number(localStorage.getItem('walk_accum_m') || 0); // 10m 미만 잔여 거리 축적
  }

  start(){
    if (this._watchId != null) return;
    // 첫 포인터 입력에 오디오/권한 등 깨우기(필요시)
    if (document.visibilityState === 'visible'){
      navigator.geolocation.getCurrentPosition(()=>{}, ()=>{}, this.cfg.geolocationOptions);
    }
    this._watchId = navigator.geolocation.watchPosition(
      (pos)=>this._onPos(pos),
      (err)=>{ /* 콘솔만 */ console.warn('[walk] geo error', err); },
      this.cfg.geolocationOptions
    );
    document.addEventListener('visibilitychange', this._onVis, false);
  }

  stop(){
    if (this._watchId != null){
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    document.removeEventListener('visibilitychange', this._onVis, false);
  }

  _onVis = ()=>{
    // 백/포그라운드 전환 시 이전 샘플 리셋(비정상 속도/점프 방지)
    if (document.visibilityState === 'visible'){
      this._prev = null;
    }
  }

  _onPos(pos){
    const { accuracy, latitude:lat, longitude:lon, speed } = pos.coords;
    const t = pos.timestamp ? pos.timestamp/1000 : performance.now()/1000;

    // 정확도 나쁜 샘플은 prev만 갱신하고 거리 계산 생략(브리징 방지)
    if (!isFinite(lat) || !isFinite(lon)){ return; }

    if (accuracy && accuracy > this.cfg.maxAccuracyMeters){
      this._prev = { lat, lon, t, acc: accuracy };
      return;
    }

    if (!this._prev){
      this._prev = { lat, lon, t, acc: accuracy||0 };
      return;
    }

    const dt = t - this._prev.t;
    if (!isFinite(dt) || dt <= this.cfg.minDtSec){
      // 너무 촘촘한 샘플은 무시(누적 X), prev 갱신은 허용
      this._prev = { lat, lon, t, acc: accuracy||0 };
      return;
    }
    if (dt > this.cfg.maxDtSec){
      // 너무 오래된 간격은 초기화
      this._prev = { lat, lon, t, acc: accuracy||0 };
      return;
    }

    const dM = haversineM(this._prev.lat, this._prev.lon, lat, lon);
    // 아주 작은 움직임은 노이즈로 판단
    if (dM < this.cfg.minSegmentMeters){
      this._prev = { lat, lon, t, acc: accuracy||0 };
      return;
    }

    // 속도 기반 필터: GPS 제공 speed가 있으면 우선 사용
    let v = dM / dt; // m/s
    if (isFinite(speed) && speed !== null){
      // 일부 브라우저는 speed가 null 또는 0일 수 있음
      if (speed > 0) v = Math.max(v, speed);
    }

    // 비정상 점프 제거
    if (v >= this.cfg.insaneSpeedMs){
      this._prev = { lat, lon, t, acc: accuracy||0 };
      return;
    }

    // 차량 이동 필터(오토바이/자동차)
    if (v > this.cfg.vehicleSpeedMs){
      // 차량으로 판단: 적립 없이 prev만 갱신 (브리징 방지 위해 prev는 갱신)
      this._prev = { lat, lon, t, acc: accuracy||0 };
      return;
    }

    // ---- 여기까지 통과하면 "걷기" 구간 ----
    this._accumM += dM;

    // 10m 당 1점 적립
    const step = this.cfg.awardEveryMeters;
    const gain = Math.floor(this._accumM / step);
    if (gain > 0){
      this._accumM -= gain * step;
      localStorage.setItem('walk_accum_m', String(this._accumM));

      // Score 모듈에 적립 (totalDistanceM은 Score 내부에서 +gp*10 처리됨)
      Score.awardGP(gain, lat, lon, Math.round(Score.getStats().totalDistanceM))
        .then(()=>{
          if (this.toast) this.toast(`+${gain} GP (걷기)`);
          // UI 갱신은 Score가 담당
          Score.updateEnergyUI?.();
        })
        .catch(err=>console.warn('[walk] award error', err));
    }else{
      // 잔여 거리만 저장(세션 유지)
      localStorage.setItem('walk_accum_m', String(this._accumM));
    }

    // prev 갱신
    this._prev = { lat, lon, t, acc: accuracy||0 };
  }

  // 상태 조회(디버그용)
  getState(){
    return {
      accumMeters: this._accumM,
      prev: this._prev
    };
  }
}

/* --------- 유틸: 두 좌표 간 거리(m) --------- */
function haversineM(lat1, lon1, lat2, lon2){
  const R = 6371000; // m
  const toRad = deg => deg * Math.PI/180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
