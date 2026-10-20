import { ArgumentsHost, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends a JSON 503 when the route already declared a binary content type', () => {
    const send = jest.fn();
    const status = jest.fn().mockReturnValue({ send });
    const type = jest.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/voice/speak',
          body: { text: 'hello', language: 'uk' },
          query: {},
          params: {},
          headers: { 'accept-language': 'en' },
        }),
        getResponse: () => ({
          status,
          type,
          getHeader: () => 'audio/wav',
        }),
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(
      new ServiceUnavailableException({
        code: 'PIPER_UNAVAILABLE',
        message: 'Local speech is unavailable.',
      }),
      host,
    );

    expect(type).toHaveBeenCalledWith('application/json; charset=utf-8');
    expect(status).toHaveBeenCalledWith(503);
    expect(send).toHaveBeenCalledWith({
      statusCode: 503,
      message: 'Local speech is unavailable.',
      code: 'PIPER_UNAVAILABLE',
    });
  });
});
