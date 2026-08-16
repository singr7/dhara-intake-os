// Integration tests talk to a throwaway database, never the dev one. Pointing DATABASE_URL
// at TEST_DATABASE_URL before any module loads is what makes `resetTestDatabase()` safe:
// the Prisma client is constructed at import time.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
