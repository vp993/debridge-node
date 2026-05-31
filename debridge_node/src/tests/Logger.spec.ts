import { Logger } from '../Logger';
import * as Sentry from '@sentry/node';

describe('Logger', () => {
  let logger: Logger;
  const originalSentryDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    logger = new Logger('ChainScanningService');
    delete process.env.SENTRY_DSN;
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalSentryDsn !== undefined) {
      process.env.SENTRY_DSN = originalSentryDsn;
    } else {
      delete process.env.SENTRY_DSN;
    }
  });

  it('should log an error message without stack trace when Sentry DSN is not provided', () => {
    const errorMessage = 'Failed to fetch block 19542381 from RPC';
    const mockCaptureException = jest.spyOn(Sentry, 'captureException').mockImplementation();
    logger.error(errorMessage);
    expect(mockCaptureException).toHaveBeenCalledTimes(0);
    mockCaptureException.mockRestore();
  });

  it('should log an error message with stack trace when Sentry DSN is provided', () => {
    const errorMessage = 'Failed to process submission 0x7254a2b8';
    const stackTrace = 'Error: Failed to process submission 0x7254a2b8\n    at SubmissionProcessingService.process (src/services/SubmissionProcessingService.ts:42:11)';
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const mockCaptureException = jest.spyOn(Sentry, 'captureException').mockImplementation();

    logger.error(errorMessage, stackTrace);

    expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error));
    const capturedError = mockCaptureException.mock.calls[0][0] as Error;
    expect(capturedError.message).toBe(errorMessage);
    expect(capturedError.stack).toBe(stackTrace);
    expect(process.env.SENTRY_DSN).toBe('https://examplePublicKey@o0.ingest.sentry.io/0');

    mockCaptureException.mockRestore();
  });
});
