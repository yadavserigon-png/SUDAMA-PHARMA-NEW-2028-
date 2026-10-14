// Notifications: in-app records + optional WhatsApp (official Cloud API) when configured.
// Nothing here pretends to have sent a message: the channel status is recorded truthfully.
const Notification = require('../models/Notification');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const env = require('../config/env');

function normalizeWaNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  return d;
}

async function sendWhatsAppText(to, text, { userId, orderId, customerId } = {}) {
  if (!env.whatsapp.configured) return { sent: false, status: 'not_configured' };
  const url = `https://graph.facebook.com/${env.whatsapp.graphVersion}/${env.whatsapp.phoneNumberId}/messages`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.whatsapp.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizeWaNumber(to), type: 'text', text: { body: text.slice(0, 4000) } }),
    });
    const data = await resp.json().catch(() => ({}));
    const ok = resp.ok && data.messages?.[0]?.id;
    await WhatsAppMessage.create({
      waMessageId: data.messages?.[0]?.id, direction: 'out', to: normalizeWaNumber(to), type: 'text', text,
      status: ok ? 'sent' : 'failed', sentBy: userId, order: orderId, customer: customerId, raw: ok ? undefined : data,
    });
    return { sent: Boolean(ok), status: ok ? 'sent' : 'failed', error: ok ? undefined : data.error?.message };
  } catch (e) {
    return { sent: false, status: 'failed', error: e.message };
  }
}

/**
 * Note: business-initiated WhatsApp messages outside the 24-hour customer-care window require
 * pre-approved templates. Configure templates in Meta Business Manager before relying on this.
 */
async function notifyUser(user, { type, title, body, link, whatsapp = false, orderId }) {
  const channels = [{ name: 'in_app', status: 'stored' }];
  if (whatsapp && user?.phone) {
    const r = await sendWhatsAppText(user.phone, `${title}\n${body}`, { orderId, customerId: user._id });
    channels.push({ name: 'whatsapp', status: r.status, error: r.error });
  }
  return Notification.create({ user: user?._id, type, title, body, link, channels });
}

async function notifyStoreStaff(store, { type, title, body, link }) {
  return Notification.create({ store, audience: 'store_staff', type, title, body, link, channels: [{ name: 'in_app', status: 'stored' }] });
}

module.exports = { normalizeWaNumber, sendWhatsAppText, notifyUser, notifyStoreStaff };
