import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiError } from '../../modules/common/types/errors';

function statusForApiError(code: string): number {
  switch (code) {
    case 'INVALID_CREDENTIALS':
    case 'INVALID_REFRESH_TOKEN':
      return HttpStatus.UNAUTHORIZED;
    case 'EMAIL_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'EMAIL_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS':
      return HttpStatus.CONFLICT;
    case 'PASSWORDS_DO_NOT_MATCH':
    case 'INVALID_RESET_TOKEN':
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse();

    let status: number;
    let body: Record<string, unknown>;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        statusCode: status,
        message: exception.getResponse(),
      };
    } else if (exception instanceof ApiError) {
      status = statusForApiError(exception.code);
      body = {
        statusCode: status,
        code: exception.code,
        ...(exception.fields ? { fields: exception.fields } : {}),
      };
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = {
        statusCode: status,
        message:
          exception instanceof Error ? exception.message : 'Internal server error',
      };
    }

    const logMessage =
      exception instanceof ApiError
        ? JSON.stringify({ code: exception.code, fields: exception.fields })
        : exception instanceof HttpException
          ? JSON.stringify(exception.getResponse())
          : exception instanceof Error
            ? exception.message
            : String(exception);

    this.logger.error(`
--- EXCEPTION ---
${request.method} ${request.url}
Status: ${status}
Message: ${logMessage}
Stack: ${exception instanceof Error && exception.stack ? exception.stack : 'no stack'}
Body: ${JSON.stringify(request.body)}
Query: ${JSON.stringify(request.query)}
Params: ${JSON.stringify(request.params)}
Headers: ${JSON.stringify(request.headers)}
-----------------
`);

    response.status(status).send(body);
  }
}
