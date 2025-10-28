import { getOutsystemsToken } from '../utils/getOutsystemsToken';
import { CachedToken } from '../types/api-types';
import { logger } from '../utils/logger';

// A simple in-memory cache for the token
let cachedToken: CachedToken | null = null;

const TOKEN_EXPIRY_BUFFER_SECONDS = 300; // Refresh token 5 minutes before it expires

/**
 * Gets a valid OutSystems API token, using a cache if available.
 * It will automatically refresh the token if it's expired or about to expire.
 * Uses actual token expiry from API response.
 * @returns {Promise<string>} A valid OutSystems API token.
 */
export async function getValidOutSystemsToken(): Promise<string> {
  const nowInSeconds = Math.floor(Date.now() / 1000);

  // Check if we have a cached token and if it's still valid (with a buffer)
  if (cachedToken && cachedToken.expiresAt > nowInSeconds + TOKEN_EXPIRY_BUFFER_SECONDS) {
    logger.debug('Using cached OutSystems token.');
    return cachedToken.token;
  }

  logger.info('Fetching a new OutSystems token...');
  
  // Get token with actual expiry from API
  const { token: accessToken, expiresIn } = await getOutsystemsToken();
  
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