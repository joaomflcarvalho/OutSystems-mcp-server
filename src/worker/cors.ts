/**
 * CORS handling for Cloudflare Workers
 */

/**
 * Allowed origins for CORS
 */
const ALLOWED_ORIGINS = [
  'https://chat.openai.com',
  'https://chatgpt.com',
  'http://localhost:3000',
  'http://localhost:8787' // Wrangler dev server
];

/**
 * Checks if origin is allowed
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Gets CORS headers for a request
 */
export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  
  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  
  return headers;
}

/**
 * Handles CORS preflight requests
 */
export function handleCorsPreFlight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request)
  });
}

/**
 * Adds CORS headers to a response
 */
export function addCorsHeaders(response: Response, request: Request): Response {
  const newHeaders = new Headers(response.headers);
  const corsHeaders = getCorsHeaders(request);
  
  Object.entries(corsHeaders).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

