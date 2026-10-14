const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const PUBLIC_DIR = path.join(env.uploadDir, 'public');
const PRIVATE_DIR = path.join(env.uploadDir, 'private');
for (const d of [PUBLIC_DIR, PRIVATE_DIR]) fs.mkdirSync(d, { recursive: true });

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const DOC_TYPES = { ...IMAGE_TYPES, 'application/pdf': '.pdf' };
const SHEET_TYPES = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/csv': '.csv',
  'application/vnd.ms-excel': '.csv',
  'application/octet-stream': '',
};

function make(dir, types) {
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      // random names - never trust the client file name
      filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${types[file.mimetype] || ''}`),
    }),
    limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 10 },
    fileFilter: (req, file, cb) => {
      if (!(file.mimetype in types)) return cb(new ApiError(400, `File type ${file.mimetype} is not allowed`));
      cb(null, true);
    },
  });
}

const publicImageUpload = make(PUBLIC_DIR, IMAGE_TYPES); // product images, logos, ad creatives
const privateDocUpload = make(PRIVATE_DIR, DOC_TYPES); // prescriptions, KYC documents, receipts
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  const ok = /\.(xlsx|csv)$/i.test(file.originalname);
  cb(ok ? null : new ApiError(400, 'Upload an .xlsx or .csv file'), ok);
} });

const fileMeta = (f, kind = 'private') => ({
  path: f.filename,
  kind,
  originalName: f.originalname.slice(0, 200),
  mimetype: f.mimetype,
  size: f.size,
});

/** Validate magic bytes so a renamed executable cannot pass as an image/PDF. */
function verifyMagicBytes(filePath, mimetype) {
  const buf = Buffer.alloc(8);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  const hex = buf.toString('hex');
  if (mimetype === 'application/pdf') return buf.slice(0, 4).toString() === '%PDF';
  if (mimetype === 'image/png') return hex.startsWith('89504e47');
  if (mimetype === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mimetype === 'image/webp') return buf.slice(0, 4).toString() === 'RIFF';
  return false;
}

const checkFiles = (req, res, next) => {
  const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : req.file ? [req.file] : [];
  for (const f of files) {
    if (f.path && !verifyMagicBytes(f.path, f.mimetype)) {
      files.forEach((x) => x.path && fs.existsSync(x.path) && fs.unlinkSync(x.path));
      return next(new ApiError(400, 'Uploaded file content does not match its type'));
    }
  }
  next();
};

module.exports = { PUBLIC_DIR, PRIVATE_DIR, publicImageUpload, privateDocUpload, sheetUpload, fileMeta, checkFiles };
