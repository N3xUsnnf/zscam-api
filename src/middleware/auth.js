const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.license = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Token inválido' });
    }
};

const verifyAdmin = (req, res, next) => {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'];

    if (!adminSecret) {
        return res.status(500).json({ error: 'ADMIN_SECRET não configurado' });
    }

    if (!provided || provided !== adminSecret) {
        return res.status(401).json({ error: 'Admin não autorizado' });
    }

    next();
};

module.exports = { verifyToken, verifyAdmin };
