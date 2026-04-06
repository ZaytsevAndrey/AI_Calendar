import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, body, query, params, headers } = req;
    const start = Date.now();

    this.logger.log(
      `REQUEST: ${method} ${originalUrl} | query: ${JSON.stringify(query)} | params: ${JSON.stringify(params)} | body: ${JSON.stringify(body)} | headers: ${JSON.stringify(headers)}`,
    );

    const oldSend = res.send;
    res.send = function (data) {
      const ms = Date.now() - start;
      // Лог відповіді
      Logger.log(
        `RESPONSE: ${method} ${originalUrl} ${res.statusCode} - ${ms}ms | response: ${data}`,
        'HTTP',
      );
      // @ts-ignore
      return oldSend.apply(res, arguments);
    };

    next();
  }
}
