const app = require('./app');
const { getPool } = require('./config/database');

// Para desenvolvimento local
if (process.env.NODE_ENV !== 'production') {
    const pool = getPool();
    const PORT = process.env.PORT || 3000;
    
    pool.query('SELECT NOW()', (err, res) => {
        if (err) {
            console.error('❌ Erro ao conectar no PostgreSQL:', err);
            process.exit(1);
        }
        console.log('✓ PostgreSQL conectado:', res.rows[0].now);
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 Servidor rodando na porta ${PORT}`);
            console.log(`📍 http://localhost:${PORT}`);
            // console.log(`📍 http://192.168.1.205:${PORT}`);
        });
    });
} else {
    // Para Vercel (serverless)
    module.exports = app;
}
