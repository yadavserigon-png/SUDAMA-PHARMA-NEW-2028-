const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  if (isProd) {
    throw new Error('JWT_SECRET must be set (at least 32 characters) in production.');
  }
  jwtSecret = jwtSecret || 'dev-only-insecure-secret-change-me-0123456789';
  if (nodeEnv !== 'test') {
    console.warn('[env] JWT_SECRET missing/short - using a development-only secret. Never use this in production.');
  }
}

const list = (v, d = '') => (v || d).split(',').map((s) => s.trim()).filter(Boolean);

const env = {
  nodeEnv,
  isProd,
  port: parseInt(process.env.PORT || '5000', 10),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sudama_pharma_platform',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins: list(process.env.CORS_ORIGIN, 'http://localhost:5173'),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:5000',
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads')),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '8', 10),
  setupToken: process.env.SETUP_TOKEN || '',
  trustProxy: process.env.TRUST_PROXY === 'true',
  locationRetentionDays: parseInt(process.env.LOCATION_RETENTION_DAYS || '7', 10),
  phonepe: {
    apiVersion: process.env.PHONEPE_API_VERSION || 'v2',
    env: process.env.PHONEPE_ENV || 'UAT',
    // v2 (OAuth) credentials
    clientId: process.env.PHONEPE_CLIENT_ID || '',
    clientSecret: process.env.PHONEPE_CLIENT_SECRET || '',
    clientVersion: process.env.PHONEPE_CLIENT_VERSION || '1',
    webhookUsername: process.env.PHONEPE_WEBHOOK_USERNAME || '',
    webhookPassword: process.env.PHONEPE_WEBHOOK_PASSWORD || '',
    tokenUrl: process.env.PHONEPE_TOKEN_URL || (process.env.PHONEPE_ENV === 'PROD'
      ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token'),
    pgBaseUrl: process.env.PHONEPE_PG_BASE_URL || (process.env.PHONEPE_ENV === 'PROD'
      ? 'https://api.phonepe.com/apis/pg'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox'),
    // v1 (legacy checksum) credentials
    merchantId: process.env.PHONEPE_MERCHANT_ID || '',
    saltKey: process.env.PHONEPE_SALT_KEY || '',
    saltIndex: process.env.PHONEPE_SALT_INDEX || '1',
    v1BaseUrl: process.env.PHONEPE_V1_BASE_URL || (process.env.PHONEPE_ENV === 'PROD'
      ? 'https://api.phonepe.com/apis/hermes'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox'),
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v21.0',
    businessNumber: process.env.WHATSAPP_BUSINESS_NUMBER || '919264289295',
  },
};

env.phonepe.configured = env.phonepe.apiVersion === 'v1'
  ? Boolean(env.phonepe.merchantId && env.phonepe.saltKey)
  : Boolean(env.phonepe.clientId && env.phonepe.clientSecret);
env.whatsapp.configured = Boolean(env.whatsapp.token && env.whatsapp.phoneNumberId);

module.exports = env;

// Optional SMS/email delivery hook (e.g. an MSG91 / Twilio / SES relay you control).
// The API POSTs { channel, to, message } to this URL. If unset, codes are only shown in development.
env.messagingWebhookUrl = process.env.MESSAGING_WEBHOOK_URL || '';
env.messagingWebhookSecret = process.env.MESSAGING_WEBHOOK_SECRET || '';
