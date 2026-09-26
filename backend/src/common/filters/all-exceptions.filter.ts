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
import { resolveAppLanguage, t, type MessageKey } from '../../i18n';

const API_ERROR_KEYS: Record<string, MessageKey> = {
  INVALID_CREDENTIALS: 'errors.INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'errors.INVALID_REFRESH_TOKEN',
  EMAIL_NOT_FOUND: 'errors.EMAIL_NOT_FOUND',
  EMAIL_ALREADY_EXISTS: 'errors.EMAIL_ALREADY_EXISTS',
  USER_ALREADY_EXISTS: 'errors.USER_ALREADY_EXISTS',
  PASSWORDS_DO_NOT_MATCH: 'errors.PASSWORDS_DO_NOT_MATCH',
  INVALID_RESET_TOKEN: 'errors.INVALID_RESET_TOKEN',
};

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

function languageFromRequest(request: Request) {
  const user = (request as Request & { user?: { language?: string } }).user;
  const header =
    typeof request.headers['accept-language'] === 'string'
      ? request.headers['accept-language']
      : null;
  return resolveAppLanguage({
    settingsLanguage: user?.language,
    acceptLanguage: header,
  });
}

function unwrapHttpMessage(response: string | object): {
  message: unknown;
  code?: string;
} {
  if (typeof response === 'string') return { message: response };
  if (response && typeof response === 'object') {
    const body = response as Record<string, unknown>;
    return {
      message: body.message ?? response,
      code: typeof body.code === 'string' ? body.code : undefined,
    };
  }
  return { message: response };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse();
    const lang = languageFromRequest(request);

    let status: number;
    let body: Record<string, unknown>;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const raw = unwrapHttpMessage(exception.getResponse());
      let message = raw.message;
      if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
        const nested = message as Record<string, unknown>;
        message = nested.message ?? message;
      }
      if (raw.code && API_ERROR_KEYS[raw.code]) {
        message = t(lang, API_ERROR_KEYS[raw.code]);
      }
      body = {
        statusCode: status,
        message,
        ...(raw.code ? { code: raw.code } : {}),
      };
    } else if (exception instanceof ApiError) {
      status = statusForApiError(exception.code);
      const key = API_ERROR_KEYS[exception.code];
      body = {
        statusCode: status,
        code: exception.code,
        message: key ? t(lang, key) : exception.code,
        ...(exception.fields ? { fields: exception.fields } : {}),
      };
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = {
        statusCode: status,
        message: t(lang, 'errors.INTERNAL'),
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
