/**
 * Runs before any e2e file is loaded. Must beat `dotenv/config` in column-types
 * so tests always use SQLite `datetime` columns, even when backend/.env has Postgres.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-test-jwt-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
process.env.DATABASE_URL = '';
process.env.TYPEORM_SYNC = 'true';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
