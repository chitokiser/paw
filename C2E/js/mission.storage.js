// mission.storage.js — Firestore save/load (missions + staff refs + user submissions)
import { db, auth } from "/geolocation/js/firebase.js";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs,
  query, orderBy, limit as qlimit
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

/** 현재 로그인 사용자의 users_uid.level 반환 (없으면 0) */
export async function getMyLevel() {
  if (!auth.currentUser) return 0;
  const snap = await getDoc(doc(db, "users_uid", auth.currentUser.uid));
  if (!snap.exists()) return 0;
  const d = snap.data() || {};
  return Number(d.level || 0);
}

/** ===== 미션2 메신저/연락처 & 메모 ===== */
export async function saveMission2(me, { kakao, telegram, zaloPhone, note }) {
  if (!auth.currentUser) throw new Error("로그인이 필요합니다.");
  const id = me.toLowerCase();
  const payload = {
    addr: id, kakao, telegram, zaloPhone, note,
    ownerUid: auth.currentUser.uid,
    ts: Date.now()
  };
  await setDoc(doc(db, "c2e_mission2_ids", id), payload, { merge: true });
}
export async function loadMission2(me) {
  if (!auth.currentUser) throw new Error("로그인이 필요합니다.");
  const snap = await getDoc(doc(db, "c2e_mission2_ids", me.toLowerCase()));
  return snap.exists() ? snap.data() : null;
}

/** ===== 유저 제출(미션별 단일 문서) ===== */
export async function saveUserSubmission(missionId, me, { note="", links=[] }) {
  if (!auth.currentUser) throw new Error("로그인이 필요합니다.");
  const id = `${me.toLowerCase()}_${missionId}`;
  const payload = {
    addr: me.toLowerCase(),
    missionId: String(missionId),
    note: String(note||""),
    links: Array.isArray(links) ? links : [],
    ownerUid: auth.currentUser.uid,
    ts: Date.now()
  };
  await setDoc(doc(db, "c2e_mission_user_submissions", id), payload, { merge: true });
}
export async function loadUserSubmission(missionId, me) {
  if (!auth.currentUser) throw new Error("로그인이 필요합니다.");
  const id = `${me.toLowerCase()}_${missionId}`;
  const snap = await getDoc(doc(db, "c2e_mission_user_submissions", id));
  return snap.exists() ? snap.data() : null;
}

/** ===== 운영자 참고 데이터(목록형, CRUD) =====
 * 컬렉션: c2e_mission_refs/{missionId}/items/{autoId}
 * 필드: { title, content, links[], updatedAt, authorUid }
 */
export async function loadStaffRefs(missionId, n=20) {
  const qref = query(
    collection(db, "c2e_mission_refs", String(missionId), "items"),
    orderBy("updatedAt", "desc"),
    qlimit(n)
  );
  const snap = await getDocs(qref);
  return snap.docs.map(d => ({ id: d.id, ...(d.data()||{}) }));
}

export async function createStaffRef(missionId, { title="", content="", links=[] }) {
  if (!auth.currentUser) throw new Error("로그인이 필요합니다.");
  const coll = collection(db, "c2e_mission_refs", String(missionId), "items");
  const data = {
    title: String(title||""),
    content: String(content||""),
    links: Array.isArray(links) ? links : [],
    updatedAt: Date.now(),
    authorUid: auth.currentUser.uid
  };
  return await addDoc(coll, data);
}

export async function updateStaffRef(missionId, itemId, { title, content, links }) {
  if (!auth.currentUser) throw new Error("로그인이 필요합니다.");
  const ref = doc(db, "c2e_mission_refs", String(missionId), "items", String(itemId));
  const patch = { updatedAt: Date.now() };
  if (typeof title   !== "undefined") patch.title   = String(title||"");
  if (typeof content !== "undefined") patch.content = String(content||"");
  if (typeof links   !== "undefined") patch.links   = Array.isArray(links) ? links : [];
  await updateDoc(ref, patch);
}

export async function deleteStaffRef(missionId, itemId) {
  if (!auth.currentUser) throw new Error("로그인이 필요합니다.");
  const ref = doc(db, "c2e_mission_refs", String(missionId), "items", String(itemId));
  await deleteDoc(ref);
}

/** 하단 기타 참고 메모(예: 페이지 공통) */
export async function saveNoteExtra(me, noteText) {
  if (!auth.currentUser) throw new Error("로그인이 필요합니다.");
  const id = me.toLowerCase();
  const payload = {
    noteExtra: noteText,
    ownerUid: auth.currentUser.uid,
    ts: Date.now()
  };
  await setDoc(doc(db, "c2e_mission2_ids", id), payload, { merge: true });
}
