import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { bindVoiceTrace, runWithVoiceTrace } from './voice-trace';

/**
 * Re-enter the request trace around the handler subscription.
 * Building a fresh Observable here would pull a second copy of RxJS and
 * fail to typecheck against Nest's, so this wraps the observable Nest already
 * returned.
 */
@Injectable()
export class VoiceTraceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();
    const trace = bindVoiceTrace(context.switchToHttp().getRequest<object>());
    // Nest binds the handler to the async context current when handle() is called,
    // so handle() must run inside the trace, not only the subscription.
    const source = runWithVoiceTrace(trace, () => next.handle());
    const ObservableCtor = source.constructor as new (
      subscribe: (subscriber: {
        next: (value: unknown) => void;
        error: (err: unknown) => void;
        complete: () => void;
      }) => void | (() => void),
    ) => typeof source;
    return new ObservableCtor((subscriber) => {
      const subscription = runWithVoiceTrace(trace, () => source.subscribe(subscriber));
      return () => subscription.unsubscribe();
    });
  }
}
