const pool = require('./src/config/database');

async function testDatabase() {
  try {
    console.log('\n🧪 Testando conexão com PostgreSQL...\n');

    // Teste 1: Conexão básica
    console.log('1️⃣  Testando conexão básica...');
    const connTest = await pool.query('SELECT NOW()');
    console.log('✓ Conexão bem-sucedida:', connTest.rows[0].now);

    // Teste 2: Verificar tabela licenses
    console.log('\n2️⃣  Verificando tabela licenses...');
    const tableTest = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'licenses'
      );
    `);
    if (tableTest.rows[0].exists) {
      console.log('✓ Tabela "licenses" existe');
    } else {
      console.log('❌ Tabela "licenses" não encontrada');
    }

    // Teste 3: Verificar estrutura da tabela
    console.log('\n3️⃣  Estrutura da tabela licenses:');
    const schemaTest = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'licenses'
      ORDER BY ordinal_position;
    `);
    console.log('Colunas:');
    schemaTest.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'})`);
    });

    // Teste 4: Verificar índices
    console.log('\n4️⃣  Índices da tabela:');
    const indexTest = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'licenses';
    `);
    indexTest.rows.forEach(idx => {
      console.log(`  - ${idx.indexname}`);
    });

    // Teste 5: Inserir uma licença de teste
    console.log('\n5️⃣  Testando INSERT...');
    const insertTest = await pool.query(`
      INSERT INTO licenses (code, device_id, device_fingerprint, device_systemVersion, device_model, device_IDFV, device_serialNumber, device_UUID, device_macAddress, expires_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `, ['TEST-0001-0001', 'device123', 'fingerprint123', 'systemVersion123', 'model123', 'IDFV123', 'serialNumber123', 'UUID123', 'macAddress123', new Date(Date.now() + 30*24*60*60*1000), 'pending']);
    console.log('✓ Licença inserida:', insertTest.rows[0]);

    // Teste 6: Buscar licença
    console.log('\n6️⃣  Testando SELECT...');
    const selectTest = await pool.query('SELECT * FROM licenses WHERE code = $1', ['TEST-0001-0001']);
    if (selectTest.rows.length > 0) {
      console.log('✓ Licença encontrada:', selectTest.rows[0]);
    }

    // Teste 7: Atualizar licença
    console.log('\n7️⃣  Testando UPDATE...');
    const updateTest = await pool.query(`
      UPDATE licenses 
      SET status = $1, device_fingerprint = $2
      WHERE code = $3
      RETURNING *;
    `, ['active', 'fingerprint123', 'TEST-0001-0001']);
    console.log('✓ Licença atualizada:', updateTest.rows[0]);

    // Teste 8: Deletar licença de teste
    console.log('\n8️⃣  Testando DELETE...');
    const deleteTest = await pool.query('DELETE FROM licenses WHERE code = $1 RETURNING code;', ['TEST-0001-0001']);
    console.log('✓ Licença deletada:', deleteTest.rows[0].code);

    // Teste 9: Contar registros
    console.log('\n9️⃣  Total de licenças no banco:');
    const countTest = await pool.query('SELECT COUNT(*) as count FROM licenses;');
    console.log(`  ${countTest.rows[0].count} registros`);

    console.log('\n✅ Todos os testes concluídos com sucesso!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Erro durante os testes:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testDatabase();
