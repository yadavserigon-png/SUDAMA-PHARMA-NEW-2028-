const env = require('../config/env');

/** Deliver an OTP / reset code via the configured provider hook. Returns { delivered } truthfully. */
async function sendMessage(channel, to, message) {
  if (!env.messagingWebhookUrl) {
    if (!env.isProd && env.nodeEnv !== 'test') console.log(`[messaging:dev] ${channel} to ${to}: ${message}`);
    return { delivered: false, reason: 'not_configured' };
  }
  try {
    const r = await fetch(env.messagingWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': env.messagingWebhookSecret },
      body: JSON.stringify({ channel, to, message }),
    });
    return { delivered: r.ok };
  } catch (e) {
    return { delivered: false, reason: e.message };
  }
}

module.exports = { sendMessage };
