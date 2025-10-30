/**
 * Authentication middleware for Cloudflare Workers
 */

import { Env } from './types.js';

/**
 * Validates Bearer token from Authorization header
 */
export function validateAuth(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader) {
    return false;
  }
  
  const [scheme, token] = authHeader.split(' ');
  
  if (scheme !== 'Bearer' || !token) {
    return false;
  }
  
  return token === env.MCP_SERVER_SECRET;
}

/**
 * Creates an unauthorized response
 */
export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer'
      }
    }
  );
}

/**
 * Creates a forbidden response
 */
export function forbiddenResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'Forbidden',
      message: 'You do not have permission to access this resource'
    }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
}

