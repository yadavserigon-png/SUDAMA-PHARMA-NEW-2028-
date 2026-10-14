// WhatsApp Business Platform (Cloud API) webhook + employee inbox.
// Works only after the owner completes Meta Business verification and sets the env variables.
// Until then the site shows a clearly-labelled click-to-chat link and manual upload forms instead.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const MedicineRequest = require('../models/MedicineRequest');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ah = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { nextNumber } = require('../utils/sequence');
const { z, validate, objectId } = require('../utils/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PRIVATE_DIR } = require('../middleware/upload');
const { sendWhatsAppText, normalizeWaNumber } = require('../services/notify');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ apiConfigured: env.whatsapp.configured, clickToChat: `https://wa.me/${env.whatsapp.businessNumber}`, businessNumber: env.whatsapp.businessNumber });
});

// Meta webhook verification handshake
router.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && env.whatsapp.verifyToken && req.query['hub.verify_token'] === env.whatsapp.verifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

function validSignature(req) {
  if (!env.whatsapp.appSecret) return !env.isProd; // never accept unsigned webhooks in production
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !req.rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', env.whatsapp.appSecret).update(req.rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function downloadMedia(mediaId) {
  if (!env.whatsapp.configured) return null;
  const meta = await fetch(`https://graph.facebook.com/${env.whatsapp.graphVersion}/${mediaId}`, { headers: { Authorization: `Bearer ${env.whatsapp.token}` } }).then((r) => r.json());
  if (!meta?.url) return null;
  const allowed = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
  if (!allowed[meta.mime_type]) return null;
  const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${env.whatsapp.token}` } });
  if (!bin.ok) return null;
  const buf = Buffer.from(await bin.arrayBuffer());
  if (buf.length > env.maxUploadMb * 1024 * 1024) return null;
  const name = `wa-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${allowed[meta.mime_type]}`;
  fs.writeFileSync(path.join(PRIVATE_DIR, name), buf);
  return { path: name, mimetype: meta.mime_type };
}

router.post('/webhook', ah(async (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  const entries = req.body?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const st of v.statuses || []) {
        await WhatsAppMessage.updateOne({ waMessageId: st.id }, { status: st.status });
      }
      for (const m of v.messages || []) {
        if (await WhatsAppMessage.exists({ waMessageId: m.id })) continue; // Meta retries webhooks
        const from = normalizeWaNumber(m.from);
        const customer = await User.findOne({ phone: from.slice(-10) }).select('_id name').lean();
        let media;
        const mediaObj = m.image || m.document;
        if (mediaObj?.id) {
          try {
            const saved = await downloadMedia(mediaObj.id);
            media = { id: mediaObj.id, caption: mediaObj.caption, ...(saved || {}) };
          } catch (e) {
            media = { id: mediaObj.id, caption: mediaObj.caption };
          }
        }
        // Link to an open medicine request from the same number, or open a new one
        let request = await MedicineRequest.findOne({ phone: from.slice(-10), source: 'whatsapp', status: { $in: ['new', 'in_review', 'awaiting_customer', 'quoted'] } });
        const text = m.text?.body || mediaObj?.caption || '';
        if (!request) {
          request = await MedicineRequest.create({
            number: await nextNumber('request', 'SP-MR'), customer: customer?._id, name: v.contacts?.[0]?.profile?.name || customer?.name || 'WhatsApp customer',
            phone: from.slice(-10), text, source: 'whatsapp', files: media?.path ? [{ path: media.path, mimetype: media.mimetype, originalName: 'whatsapp-media' }] : [],
          });
        } else {
          if (media?.path) request.files.push({ path: media.path, mimetype: media.mimetype, originalName: 'whatsapp-media' });
          if (text) request.notes.push({ text: `Customer: ${text}` });
          if (request.status === 'awaiting_customer') request.status = 'in_review';
          await request.save();
        }
        await WhatsAppMessage.create({ waMessageId: m.id, direction: 'in', from, to: v.metadata?.display_phone_number, type: m.type, text, media, customer: customer?._id, request: request._id, raw: m });
      }
    }
  }
  res.sendStatus(200);
}));

// ---------- Employee inbox ----------
router.use(authenticate, requirePermission('whatsapp.manage', 'requests.manage'));

router.get('/threads', ah(async (req, res) => {
  const threads = await WhatsAppMessage.aggregate([
    { $addFields: { party: { $cond: [{ $eq: ['$direction', 'in'] }, '$from', '$to'] } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$party', last: { $first: '$$ROOT' }, unread: { $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'in'] }, { $eq: ['$handled', false] }] }, 1, 0] } } } },
    { $sort: { 'last.createdAt': -1 } },
    { $limit: 100 },
    { $project: { 'last.raw': 0 } },
  ]);
  res.json(threads);
}));

router.get('/threads/:phone', ah(async (req, res) => {
  const p = normalizeWaNumber(req.params.phone);
  const items = await WhatsAppMessage.find({ $or: [{ from: p }, { to: p }] }).select('-raw').populate('sentBy', 'name').sort('createdAt').limit(500).lean();
  await WhatsAppMessage.updateMany({ from: p, direction: 'in', handled: false }, { handled: true });
  res.json(items);
}));

router.post('/send', validate(z.object({ to: z.string().min(10).max(15), text: z.string().trim().min(1).max(4000), requestId: objectId.optional(), orderId: objectId.optional() })), ah(async (req, res) => {
  if (!env.whatsapp.configured) throw new ApiError(503, 'WhatsApp API is not configured. Use the click-to-chat link instead.');
  const r = await sendWhatsAppText(req.body.to, req.body.text, { userId: req.user._id, orderId: req.body.orderId });
  if (req.body.requestId) await MedicineRequest.updateOne({ _id: req.body.requestId }, { $push: { notes: { by: req.user._id, text: `WhatsApp sent (${r.status}): ${req.body.text}` } } });
  await audit(req, 'whatsapp.sent', 'WhatsAppMessage', req.body.to, { status: r.status });
  res.json(r);
}));

module.exports = router;
