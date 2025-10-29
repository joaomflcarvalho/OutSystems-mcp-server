/**
 * Cloudflare Workers-compatible token manager
 * Uses environment bindings instead of process.env
 */

import { getOutsystemsToken } from '../utils/getOutsystemsToken.worker.js';
import { CachedToken } from '../types/api-types.js';
import { logger } from '../utils/logger.js';
import { Env } from '../worker/types.js';

// A simple in-memory cache for the token
let cachedToken: CachedToken | null = null;

const TOKEN_EXPIRY_BUFFER_SECONDS = 300; // Refresh token 5 minutes before it expires

/**
 * Gets a valid OutSystems API token for Cloudflare Workers
 * Uses environment bindings instead of process.env
 * @param env - Cloudflare Workers environment bindings
 * @returns {Promise<string>} A valid OutSystems API token.
 */
export async function getValidOutSystemsToken(env: Env): Promise<string> {
  const nowInSeconds = Math.floor(Date.now() / 1000);

  // Check if we have a cached token and if it's still valid (with a buffer)
  if (cachedToken && cachedToken.expiresAt > nowInSeconds + TOKEN_EXPIRY_BUFFER_SECONDS) {
    logger.debug('Using cached OutSystems token.');
    return cachedToken.token;
  }

  logger.info('Fetching a new OutSystems token...');
  
  // Validate required environment variables
  if (!env.OS_HOSTNAME || !env.OS_USERNAME || !env.OS_PASSWORD) {
    throw new Error('Missing required environment variables: OS_HOSTNAME, OS_USERNAME, or OS_PASSWORD');
  }
  
  // Get token with actual expiry from API
  const { token: accessToken, expiresIn } = await getOutsystemsToken(
    env.OS_HOSTNAME,
    env.OS_USERNAME,
    env.OS_PASSWORD
  );
  
  // Calculate the absolute expiry time using actual API response
  const expiresAt = nowInSeconds + expiresIn;

  // Cache the new token and its expiry time
  cachedToken = {
    token: accessToken,
    expiresAt: expiresAt,
  };

  logger.info('Successfully fetched and cached a new token.', {
    expiresIn,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  });
  
  return cachedToken.token;
}



