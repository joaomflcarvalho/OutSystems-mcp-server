/**
 * Structured logging utility with debug/info/error levels
 * Respects DEBUG and LOG_LEVEL environment variables
 */

const DEBUG = process.env.DEBUG === 'true';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // 'silent', 'error', 'info', 'debug'

export interface Logger {
  debug(message: string, meta?: Record<string, any>): void;
  info(message: string, meta?: Record<string, any>): void;
  error(message: string, error?: any, meta?: Record<string, any>): void;
}

/**
 * Creates a logger instance with optional correlation ID for request tracking
 */
export function createLogger(correlationId?: string): Logger {
  const prefix = correlationId ? `[${correlationId}]` : '';

  return {
    debug(message: string, meta?: Record<string, any>): void {
      if (DEBUG || LOG_LEVEL === 'debug') {
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        console.error(`[DEBUG]${prefix} ${message}${metaStr}`);
      }
    },

    info(message: string, meta?: Record<string, any>): void {
      if (LOG_LEVEL !== 'silent' && LOG_LEVEL !== 'error') {
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        console.error(`[INFO]${prefix} ${message}${metaStr}`);
      }
    },

    error(message: string, error?: any, meta?: Record<string, any>): void {
      if (LOG_LEVEL !== 'silent') {
        const errorMsg = error?.message || error || '';
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        console.error(`[ERROR]${prefix} ${message} ${errorMsg}${metaStr}`);
      }
    }
  };
}

/**
 * Default logger instance without correlation ID
 */
export const logger = createLogger();

