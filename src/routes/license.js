const express = require('express');
const router = express.Router();
const licenseController = require('../controllers/licenseController');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// Rotas públicas
router.post('/activate', licenseController.activate);

// Rotas protegidas
router.post('/validate', verifyToken, licenseController.validate);

// Rotas admin
router.post('/generate', verifyAdmin, licenseController.generate);

module.exports = router;
