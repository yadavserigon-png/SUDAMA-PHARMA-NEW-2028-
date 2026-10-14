const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const { PUBLIC_DIR } = require('./middleware/upload');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const routes = require('./routes');

function createApp() {
  const app = express();
  if (env.trustProxy) app.set('trust proxy', 1); // behind Render/Railway/Nginx so rate limits see real IPs

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin(origin, cb) {
      if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  }));
  app.use(compression());
  // keep raw body for webhook signature verification (WhatsApp)
  app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan(env.isProd ? 'combined' : 'dev'));

  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: env.nodeEnv === 'test' ? 100000 : 300, standardHeaders: 'draft-7', legacyHeaders: false }));

  // Only PUBLIC uploads (product images, logos, ad creatives) are static.
  // Prescriptions and KYC documents are served by /api/files with authorisation checks.
  app.use('/uploads/public', express.static(PUBLIC_DIR, { maxAge: '7d', index: false }));

  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'sudama-pharma-api', time: new Date().toISOString() }));
  app.use('/api', routes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
