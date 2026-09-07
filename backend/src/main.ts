import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { JwtExceptionFilter } from './modules/auth/jwt-exception.filter';
import fastifyCors from '@fastify/cors';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { getFrontendBaseUrl } from './common/public-url';

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    return true;
  }
  return origin === getFrontendBaseUrl();
}

async function bootstrap() {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 15 * 1024 * 1024,
  });
  await adapter.getInstance().register(fastifyCors, {
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  const app = await NestFactory.create(AppModule, adapter as any);

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalFilters(new JwtExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Calendar Assistant API')
    .setDescription('API documentation for Calendar Assistant')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management endpoints')
    .addTag('tasks', 'Task management endpoints')
    .addTag('user-settings', 'User settings endpoints')
    .addTag('schedule', 'Schedule management endpoints')
    .addTag('google-calendar', 'Google Calendar integration endpoints')
    .addTag('voice', 'Voice transcription and task parsing')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.get('/health', async () => ({ status: 'ok' }));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error('Failed to start API:', message);
  process.exit(1);
});
