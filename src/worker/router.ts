/**
 * Simple router for Cloudflare Workers
 */

import { Env, McpInvokeRequest, HealthCheckResponse, MetricsResponse } from './types.js';
import { validateAuth, unauthorizedResponse } from './auth.js';
import { createOutSystemsAppStream, healthCheckHandler } from '../mcp/handlers.js';
import { handleCorsPreFlight, addCorsHeaders } from './cors.js';

// Simple metrics tracking
let requestCount = 0;
const startTime = Date.now();

/**
 * Routes incoming requests to appropriate handlers
 */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleCorsPreFlight(request);
  }
  
  requestCount++;
  
  try {
    // Public health check endpoint
    if (url.pathname === '/health' && request.method === 'GET') {
      return addCorsHeaders(await handleHealth(env), request);
    }
    
    // Public metrics endpoint
    if (url.pathname === '/metrics' && request.method === 'GET') {
      return addCorsHeaders(handleMetrics(), request);
    }
    
    // Protected MCP invoke endpoint
    if (url.pathname === '/mcp/invoke' && request.method === 'POST') {
      // Validate authentication
      if (!validateAuth(request, env)) {
        return addCorsHeaders(unauthorizedResponse(), request);
      }
      
      return addCorsHeaders(await handleMcpInvoke(request, env), request);
    }
    
    // 404 for unknown routes
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          error: 'Not Found',
          message: 'The requested endpoint does not exist'
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      ),
      request
    );
    
  } catch (error: any) {
    console.error('Request handler error:', error);
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: 'An unexpected error occurred'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      ),
      request
    );
  }
}

/**
 * Health check handler - returns 200 OK without checking OutSystems API
 * to ensure ChatGPT can verify the server is reachable
 */
async function handleHealth(env: Env): Promise<Response> {
  // Simple health check that doesn't require OutSystems authentication
  const response: HealthCheckResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '3.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000)
  };
  
  return new Response(
    JSON.stringify(response),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * Metrics handler
 */
function handleMetrics(): Response {
  const response: MetricsResponse = {
    requestCount,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: '3.0.0',
    lastRequest: new Date().toISOString()
  };
  
  return new Response(
    JSON.stringify(response),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * MCP invoke handler with streaming support
 */
async function handleMcpInvoke(request: Request, env: Env): Promise<Response> {
  try {
    const body: McpInvokeRequest = await request.json();
    
    if (!body.tool) {
      return new Response(
        JSON.stringify({
          error: 'Bad Request',
          message: 'Missing required field: tool'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Route to appropriate handler
    if (body.tool === 'createOutSystemsApp') {
      const { prompt } = body.params;
      
      if (!prompt || typeof prompt !== 'string') {
        return new Response(
          JSON.stringify({
            error: 'Bad Request',
            message: 'Missing or invalid required parameter: prompt'
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
      
      if (prompt.length < 10 || prompt.length > 500) {
        return new Response(
          JSON.stringify({
            error: 'Bad Request',
            message: 'Prompt must be between 10 and 500 characters'
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
      
      // Return streaming response
      return createOutSystemsAppStream(prompt, env);
    }
    
    if (body.tool === 'healthCheck') {
      const result = await healthCheckHandler(env);
      return new Response(
        JSON.stringify({
          type: 'result',
          data: {
            status: result.success ? 'ok' : 'error',
            message: result.message
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Unknown tool
    return new Response(
      JSON.stringify({
        error: 'Bad Request',
        message: `Unknown tool: ${body.tool}`
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: 'Bad Request',
        message: 'Invalid JSON body'
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

