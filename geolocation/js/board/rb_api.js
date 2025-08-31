// /geolocation/js/board/rb_api.js
import { db, auth, authReady } from "../firebase.js";
import {
  collection, query, orderBy, limit, onSnapshot,
  addDoc, serverTimestamp, doc, getDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const COL = "requirements";

export async function rb_authReady() { await authReady; return auth.currentUser || null; }

export async function rb_getMyLevel() {
  await rb_authReady();
  const u = auth.currentUser;
  if (!u) return 0;
  const d = await getDoc(doc(db, "users", u.uid));
  return d.exists() ? Number(d.data()?.level || 0) : 0;
}

export function rb_subscribe(onChange, opts = {}) {
  const q = query(
    collection(db, COL),
    orderBy("updatedAt", "desc"),
    limit(opts.limit || 50)
  );
  return onSnapshot(q, (snap)=>{
    const list = [];
    snap.forEach(d=> list.push({ id: d.id, ...d.data() }) );
    onChange(list);
  });
}

export async function rb_create({ title, body, tags = [] }) {
  await rb_authReady();
  const u = auth.currentUser;
  if (!u) throw new Error("로그인이 필요합니다.");
  const ref = await addDoc(collection(db, COL), {
    title: String(title || "").slice(0, 200),
    body: String(body || "").slice(0, 5000),
    tags: Array.isArray(tags) ? tags.slice(0, 10) : [],
    status: "open",
    authorUid: u.uid,
    authorName: u.email || u.uid.slice(0,6),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function rb_update(id, patch) {
  await rb_authReady();
  const ref = doc(db, COL, id);
  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
}

export async function rb_delete(id) {
  await rb_authReady();
  await deleteDoc(doc(db, COL, id));
}
