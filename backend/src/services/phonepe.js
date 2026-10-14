// PhonePe Payment Gateway provider.
//
// Default: Standard Checkout v2 (OAuth "client credentials" - what PhonePe issues to new merchants).
// Legacy: checksum-based pg/v1 API (salt key + index) for older merchant accounts.
// Set PHONEPE_API_VERSION=v2 or v1 in backend/.env to match the credentials PhonePe gave you,
// and verify every URL/field against the official docs at go-live (developer.phonepe.com).
//
// An order is marked PAID only after a server-to-server status check returns success for the
// exact amount - never because of a browser redirect, a screenshot or a customer claim.

const crypto = require('crypto');
const env = require('../config/env');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const cfg = () => env.phonepe;
const isV2 = () => cfg().apiVersion !== 'v1';

function configured() {
  return isV2() ? Boolean(cfg().clientId && cfg().clientSecret) : Boolean(cfg().merchantId && cfg().saltKey);
}

function fail(message, status = 502) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ---------------- v2 (OAuth) ----------------
let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: cfg().clientId,
    client_version: cfg().clientVersion,
    client_secret: cfg().clientSecret,
    grant_type: 'client_credentials',
  });
  const resp = await fetch(cfg().tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) throw fail('Could not authenticate with PhonePe. Check PHONEPE_CLIENT_ID / SECRET / VERSION.');
  tokenCache = { token: data.access_token, expiresAt: (data.expires_at ? data.expires_at * 1000 : Date.now() + 30 * 60000) };
  return tokenCache.token;
}

async function v2Initiate({ merchantTransactionId, amountPaise, redirectUrl }) {
  const token = await getToken();
  const resp = await fetch(`${cfg().pgBaseUrl}/checkout/v2/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${token}` },
    body: JSON.stringify({
      merchantOrderId: merchantTransactionId,
      amount: amountPaise,
      expireAfter: 1200,
      paymentFlow: { type: 'PG_CHECKOUT', message: 'Sudama Pharma order', merchantUrls: { redirectUrl } },
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.redirectUrl) throw fail(data?.message || 'Could not start PhonePe payment');
  return { redirectUrl: data.redirectUrl, providerOrderId: data.orderId, raw: data };
}

async function v2Status(merchantTransactionId) {
  const token = await getToken();
  const resp = await fetch(`${cfg().pgBaseUrl}/checkout/v2/order/${encodeURIComponent(merchantTransactionId)}/status`, {
    headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${token}` },
  });
  const data = await resp.json().catch(() => ({}));
  const state = data?.state;
  const lastPayment = (data?.paymentDetails || []).slice(-1)[0];
  return {
    success: state === 'COMPLETED',
    pending: state === 'PENDING' || !state,
    code: state,
    amountPaise: data?.amount,
    providerReference: lastPayment?.transactionId || data?.orderId,
    raw: data,
  };
}

// ---------------- v1 (checksum, legacy) ----------------
const xVerify = (data) => `${sha256(data + cfg().saltKey)}###${cfg().saltIndex}`;

async function v1Initiate({ merchantTransactionId, amountPaise, userId, mobile, redirectUrl, callbackUrl }) {
  const payload = {
    merchantId: cfg().merchantId, merchantTransactionId, merchantUserId: `U${String(userId).slice(-20)}`, amount: amountPaise,
    redirectUrl, redirectMode: 'REDIRECT', callbackUrl, mobileNumber: mobile, paymentInstrument: { type: 'PAY_PAGE' },
  };
  const base64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const resp = await fetch(`${cfg().v1BaseUrl}/pg/v1/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VERIFY': xVerify(`${base64}/pg/v1/pay`) }, body: JSON.stringify({ request: base64 }) });
  const data = await resp.json().catch(() => ({}));
  const url = data?.data?.instrumentResponse?.redirectInfo?.url;
  if (!resp.ok || !data.success || !url) throw fail(data?.message || 'Could not start PhonePe payment');
  return { redirectUrl: url, raw: data };
}

async function v1Status(merchantTransactionId) {
  const p = `/pg/v1/status/${cfg().merchantId}/${merchantTransactionId}`;
  const resp = await fetch(`${cfg().v1BaseUrl}${p}`, { headers: { 'Content-Type': 'application/json', 'X-VERIFY': xVerify(p), 'X-MERCHANT-ID': cfg().merchantId } });
  const data = await resp.json().catch(() => ({}));
  return { success: data?.success === true && data?.code === 'PAYMENT_SUCCESS', pending: data?.code === 'PAYMENT_PENDING', code: data?.code, amountPaise: data?.data?.amount, providerReference: data?.data?.transactionId, raw: data };
}

// ---------------- public interface ----------------
async function initiatePayment(args) {
  if (!configured()) throw fail('PhonePe is not configured yet. Add the merchant credentials to backend/.env after onboarding.', 503);
  return isV2() ? v2Initiate(args) : v1Initiate(args);
}

async function checkStatus(merchantTransactionId) {
  if (!configured()) return { success: false, pending: true, code: 'NOT_CONFIGURED' };
  return isV2() ? v2Status(merchantTransactionId) : v1Status(merchantTransactionId);
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Verify a server-to-server notification and return the merchant transaction id.
 * v2: Authorization header = SHA256("username:password") configured in the PhonePe dashboard.
 * v1: X-VERIFY = SHA256(base64Response + saltKey) + "###" + saltIndex.
 * The caller ALWAYS re-checks the status API afterwards; the webhook only triggers the check.
 */
function verifyWebhook(req) {
  if (!configured()) return { ok: false };
  if (isV2()) {
    if (!cfg().webhookUsername || !cfg().webhookPassword) return { ok: false };
    const expected = sha256(`${cfg().webhookUsername}:${cfg().webhookPassword}`);
    const got = String(req.headers.authorization || '').replace(/^SHA256\s+/i, '');
    if (!safeEqual(expected, got)) return { ok: false };
    const p = req.body?.payload || {};
    return { ok: true, merchantTransactionId: p.merchantOrderId || p.originalMerchantOrderId };
  }
  const base64 = req.body?.response;
  if (!base64 || !safeEqual(xVerify(base64), req.headers['x-verify'])) return { ok: false };
  try {
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    return { ok: true, merchantTransactionId: decoded?.data?.merchantTransactionId };
  } catch {
    return { ok: false };
  }
}

module.exports = { configured, initiatePayment, checkStatus, verifyWebhook, sha256 };
