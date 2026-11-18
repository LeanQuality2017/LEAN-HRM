// Pre-write safety gate — fail-closed. Runs BEFORE any prisma db push / fixture write.
import { PrismaClient } from '@prisma/client'

const url = process.env.TEST_DATABASE_URL
if (!url) {
  console.error('GATE FAIL: TEST_DATABASE_URL is not set')
  process.exit(1)
}

const allowlist = (process.env.TEST_DB_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim().replace(/\/32$/, ''))
  .filter(Boolean)

if (allowlist.length === 0) {
  console.error('GATE FAIL C2: TEST_DB_ALLOWLIST is not set (fail-closed)')
  process.exit(1)
}

const EXPECTED_DB = 'unihr_test'
const EXPECTED_USER = 'unihr_tester'

const prisma = new PrismaClient({ datasourceUrl: url })
try {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT current_database() AS db, inet_server_addr() AS host, current_user AS usr'
  )
  const { db, host, usr } = rows[0]
  const hostNorm = String(host).replace(/\/32$/, '')
  console.log('GATE CONNECTION:', JSON.stringify({ db, host: hostNorm, usr }))

  if (db !== EXPECTED_DB) {
    console.error(`GATE FAIL C1: current_database()=${db}, expected ${EXPECTED_DB}`)
    process.exit(1)
  }
  if (!allowlist.includes(hostNorm)) {
    console.error(`GATE FAIL C2: inet_server_addr()=${hostNorm} not in allowlist [${allowlist.join(', ')}]`)
    process.exit(1)
  }
  if (usr !== EXPECTED_USER) {
    console.error(`GATE FAIL C5: current_user=${usr}, expected ${EXPECTED_USER}`)
    process.exit(1)
  }
  const empty = await prisma.$queryRawUnsafe(
    "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'"
  )
  if (empty[0].n !== 0) {
    console.error(`GATE FAIL C6: public schema has ${empty[0].n} tables, expected 0 (pre-push)`)
    process.exit(1)
  }
  console.log('GATE PASS: unihr_test confirmed, host allowlisted, least-privilege user, schema empty')
  process.exit(0)
} finally {
  await prisma.$disconnect()
}

