const { execSync } = require('node:child_process');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL não configurada');
  process.exit(1);
}

try {
  console.log('🔧 Configurando banco de dados...\n');
  execSync(`psql "${databaseUrl}" -f src/config/schema.sql`, { stdio: 'inherit' });
  console.log('\n✅ Banco de dados configurado com sucesso!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Erro ao configurar banco de dados:', error.message);
  process.exit(1);
}
