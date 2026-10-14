const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/settings', require('./settings'));
router.use('/stores', require('./stores'));
router.use('/users', require('./users'));
router.use('/categories', require('./categories'));
router.use('/products', require('./products'));
router.use('/inventory', require('./inventory'));
router.use('/transfers', require('./transfers'));
router.use('/suppliers', require('./suppliers'));
router.use('/purchases', require('./purchases'));
router.use('/pos', require('./pos'));
router.use('/orders', require('./orders'));
router.use('/prescriptions', require('./prescriptions'));
router.use('/medicine-requests', require('./requests'));
router.use('/payments', require('./payments'));
router.use('/refunds', require('./refunds'));
router.use('/delivery', require('./delivery'));
router.use('/coupons', require('./coupons'));
router.use('/expenses', require('./expenses'));
router.use('/reports', require('./reports'));
router.use('/support', require('./support'));
router.use('/ads', require('./ads'));
router.use('/wholesale', require('./wholesale'));
router.use('/employees', require('./employees'));
router.use('/io', require('./importExport'));
router.use('/whatsapp', require('./whatsapp'));
router.use('/notifications', require('./notifications'));
router.use('/audit', require('./audit'));
router.use('/files', require('./files'));

module.exports = router;
