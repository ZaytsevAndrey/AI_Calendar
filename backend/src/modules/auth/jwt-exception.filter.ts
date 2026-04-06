import {
  ExceptionFilter,
  Catch,
  UnauthorizedException,
  ArgumentsHost,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(UnauthorizedException)
export class JwtExceptionFilter implements ExceptionFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const body = {
      statusCode: 401,
      message: exception.message || 'Unauthorized',
      code: 'INVALID_JWT',
    };

    if (typeof response.json === 'function') {
      // Express
      response.status(401).json(body);
    } else if (typeof response.send === 'function') {
      // Fastify
      response.status(401).send(body);
    } else {
      // Fallback
      response.statusCode = 401;
      response.end(JSON.stringify(body));
    }
  }
}
