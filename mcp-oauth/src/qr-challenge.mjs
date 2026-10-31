// Cross-device sign-in challenge primitives.
// This module deliberately does not issue sessions; callers must bind redemption to
// an initiator-held PKCE verifier and require a fresh authenticated approval.
export const QR_TTL_MS = 120000;
export const QR_ID = /^[a-f0-9]{64}$/;
export const QR_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export const QR_STATE = /^[a-f0-9]{64}$/;
export function qrState(row, now=Date.now()) {
  if (!row) return 'unknown';
  if (row.cancelled_at) return 'cancelled';
  if (row.consumed_at) return 'consumed';
  if (row.expires_at <= now) return 'expired';
  if (row.approved_at) return 'approved';
  return 'pending';
}
export function validateQrRequest(input) {
  return !!input && QR_CHALLENGE.test(input.challenge||'') && QR_STATE.test(input.state||'');
}
export async function createQrChallenge(db, digest, input, kind, now=Date.now()) {
  if (!validateQrRequest(input) || !['web','android'].includes(kind) || !QR_ID.test(digest) || !QR_ID.test(input.state_hash||'')) {
    throw new TypeError('Invalid QR challenge');
  }
  await db.prepare('INSERT INTO account_qr_logins(id_hash,initiator_kind,challenge,state_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)')
    .bind(digest,kind,input.challenge,input.state_hash,now,now+QR_TTL_MS).run();
  return {expires_at:now+QR_TTL_MS};
}
