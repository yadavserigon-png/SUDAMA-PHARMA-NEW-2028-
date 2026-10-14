const { z } = require('zod');
const mongoose = require('mongoose');
const ApiError = require('./ApiError');

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const phone = z.string().trim().regex(/^(\+?91)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')
  .transform((v) => v.replace(/^\+?91/, ''));
const password = z.string().min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter').regex(/\d/, 'Password must contain a number');
const pincode = z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits');

/** Express middleware: validate req[source] against a zod schema and replace it with parsed data. */
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return next(new ApiError(400, details[0]?.message || 'Invalid input', details));
  }
  if (source === 'query') req.validQuery = result.data;
  else req[source] = result.data;
  next();
};

module.exports = { z, validate, objectId, phone, password, pincode };
