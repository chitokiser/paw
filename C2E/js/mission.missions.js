// mission.missions.js — 원자적 렌더 + 중복 방지 + adprice=0인 미션 숨김(옵션)
import { api, getState } from "./mission.api.js";

// 렌더 후보 ID (필요한 범위로 조정)
const CANDIDATE_IDS = [1, 2, 3, 4, 5, 6, 7];

// adprice가 0이면 숨길지 여부
const HIDE_ZERO_ADPRICE = true;

// 동시 렌더 방지용 논스
let _renderNonce = 0;

export async function buildMissions({ wrap, onClaim, onBuffing, onM1 }) {
  const nonce = ++_renderNonce;

  // 1) 후보 ID별 adprice 읽고, 필요 시 필터링
  const items = [];
  for (const uiId of CANDIDATE_IDS) {
    try {
      const raw = await api.getAdPriceRaw(uiId); // BigInt
      const label = await api.getAdPriceLabel(uiId, 6);
      const isZero = (BigInt(raw) === 0n);
      if (HIDE_ZERO_ADPRICE && isZero) {
        // 가격이 0이면 숨김 (=> 2번부터 넣으셨다면 자동으로 2부터 뜸)
        continue;
      }
      items.push({ uiId, raw, label });
    } catch {
      // 조회 실패 시 건너뜀
    }
  }

  // 더 최신 렌더가 시작됐으면 종료
  if (nonce !== _renderNonce) return;

  // 2) 메모리에서 먼저 카드 구성
  const tpl = document.getElementById("tplMission");
  const frag = document.createDocumentFragment();
  const me = getState().me;

  for (const it of items) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.missionId = String(it.uiId);
    node.querySelector(".missionId").textContent = it.uiId;
    node.querySelector(".reward").textContent    = it.label;

    // 상태 표기
    const stEl = node.querySelector(".status");
    try {
      if (me) {
        const pending = await api.isPending(me, it.uiId);
        stEl.textContent = pending ? "심사 대기" : "미요청";
      } else {
        stEl.textContent = "지갑 미연결";
      }
    } catch {
      stEl.textContent = "확인 실패";
    }

    // 버튼
    const btns = node.querySelector(".btns");

    const bClaim = document.createElement("button");
    bClaim.className = "btn btn-sm btn-outline-light";
    bClaim.textContent = "보상 요구";
    bClaim.addEventListener("click", () => onClaim?.(it.uiId));
    btns.appendChild(bClaim);

    // (옵션) onBuffing 버튼을 특정 미션에만 보이게 하고 싶으면 조건 추가
    // if (onBuffing && it.uiId === 9999) { ... }

    frag.appendChild(node);
  }

  // 더 최신 렌더가 시작됐으면 종료
  if (nonce !== _renderNonce) return;

  // 3) 한 번에 교체 (중복/깜빡임 방지)
  wrap.replaceChildren(frag);

  // (옵션) 미션1 등록 버튼 바인딩
  if (onM1) {
    const b = document.getElementById("btnM1");
    b?.addEventListener("click", () => onM1());
  }
}
