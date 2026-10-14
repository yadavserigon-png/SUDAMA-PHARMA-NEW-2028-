const env = require('../config/env');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong';
  let details = err.details;

  if (err.name === 'ZodError') {
    status = 400;
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    message = details[0]?.message || 'Invalid input';
  } else if (err.name === 'ValidationError') {
    status = 400;
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    message = details[0]?.message || 'Invalid data';
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    message = `Duplicate value for ${Object.keys(err.keyValue || {}).join(', ') || 'a unique field'}`;
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 400;
    message = 'File is too large';
  }

  if (status >= 500) {
    console.error('[error]', err);
    if (env.isProd) message = 'Internal server error';
  }
  res.status(status).json({ error: message, details });
}

module.exports = { notFound, errorHandler };
