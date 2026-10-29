import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import fastifyCors from '@fastify/cors';
import { Logger } from '@nestjs/common';
import { AdminAppModule } from './admin-app/admin-app.module';
import { adminApiPort, adminAppOrigin, adminJwtSecret } from './admin-app/admin-config';

/**
 * Admin API entry point. Runs as its own process, separate from the client API:
 *   npm run start:admin-api            (dev, watch)
 *   node dist/admin-main               (production)
 * Env: DATABASE_URL, ADMIN_JWT_SECRET, ADMIN_URL, CLIENT_API_URL, INTERNAL_API_TOKEN.
 */
async function bootstrap() {
  adminJwtSecret(); // fail fast on a missing or weak secret
  const origin = adminAppOrigin();
  const adapter = new FastifyAdapter({ trustProxy: true, bodyLimit: 64 * 1024 });
  await adapter.getInstance().register(fastifyCors, {
    origin: (requestOrigin, cb) => cb(null, !requestOrigin || (Boolean(origin) && requestOrigin === origin)),
    credentials: false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });
  const app = await NestFactory.create(AdminAppModule, adapter as any);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
  fastify.get('/health', async () => ({ status: 'ok' }));
  const port = adminApiPort();
  await app.listen(port, '0.0.0.0');
  new Logger('AdminApi').log(`Admin API on :${port}, allowing origin ${origin || '(none)'}`);
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error('Failed to start admin API:', message);
  process.exit(1);
});
