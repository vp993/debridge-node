import { ConsoleLogger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

export class Logger extends ConsoleLogger {
  error(message: any, stack?: string, context?: string, ...rest: any[]) {
    if (process.env.SENTRY_DSN) {
      if (message instanceof Error) {
        Sentry.captureException(message);
      } else if (typeof message === 'string' && typeof stack === 'string') {
        const error = new Error(message);
        error.stack = stack;
        Sentry.captureException(error);
      } else {
        Sentry.captureException(message);
      }
    }
    super.error(message, stack, context, ...rest);
  }
}
