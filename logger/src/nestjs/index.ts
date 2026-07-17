import {
  type CallHandler,
  type DynamicModule,
  type ExecutionContext,
  Global,
  Inject,
  Injectable,
  type LoggerService,
  Module,
  type NestInterceptor,
  type NestMiddleware,
} from '@nestjs/common';
import { tap } from 'rxjs';
import type { Observable } from 'rxjs';
import { createLogger } from '../logger';
import type { Logger, LoggerOptions } from '../types';
import { traceContextMiddleware } from '../http';

/** DI token for the raw framework-agnostic Logger. */
export const HOPAE_LOGGER = Symbol('HOPAE_LOGGER');

/**
 * Adapts our Logger to NestJS's `LoggerService` so it can back `app.useLogger`
 * and Nest's built-in `Logger`. Framework log calls are mapped onto our schema.
 */
export class HopaeLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  private scopeContext(optionalParams: unknown[]): Record<string, unknown> | undefined {
    if (optionalParams.length === 0) return undefined;
    const last = optionalParams[optionalParams.length - 1];
    return typeof last === 'string' ? { scope: last } : undefined;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info(String(message), this.scopeContext(optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const stack = optionalParams.find((p) => typeof p === 'string') as string | undefined;
    this.logger.error(String(message), undefined, stack ? { stack } : undefined);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(String(message), this.scopeContext(optionalParams));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(String(message), this.scopeContext(optionalParams));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace(String(message), this.scopeContext(optionalParams));
  }
}

/** Seeds the per-request trace context. Apply first in the middleware chain. */
@Injectable()
export class TraceContextMiddleware implements NestMiddleware {
  private readonly handler = traceContextMiddleware();

  use(req: unknown, res: unknown, next: () => void): void {
    this.handler(req as never, res as never, next);
  }
}

/** Logs request boundaries (received / completed / failed) with duration. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(@Inject(HOPAE_LOGGER) private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method?: string; url?: string; originalUrl?: string }>();
    const start = Date.now();
    const meta = { method: req?.method, path: req?.originalUrl ?? req?.url };

    this.logger.info('request.received', meta);

    return next.handle().pipe(
      tap({
        next: () =>
          this.logger.info('request.completed', { ...meta, durationMs: Date.now() - start }),
        error: (err: unknown) =>
          this.logger.error('request.failed', err, { ...meta, durationMs: Date.now() - start }),
      }),
    );
  }
}

/**
 * Global module wiring the logger into DI. Provides both the raw Logger (via
 * `HOPAE_LOGGER`) and the NestJS-facing `HopaeLoggerService`.
 */
@Global()
@Module({})
export class LoggerModule {
  static forRoot(options: LoggerOptions): DynamicModule {
    const rawLogger = {
      provide: HOPAE_LOGGER,
      useValue: createLogger(options),
    };

    const nestLogger = {
      provide: HopaeLoggerService,
      useFactory: (logger: Logger) => new HopaeLoggerService(logger),
      inject: [HOPAE_LOGGER],
    };

    return {
      module: LoggerModule,
      providers: [rawLogger, nestLogger, LoggingInterceptor],
      exports: [HOPAE_LOGGER, HopaeLoggerService, LoggingInterceptor],
    };
  }
}
