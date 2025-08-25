// /js/walk.js — 걷기 적립 전용 모듈 (10m 당 1점, 차량 이동 필터)
// 기본: DB 저장 안 함(로컬만). 필요시 saveToServer 옵션으로 제어.

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
    toast = (msg)=>{},
    // 저장 정책: 'none' | 'throttle' | 'immediate'
    // - 'none'      : DB 전혀 안 씀(로컬 only)  ← 기본
    // - 'throttle'  : 일정 주기/개수 모아서 저장
    // - 'immediate' : 적립 즉시 저장(권장 X)
    saveToServer = 'none',
    flushIntervalMs = 8000,         // throttle 주기
    flushMinGP = 5,                 // 모이면 저장
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
      saveToServer,
      flushIntervalMs,
      flushMinGP,
    };
    this.toast = toast;

    // 내부 상태
    this._watchId = null;
    this._prev = null; // {lat, lon, t, acc}
    this._accumM = Number(localStorage.getItem('walk_accum_m') || 0);

    // 배치 저장용
    this._pendingGP = 0;
    this._flushTimer = null;
    this._lastLat = 0;
    this._lastLon = 0;
  }

  start(){
    if (this._watchId != null) return;
    if (!('geolocation' in navigator)) return;

    // 권한/칩웜업
    if (document.visibilityState === 'visible'){
      navigator.geolocation.getCurrentPosition(()=>{}, ()=>{}, this.cfg.geolocationOptions);
    }
    this._watchId = navigator.geolocation.watchPosition(
      (pos)=>this._onPos(pos),
      ()=>{}, // 로그 출력 안 함
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
    // 남은 배치가 있으면 마무리
    this._flush(true);
  }

  _onVis = ()=>{
    if (document.visibilityState === 'visible'){
      this._prev = null;
    }
  }

  _onPos(pos){
    const { accuracy, latitude:lat, longitude:lon, speed } = pos.coords;
    const t = pos.timestamp ? pos.timestamp/1000 : performance.now()/1000;
    if (!isFinite(lat) || !isFinite(lon)) return;

    if (accuracy && accuracy > this.cfg.maxAccuracyMeters){
      this._prev = { lat, lon, t, acc: accuracy };
      return;
    }
    if (!this._prev){
      this._prev = { lat, lon, t, acc: accuracy||0 };
      return;
    }

    const dt = t - this._prev.t;
    if (!isFinite(dt) || dt <= this.cfg.minDtSec){ this._prev = { lat, lon, t, acc: accuracy||0 }; return; }
    if (dt > this.cfg.maxDtSec){ this._prev = { lat, lon, t, acc: accuracy||0 }; return; }

    const dM = haversineM(this._prev.lat, this._prev.lon, lat, lon);
    if (dM < this.cfg.minSegmentMeters){ this._prev = { lat, lon, t, acc: accuracy||0 }; return; }

    let v = dM / dt; // m/s
    if (isFinite(speed) && speed > 0) v = Math.max(v, speed);
    if (v >= this.cfg.insaneSpeedMs){ this._prev = { lat, lon, t, acc: accuracy||0 }; return; }
    if (v > this.cfg.vehicleSpeedMs){ this._prev = { lat, lon, t, acc: accuracy||0 }; return; }

    // ---- 걷기 인정 ----
    this._accumM += dM;

    const step = this.cfg.awardEveryMeters;
    const gain = Math.floor(this._accumM / step);
    if (gain > 0){
      this._accumM -= gain * step;
      localStorage.setItem('walk_accum_m', String(this._accumM));

      // 로컬 합산(서버 미사용 시 총합만 보관)
      const localTotal = Number(localStorage.getItem('walk_gp_total')||0) + gain;
      localStorage.setItem('walk_gp_total', String(localTotal));

      // UI
      if (this.toast) this.toast(`+${gain} GP (걷기)`);

      // 저장 정책
      this._lastLat = lat; this._lastLon = lon;
      if (this.cfg.saveToServer === 'immediate'){
        this._pendingGP += gain;
        this._flush(true);
      } else if (this.cfg.saveToServer === 'throttle'){
        this._pendingGP += gain;
        this._scheduleFlush();
      } else {
        // 'none' : DB 저장 안 함, 필요시 화면만 갱신
        Score.updateEnergyUI?.();
      }
    } else {
      localStorage.setItem('walk_accum_m', String(this._accumM));
    }

    this._prev = { lat, lon, t, acc: accuracy||0 };
  }

  _scheduleFlush(){
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(()=>{
      this._flush(false);
    }, this.cfg.flushIntervalMs);
  }

  async _flush(force){
    if (this._flushTimer){ clearTimeout(this._flushTimer); this._flushTimer = null; }
    if (this.cfg.saveToServer === 'none') { this._pendingGP = 0; return; }
    if (!force && this._pendingGP < this.cfg.flushMinGP) return;

    const gp = this._pendingGP; this._pendingGP = 0;
    if (gp <= 0) return;

    try{
      const distM = Math.round(Score.getStats().totalDistanceM);
      await Score.awardGP(gp, this._lastLat, this._lastLon, distM);
      Score.updateEnergyUI?.();
    }catch{
      // 실패해도 조용히 무시(로그 미출력)
    }
  }

  getState(){
    return {
      accumMeters: this._accumM,
      pendingGP: this._pendingGP,
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
