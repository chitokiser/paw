// /geolocation/js/authGate.js
import { auth } from './firebase.js';
import { sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

async function claimsOf(u){
  try { const r = await u.getIdTokenResult(); return r.claims || {}; }
  catch { return {}; }
}

export async function getAuthGate() {
  const u = auth.currentUser;
  if (!u) return { status: 'no-auth' };

  const prov = u.isAnonymous ? 'anonymous' : (u.providerData?.[0]?.providerId || 'custom');
  const claims = await claimsOf(u);
  const isWallet = (prov === 'custom') && (claims.wallet === true || typeof claims.addr === 'string');

  if (u.isAnonymous) return { status: 'guest', prov, emailVerified:false, isWallet:false };
  if (isWallet)      return { status: 'ok',    prov, emailVerified: !!u.emailVerified, isWallet:true };
  if (!u.emailVerified) return { status:'need-email-verify', prov, emailVerified:false, isWallet:false };
  return { status:'ok', prov, emailVerified:true, isWallet:false };
}

/** 모든 Firestore 쓰기 전에 호출 */
export async function assertCanWrite(){
  const u = auth.currentUser;
  if (!u) throw new Error('AUTH_REQUIRED');
  const gate = await getAuthGate();
  if (gate.status === 'guest') throw new Error('GUEST_FORBIDDEN');
  if (gate.status === 'need-email-verify') throw new Error('EMAIL_VERIFY_REQUIRED');
  return true;
}

/** UI에서 버튼 눌러 인증메일 발송 */
export async function requestEmailVerification(){
  const u = auth.currentUser;
  if (!u || !u.email) throw new Error('NO_EMAIL');
  await sendEmailVerification(u);
  return true;
}
