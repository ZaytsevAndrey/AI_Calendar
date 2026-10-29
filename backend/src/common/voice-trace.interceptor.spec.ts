import { InterceptorsConsumer } from '@nestjs/core/interceptors/interceptors-consumer';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { lastValueFrom } from 'rxjs';
import { currentVoiceTrace, readVoiceTrace } from './voice-trace';
import { VoiceTraceInterceptor } from './voice-trace.interceptor';

describe('VoiceTraceInterceptor', () => {
  it('runs the handler inside the request trace through the real Nest interceptor chain', async () => {
    const request = {};
    const context = new ExecutionContextHost([request, {}, () => undefined]);
    context.setType('http');
    let seen: string | undefined;
    const result = await new InterceptorsConsumer().intercept(
      [new VoiceTraceInterceptor()],
      [request],
      {},
      () => undefined,
      async () => {
        await Promise.resolve();
        seen = currentVoiceTrace()?.traceId;
        return 'ok';
      },
      'http',
    );
    expect(await lastValueFrom(result as never)).toBe('ok');
    expect(seen).toBeDefined();
    expect(seen).toBe(readVoiceTrace(request)?.traceId);
    void context;
  });
});
