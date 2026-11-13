// Read-only ImobGestor Neon diagnostic. Save in backend/ and run: node .\check-neon.cjs
// Reads backend/.env without printing credentials. No database writes are performed.
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '.env');
if (!fs.existsSync(envFile)) {
  console.error('Não encontrei backend/.env. Este diagnóstico espera o arquivo .env dentro da pasta backend.');
  process.exit(1);
}

for (const rawLine of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) continue;
  const key = match[1];
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (process.env[key] === undefined) process.env[key] = value;
}

function safeHost(name) {
  const value = process.env[name];
  if (!value) return '(não configurada)';
  try { return new URL(value).hostname; } catch { return '(URL inválida)'; }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não está configurada em backend/.env');
  console.log('Hosts configurados (sem usuário/senha):');
  console.log(JSON.stringify({
    DATABASE_URL: safeHost('DATABASE_URL'),
    DIRECT_URL: safeHost('DIRECT_URL'),
    DATABASE_URL_UNPOOLED: safeHost('DATABASE_URL_UNPOOLED')
  }, null, 2));

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const identity = await prisma.$queryRaw`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_schema() AS schema_name,
        current_setting('search_path') AS search_path,
        to_regclass('public._prisma_migrations')::text AS migration_table
    `;

    const tables = await prisma.$queryRaw`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `;

    let migrations = [];
    if (identity[0].migration_table) {
      migrations = await prisma.$queryRaw`
        SELECT migration_name, started_at, finished_at, rolled_back_at
        FROM public."_prisma_migrations"
        ORDER BY started_at
      `;
    }
    console.log('\nResultado da consulta (somente leitura):');
    console.log(JSON.stringify({ identity, tables, migrations }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\nDiagnóstico falhou:', error.message);
  process.exitCode = 1;
});
