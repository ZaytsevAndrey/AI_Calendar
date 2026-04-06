import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { JwtExceptionFilter } from './modules/auth/jwt-exception.filter';
import fastifyCors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const adapter = new FastifyAdapter();
  // Реєструємо CORS до створення Nest-додатку
  await adapter.getInstance().register(fastifyCors, {
    origin: (origin, cb) => {
      // Дозволяємо всі локальні origin для розробки
      if (!origin || origin.startsWith('http://localhost')) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  const app = await NestFactory.create(AppModule, adapter as any);

  // Глобальний exception filter
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalFilters(new JwtExceptionFilter());

  // Налаштування Swagger
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
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
