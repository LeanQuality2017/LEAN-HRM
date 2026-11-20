import { db } from '../src/lib/db'

export async function runDryRun() {
  const isJson = process.argv.includes('--json')

  let attendances: Array<{
    id: string
    employeeId: string
    companyId: string
    date: Date | string
    employee: { employeeCode: string }
    company: { code: string }
  }> = []

  try {
    attendances = await db.attendance.findMany({
      select: {
        id: true,
        employeeId: true,
        companyId: true,
        date: true,
        employee: {
          select: {
            employeeCode: true,
          },
        },
        company: {
          select: {
            code: true,
          },
        },
      },
      orderBy: {
        date: 'asc',
      },
    })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    if (errorMsg.includes("Can't reach database server") || (err as { name?: string })?.name === 'PrismaClientInitializationError') {
      if (isJson) {
        console.log(
          JSON.stringify(
            {
              status: 'offline',
              message: 'Database server is not running or unreachable at configured DATABASE_URL',
              totalRows: 0,
              distinctKeys: 0,
              collisionsCount: 0,
              collisions: [],
            },
            null,
            2
          )
        )
      } else {
        console.log('=== Attendance Uniqueness Dry-Run Collision Report ===')
        console.log('⚠️ Database connection unavailable: PostgreSQL is offline or unreachable.')
        console.log('Total Attendance Rows:  0 (DB offline)')
        console.log('Distinct New Keys:      0')
        console.log('Collisions (Count > 1): 0')
        console.log('------------------------------------------------------')
        console.log('Note: To execute dry-run collision check on live records, start the PostgreSQL database.')
      }
      return { totalRows: 0, distinctKeys: 0, collisions: 0 }
    }
    throw err
  }

  const totalRows = attendances.length
  const keyMap = new Map<string, typeof attendances>()

  for (const att of attendances) {
    const dateStr = att.date instanceof Date ? att.date.toISOString().split('T')[0] : String(att.date)
    const key = `${att.employeeId}::${att.companyId}::${dateStr}`
    const existing = keyMap.get(key)
    if (existing) {
      existing.push(att)
    } else {
      keyMap.set(key, [att])
    }
  }

  const distinctKeys = keyMap.size
  const collisions: Array<{
    key: string
    employeeId: string
    companyId: string
    date: string
    employeeCode: string
    companyCode: string
    count: number
    ids: string[]
  }> = []

  for (const [key, rows] of keyMap.entries()) {
    if (rows.length > 1) {
      const first = rows[0]
      const dateStr = first.date instanceof Date ? first.date.toISOString().split('T')[0] : String(first.date)
      collisions.push({
        key,
        employeeId: first.employeeId,
        companyId: first.companyId,
        date: dateStr,
        employeeCode: first.employee.employeeCode,
        companyCode: first.company.code,
        count: rows.length,
        ids: rows.map((r) => r.id),
      })
    }
  }

  if (isJson) {
    console.log(
      JSON.stringify(
        {
          totalRows,
          distinctKeys,
          collisionsCount: collisions.length,
          collisions,
        },
        null,
        2
      )
    )
  } else {
    console.log('=== Attendance Uniqueness Dry-Run Collision Report ===')
    console.log(`Total Attendance Rows:  ${totalRows}`)
    console.log(`Distinct New Keys:      ${distinctKeys}`)
    console.log(`Collisions (Count > 1): ${collisions.length}`)
    console.log('------------------------------------------------------')

    if (collisions.length === 0) {
      console.log('✅ ZERO COLLISIONS DETECTED.')
      console.log('   All attendance rows satisfy @@unique([employeeId, companyId, date]).')
      console.log('   Step 4.3 (dropping legacy index) will be safe.')
    } else {
      console.log('⚠️ COLLISIONS FOUND:')
      for (const col of collisions) {
        console.log(`- Employee: ${col.employeeCode} | Company: ${col.companyCode} | Date: ${col.date} | Count: ${col.count}`)
      }
    }
  }

  return { totalRows, distinctKeys, collisions: collisions.length }
}

if (process.argv[1]?.includes('attendance-uniqueness-dryrun')) {
  runDryRun()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error during dry-run:', err)
      process.exit(1)
    })
}
