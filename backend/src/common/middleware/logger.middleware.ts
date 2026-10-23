import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  use(req: Request, _res: Response, next: NextFunction): void {
    const { method, originalUrl, body, query, params, headers } = req;

    this.logger.log(
      `REQUEST: ${method} ${originalUrl} | query: ${JSON.stringify(query)} | params: ${JSON.stringify(params)} | body: ${JSON.stringify(body)} | headers: ${JSON.stringify(headers)}`,
    );

    next();
  }
}
