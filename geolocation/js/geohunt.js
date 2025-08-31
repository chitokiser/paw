// /geolocation/js/geohunt.js
// - 걷기 적립(10m → 1CP)
// - Wallet-only: cp-sync.js의 window.__cp_addToday 훅을 통해 DB 반영
// - 게스트 모드 제거 (지갑/로그인 전이면 적립 시도 시 경고)

import { WalkPoints } from './walk.js';

// cp-sync.js 가 제공하는 전역 훅(필수)
const addTodayCP = async (d) => {
  if (typeof window.__cp_addToday !== 'function') {
    alert('먼저 지갑을 연결하고 로그인하세요.');
    throw new Error('__cp_addToday unavailable');
  }
  await window.__cp_addToday(d);
};

// 토스트 헬퍼(임베드용)
function toast(msg) {
  console.log('[GeoHunt]', msg);
  const el = document.getElementById('gh-log');
  if (el) el.textContent = msg;
}

// UI 마운트(있을 때만)
function mountEmbed(containerId = 'geohunt-embed') {
  const root = document.getElementById(containerId);
  if (!root) return false;

  root.innerHTML = `
    <div style="display:grid;gap:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:12px;opacity:.7">GeoHunt Mini</div>
          <div class="fw-bold">모드: Wallet</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="btnStart" class="btn btn-sm btn-grad">시작</button>
          <button id="btnStop"  class="btn btn-sm btn-outline-light">중지</button>
        </div>
      </div>
      <div id="gh-log" class="tiny">대기 중…</div>
    </div>
  `;

  // 바인딩
  document.getElementById('btnStart')?.addEventListener('click', () => {
    walker.start(); toast('걷기 추적 시작');
  });
  document.getElementById('btnStop')?.addEventListener('click', () => {
    walker.stop();  toast('걷기 추적 중지');
  });

  return true;
}

// 걷기 → CP 적립
const walker = new WalkPoints({
  awardEveryMeters: 10,
  saveToServer: 'throttle',
  flushIntervalMs: 7000,
  flushMinGP: 5,
  toast: async (m) => {
    // "+N GP"에서 숫자만 추출 → CP 반영
    const gained = parseInt(String(m).match(/\+(\d+)/)?.[1] || '0');
    if (gained > 0) {
      try { await addTodayCP(gained); }
      catch { /* 지갑/로그인 전이면 경고 후 무시 */ }
    }
    toast(m);
  }
});

// 퍼미션 워밍업(모바일 UX 개선)
if ('geolocation' in navigator) {
  navigator.geolocation.getCurrentPosition(
    () => {}, () => {},
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
  );
}

// 문서 로드시 #geohunt-embed가 있으면 자동 마운트
document.addEventListener('DOMContentLoaded', () => {
  mountEmbed('geohunt-embed');
});

// (선택) 외부에서 제어하고 싶으면 window API 노출
window.GeoHunt = {
  start: () => { walker.start(); toast('걷기 추적 시작'); },
  stop:  () => { walker.stop();  toast('걷기 추적 중지');  }
};
