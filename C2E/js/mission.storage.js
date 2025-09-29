// mission.storage.js — Firestore 저장/조회 (미션2, 운영자 참고, 내 제출, 유틸)
import { db, auth } from "/geolocation/js/firebase.js";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs,
  query, orderBy, limit as qlimit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/** ----------------------------------------------------------------------------
 *  공통: 인증 확보 (없으면 익명 로그인)
 *  - 보안규칙이 request.auth != null 인 경우를 통과시키기 위한 최소 인증
 *  - 필요 시 커스텀토큰/이메일로그인 등으로 대체 가능
 * ---------------------------------------------------------------------------*/
async function ensureAuth() {
  if (auth.currentUser) return auth.currentUser;
  await signInAnonymously(auth);
  return auth.currentUser;
}

/** (선택) 현재 로그인 사용자의 users_uid.level 반환 (없으면 0)
 *  - 페이지에서 레벨 표시/검증 용도로 사용
 */
export async function getMyLevel() {
  await ensureAuth();
  const snap = await getDoc(doc(db, "users_uid", auth.currentUser.uid));
  if (!snap.exists()) return 0;
  const d = snap.data() || {};
  return Number(d.level || 0);
}

/** ===== 미션2 연락처 저장/조회 =====
 * 컬렉션: c2e_mission2_ids/{lowercased_wallet}
 * 필드: { addr, kakao, telegram, zaloPhone, note, ownerUid, ts, noteExtra? }
 */
export async function saveMission2(me, { kakao, telegram, zaloPhone, note }) {
  await ensureAuth();
  const id = String(me || "").toLowerCase();
  if (!id) throw new Error("잘못된 지갑주소");
  const data = {
    addr: id,
    kakao: String(kakao || ""),
    telegram: String(telegram || ""),
    zaloPhone: String(zaloPhone || ""),
    note: String(note || ""),
    ownerUid: auth.currentUser.uid,
    ts: Date.now(),
  };
  await setDoc(doc(db, "c2e_mission2_ids", id), data, { merge: true });
}

export async function loadMission2(me) {
  await ensureAuth();
  const id = String(me || "").toLowerCase();
  if (!id) throw new Error("잘못된 지갑주소");
  const snap = await getDoc(doc(db, "c2e_mission2_ids", id));
  return snap.exists() ? snap.data() : null;
}

/** ===== “내 제출” 저장/조회 (미션별 단일 문서) =====
 * 컬렉션: c2e_mission_user_submissions/{addr_missionId}
 * 필드: { addr, missionId, note, links[], ownerUid, ts }
 */
export async function saveUserSubmission(missionId, me, { note = "", links = [] }) {
  await ensureAuth();
  const addr = String(me || "").toLowerCase();
  if (!addr) throw new Error("잘못된 지갑주소");
  const id = `${addr}_${String(missionId)}`;
  const data = {
    addr,
    missionId: String(missionId),
    note: String(note || ""),
    links: Array.isArray(links) ? links : [],
    ownerUid: auth.currentUser.uid,
    ts: Date.now(),
  };
  await setDoc(doc(db, "c2e_mission_user_submissions", id), data, { merge: true });
}

export async function loadUserSubmission(missionId, me) {
  await ensureAuth();
  const addr = String(me || "").toLowerCase();
  if (!addr) throw new Error("잘못된 지갑주소");
  const id = `${addr}_${String(missionId)}`;
  const snap = await getDoc(doc(db, "c2e_mission_user_submissions", id));
  return snap.exists() ? snap.data() : null;
}

/** ===== 운영자 참고 데이터(목록형, CRUD) =====
 * 컬렉션 계층: c2e_mission_refs/{missionId}/items/{autoId}
 * 필드: { title, content, links[], updatedAt, authorUid }
 */
export async function loadStaffRefs(missionId, n = 20) {
  // 규칙이 공개(read: true)라면 인증 없이도 동작하지만,
  // 일부 환경에서는 auth 필요할 수 있어 안전하게 auth 보장
  await ensureAuth();
  const qref = query(
    collection(db, "c2e_mission_refs", String(missionId), "items"),
    orderBy("updatedAt", "desc"),
    qlimit(Number.isFinite(n) ? n : 20)
  );
  const snap = await getDocs(qref);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

export async function createStaffRef(missionId, { title = "", content = "", links = [] }) {
  await ensureAuth();
  const coll = collection(db, "c2e_mission_refs", String(missionId), "items");
  const data = {
    title: String(title || ""),
    content: String(content || ""),
    links: Array.isArray(links) ? links : [],
    updatedAt: Date.now(),
    authorUid: auth.currentUser.uid,
  };
  return await addDoc(coll, data);
}

export async function updateStaffRef(missionId, itemId, { title, content, links }) {
  await ensureAuth();
  const ref = doc(db, "c2e_mission_refs", String(missionId), "items", String(itemId));
  const patch = { updatedAt: Date.now() };
  if (typeof title !== "undefined") patch.title = String(title || "");
  if (typeof content !== "undefined") patch.content = String(content || "");
  if (typeof links !== "undefined") patch.links = Array.isArray(links) ? links : [];
  await updateDoc(ref, patch);
}

export async function deleteStaffRef(missionId, itemId) {
  await ensureAuth();
  const ref = doc(db, "c2e_mission_refs", String(missionId), "items", String(itemId));
  await deleteDoc(ref);
}

/** ===== 페이지 하단 공용 메모 (옵션) =====
 * c2e_mission2_ids/{addr} 문서에 noteExtra 병합 저장
 */
export async function saveNoteExtra(me, noteText) {
  await ensureAuth();
  const id = String(me || "").toLowerCase();
  if (!id) throw new Error("잘못된 지갑주소");
  await setDoc(
    doc(db, "c2e_mission2_ids", id),
    { noteExtra: String(noteText || ""), ownerUid: auth.currentUser.uid, ts: Date.now() },
    { merge: true }
  );
}

// (디버깅/상태확인용) 현재 인증 사용자 반환
export function currentUser() {
  return auth.currentUser || null;
}
