/**
 * OutSystems API Client with timeout and retry logic
 * Provides secure error handling and proper timeout management
 */

import { logger } from './logger.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    public endpoint: string,
    public body?: string
  ) {
    super(`API request failed: ${status} on ${endpoint}`);
    this.name = 'ApiError';
  }
}

export class TimeoutError extends Error {
  constructor(endpoint: string, timeout: number) {
    super(`Request timeout after ${timeout}ms on ${endpoint}`);
    this.name = 'TimeoutError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  token: string;
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * OutSystems API Client
 */
export class OutSystemsApiClient {
  constructor(private hostname: string) {}

  /**
   * Makes an API request with timeout and error handling
   */
  async request<T>(
    endpoint: string,
    options: RequestOptions
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = options.timeout || 30000; // Default 30s timeout
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const url = `https://${this.hostname}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Authorization': `Bearer ${options.token}`,
          ...(options.body && { 'Content-Type': 'application/json' }),
          ...options.headers
        },
        ...(options.body && { body: JSON.stringify(options.body) }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`API request failed`, null, {
          status: response.status,
          endpoint,
          method: options.method || 'GET'
        });
        throw new ApiError(response.status, endpoint, errorBody);
      }

      return await response.json() as T;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new TimeoutError(endpoint, timeout);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Retry logic with exponential backoff for transient failures
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry on client errors (4xx except 429) or if we're out of retries
      if (error instanceof ApiError) {
        if (error.status >= 400 && error.status < 500 && error.status !== 429) {
          throw error;
        }
      }

      if (attempt === maxRetries - 1) {
        throw error;
      }

      const delay = initialDelay * Math.pow(2, attempt);
      logger.debug(`Retrying request after ${delay}ms`, {
        attempt: attempt + 1,
        maxRetries,
        error: error.message
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * Polling with exponential backoff
 */
export async function pollWithBackoff<T>(
  pollFn: () => Promise<T>,
  checkFn: (result: T) => boolean,
  failFn: (result: T) => boolean,
  options: {
    maxAttempts?: number;
    initialInterval?: number;
    maxInterval?: number;
    onProgress?: (result: T, attempt: number) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 60,
    initialInterval = 2000,
    maxInterval = 30000,
    onProgress
  } = options;

  let interval = initialInterval;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const result = await pollFn();

    if (onProgress) {
      onProgress(result, attempts);
    }

    if (checkFn(result)) {
      return result;
    }

    if (failFn(result)) {
      throw new Error(`Polling failed with result: ${JSON.stringify(result)}`);
    }

    await new Promise(resolve => setTimeout(resolve, interval));
    interval = Math.min(interval * 1.5, maxInterval); // Exponential backoff with cap
    attempts++;
  }

  throw new Error(`Polling timeout after ${attempts} attempts`);
}

/**
 * Sanitizes error messages for user display
 * Prevents leaking internal API details
 */
export function sanitizeErrorMessage(error: any): string {
  if (error instanceof TimeoutError) {
    return 'The request timed out. Please try again.';
  }

  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return 'Authentication failed. Please check your credentials.';
    }
    if (error.status === 429) {
      return 'Rate limit exceeded. Please try again in a few moments.';
    }
    if (error.status >= 500) {
      return 'The service is temporarily unavailable. Please try again later.';
    }
    return 'An error occurred while processing your request. Please try again.';
  }

  return 'An unexpected error occurred. Please try again.';
}

