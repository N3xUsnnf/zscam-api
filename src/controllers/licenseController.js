const pool = require('../config/database');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Hash do device fingerprint
const hashDevice = (deviceId) => {
    return crypto.createHash('sha256').update(deviceId).digest('hex');
};

// Gerar token JWT
const generateToken = (licenseData) => {
    return jwt.sign(
        { 
            code: licenseData.code,
            deviceId: licenseData.device_id,
            expiresAt: licenseData.expires_at
        },
        process.env.JWT_SECRET,
        { expiresIn: '31d' }
    );
};

// POST /api/license/activate
exports.activate = async (req, res) => {
    const { 
        code, 
        device_id,
        device_systemVersion,
        device_model,
        device_IDFV,
        device_serialNumber,
        device_UUID,
        device_macAddress
    } = req.body || {};
    
    if (!code || !device_id) {
        return res.status(400).json({ error: 'Código e device_id são obrigatórios' });
    }
    
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Bloqueia a licença durante o fluxo para evitar corridas
        const result = await client.query(
            'SELECT * FROM licenses WHERE code = $1 FOR UPDATE',
            [code.toUpperCase()]
        );
        
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Código de licença inválido' });
        }
        
        const license = result.rows[0];
        const deviceHash = hashDevice(device_id);
        
        // Verificar se já está ativada
        if (license.status === 'active') {
            if (license.device_fingerprint !== deviceHash) {
                await client.query('ROLLBACK');
                return res.status(403).json({ 
                    error: 'Esta licença já está ativada em outro dispositivo' 
                });
            }
            
            const token = generateToken(license);
            await client.query('COMMIT');
            return res.json({
                success: true,
                token,
                expires_at: license.expires_at,
                server_time: new Date().toISOString(),
                message: 'Licença já ativada neste dispositivo'
            });
        }
        
        if (new Date() > new Date(license.expires_at)) {
            await client.query('ROLLBACK');
            return res.status(410).json({ error: 'Esta licença expirou' });
        }
        
        const updateResult = await client.query(
            `UPDATE licenses 
             SET device_id = $1, 
                 device_fingerprint = $2,
                 device_systemversion = $3,
                 device_model = $4,
                 device_idfv = $5,
                 device_serialnumber = $6,
                 device_uuid = $7,
                 device_macaddress = $8,
                 status = 'active', 
                 activated_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE code = $9
             RETURNING *`,
            [
                device_id, 
                deviceHash,
                device_systemVersion || null,
                device_model || null,
                device_IDFV || null,
                device_serialNumber || null,
                device_UUID || null,
                device_macAddress || null,
                code.toUpperCase()
            ]
        );
        
        const activatedLicense = updateResult.rows[0];
        const token = generateToken(activatedLicense);

        await client.query('COMMIT');
        
        res.json({
            success: true,
            token,
            expires_at: activatedLicense.expires_at,
            server_time: new Date().toISOString(),
            message: 'Licença ativada com sucesso'
        });
        
    } catch (error) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) {}
        }
        console.error('Erro ao ativar licença:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    } finally {
        if (client) client.release();
    }
};

// GET /api/license/validate
exports.validate = async (req, res) => {
    const { 
        device_id,
        device_systemVersion,
        device_model,
        device_IDFV,
        device_serialNumber,
        device_UUID,
        device_macAddress
    } = req.body || {};
    const licenseData = req.license; // Vem do middleware de auth
    
    if (!device_id) {
        return res.status(400).json({ error: 'device_id é obrigatório' });
    }
    
    try {
        const result = await pool.query(
            'SELECT * FROM licenses WHERE code = $1',
            [licenseData.code]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ valid: false, error: 'Licença não encontrada' });
        }
        
        const license = result.rows[0];
        const deviceHash = hashDevice(device_id);
        
        // Verificar device
        if (license.device_fingerprint !== deviceHash) {
            return res.status(403).json({ 
                valid: false, 
                error: 'Dispositivo não autorizado' 
            });
        }
        
        // Verificar expiração
        if (new Date() > new Date(license.expires_at)) {
            await pool.query(
                "UPDATE licenses SET status = 'expired' WHERE code = $1",
                [license.code]
            );
            return res.status(410).json({ 
                valid: false, 
                error: 'Licença expirada' 
            });
        }
        
        // Verificar status
        if (license.status !== 'active') {
            return res.status(403).json({ 
                valid: false, 
                error: 'Licença não está ativa' 
            });
        }
        
        // Atualizar informações do dispositivo (caso tenha mudado iOS version, etc)
        await pool.query(
            `UPDATE licenses 
             SET device_systemversion = COALESCE($1, device_systemversion),
                 device_model = COALESCE($2, device_model),
                 device_idfv = COALESCE($3, device_idfv),
                 device_serialnumber = COALESCE($4, device_serialnumber),
                 device_uuid = COALESCE($5, device_uuid),
                 device_macaddress = COALESCE($6, device_macaddress),
                 updated_at = CURRENT_TIMESTAMP
             WHERE code = $7`,
            [
                device_systemVersion,
                device_model,
                device_IDFV,
                device_serialNumber,
                device_UUID,
                device_macAddress,
                license.code
            ]
        );
        
        res.json({
            valid: true,
            expires_at: license.expires_at,
            server_time: new Date().toISOString(),
            days_remaining: Math.ceil((new Date(license.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
        });
        
    } catch (error) {
        console.error('Erro ao validar licença:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

// POST /api/license/generate (admin)
exports.generate = async (req, res) => {
    const { days = 30, quantity = 1, secret } = req.body || {};

    if (!process.env.ADMIN_SECRET) {
        return res.status(500).json({ error: 'ADMIN_SECRET não configurado no servidor' });
    }

    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: 'Código secreto inválido' });
    }

    const daysInt = Number(days);
    const quantityInt = Number(quantity);

    if (!Number.isInteger(daysInt) || daysInt <= 0 || daysInt > 3650) {
        return res.status(400).json({ error: 'Parâmetro days precisa ser um inteiro entre 1 e 3650' });
    }

    if (!Number.isInteger(quantityInt) || quantityInt <= 0 || quantityInt > 100) {
        return res.status(400).json({ error: 'Parâmetro quantity precisa ser um inteiro entre 1 e 100' });
    }
    
    try {
        const codes = [];
        
        for (let i = 0; i < quantityInt; i++) {
            const result = await pool.query(
                `INSERT INTO licenses (code, expires_at)
                 VALUES (generate_license_code(), CURRENT_TIMESTAMP + make_interval(days => $1))
                 RETURNING code, expires_at`,
                [daysInt]
            );
            codes.push(result.rows[0]);
        }
        
        res.json({
            success: true,
            licenses: codes,
            count: codes.length
        });
        
    } catch (error) {
        console.error('Erro ao gerar licenças:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
