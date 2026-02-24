/**
 * Cloudflare Workers Entry Point for OutSystems MCP Server
 * 
 * This worker provides both HTTP endpoints for ChatGPT integration
 * and maintains compatibility with the stdio MCP server.
 */

import { Env } from './types.js';
import { handleRequest } from './router.js';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  }
};

export type { Env };

