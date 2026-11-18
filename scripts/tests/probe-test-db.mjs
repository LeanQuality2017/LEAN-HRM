
import { PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  throw new Error("TEST_DATABASE_URL is missing. Check your .env file.");
}

const prisma = new PrismaClient({
  datasourceUrl: url,
});

try {
  const result = await prisma.$queryRaw`
    SELECT
      current_database() AS database,
      current_user AS username,
      inet_server_addr()::text AS host,
      inet_server_port() AS port,
      version() AS version
  `;

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("Test database probe failed:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
