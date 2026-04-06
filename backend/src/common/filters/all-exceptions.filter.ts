import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException ? exception.getResponse() : exception;

    this.logger.error(`
--- EXCEPTION ---
${request.method} ${request.url}
Status: ${status}
Message: ${JSON.stringify(message)}
Stack: ${exception instanceof Error && exception.stack ? exception.stack : 'no stack'}
Body: ${JSON.stringify(request.body)}
Query: ${JSON.stringify(request.query)}
Params: ${JSON.stringify(request.params)}
Headers: ${JSON.stringify(request.headers)}
-----------------
`);

    response.status(status).send({
      statusCode: status,
      message,
    });
  }
}
