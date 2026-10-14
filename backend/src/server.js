const env = require('./config/env');
const { connectDB } = require('./config/db');
const { createApp } = require('./app');

async function start() {
  await connectDB();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[api] Sudama Pharma API running on http://localhost:${env.port}  (env: ${env.nodeEnv})`);
    if (!env.phonepe.configured) console.log('[api] PhonePe not configured - online payments disabled until credentials are added.');
    if (!env.whatsapp.configured) console.log('[api] WhatsApp API not configured - click-to-chat fallback is used.');
  });
}

start().catch((e) => {
  console.error('[api] failed to start:', e.message);
  process.exit(1);
});
