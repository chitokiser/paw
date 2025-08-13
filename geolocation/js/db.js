// js/db.js
import {
  collection, addDoc, getDoc, doc, setDoc, updateDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { db, userAddress } from "./config.js";

export let userStats = { totalDistanceM: 0, totalGP: 0 };

export async function ensureUserDoc(){
  await setDoc(doc(db,'users',userAddress),{
    address: userAddress,
    totalDistanceM: 0,
    totalGP: 0,
    updatedAt: serverTimestamp()
  },{merge:true});
  const snap = await getDoc(doc(db,'users',userAddress));
  if (snap.exists()) {
    const d = snap.data();
    userStats.totalDistanceM = Number(d.totalDistanceM || 0);
    userStats.totalGP        = Number(d.totalGP || 0);
  }
}

export async function awardGP(gpUnits, lat, lon, totalDistanceM){
  if(gpUnits<=0) return;
  await addDoc(collection(db,'walk_logs'),{
    address:userAddress, gp:gpUnits, metersCounted:gpUnits*10,
    lat, lon, totalDistanceM, createdAt:serverTimestamp()
  });
  await updateDoc(doc(db,'users',userAddress),{
    totalGP:increment(gpUnits),
    totalDistanceM:increment(gpUnits*10),
    updatedAt:serverTimestamp()
  });
  userStats.totalGP        += gpUnits;
  userStats.totalDistanceM += gpUnits * 10;
}

export async function isCaught(mid){
  const key = `${userAddress}_${mid}`;
  const snap = await getDoc(doc(db,'caught',key));
  return snap.exists();
}
export async function setCaught(mid){
  const key = `${userAddress}_${mid}`;
  await setDoc(doc(db,'caught',key),{
    address:userAddress, mid, caughtAt:serverTimestamp()
  },{merge:true});
}
