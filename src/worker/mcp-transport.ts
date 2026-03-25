/**
 * MCP Streamable HTTP transport for Cloudflare Workers
 *
 * Bridges web-standard Request/Response to the MCP SDK using InMemoryTransport.
 * Each POST is handled statelessly — a fresh McpServer is created per request.
 *
 * Claude.ai connector protocol:
 *   POST /mcp  → JSON-RPC request  → JSON-RPC response
 *   POST /mcp  → JSON-RPC notification (no id) → 202 No Content
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Env } from './types.js';

import { addCorsHeaders, handleCorsPreFlight } from './cors.js';
import { createAndDeployApp } from '../services/outsystems-api.worker.js';

import { hasConfigInEnv } from '../utils/runtime-config.worker.js';

/**
 * Builds a fresh McpServer with tools wired to Cloudflare Worker env bindings.
 * Config comes from Wrangler secrets (OS_HOSTNAME, OS_USERNAME, etc.) — no
 * runtime configuration tool is needed in this mode.
 */
function buildWorkerServer(env: Env): McpServer {
  const server = new McpServer({
    name: 'outsystems-mcp',
    version: '3.0.0',
    instructions: 'Creates and deploys OutSystems applications from natural language prompts.',
  });

  server.tool(
    'healthCheck',
    'Tests the full OutSystems app generation pipeline end-to-end with a sample prompt, executing all 7 API steps: create job, wait for ready, trigger generation, wait for completion, start publication, wait for deployment, retrieve URL.',
    {},
    async () => {
      const testPrompt = 'Create a task management app with Tasks and Projects. Tasks have a title, description, due date, and status. Projects have a name and a list of tasks.';
      const steps: string[] = [];
      try {
        for await (const step of createAndDeployApp(testPrompt, env)) {
          steps.push(step);
        }
        return { content: [{ type: 'text' as const, text: steps.join('\n') }] };
      } catch (error: any) {
        const text = steps.length > 0
          ? steps.join('\n') + '\n❌ ' + error.message
          : `❌ Pipeline check failed: ${error.message}`;
        return { content: [{ type: 'text' as const, text: text }] };
      }
    }
  );

  server.tool(
    'createOutSystemsApp',
    'Creates and deploys a complete OutSystems application from a text prompt. Returns a live URL when done.',
    {
      prompt: z
        .string()
        .min(10)
        .max(500)
        .describe('A detailed description of the application to create (10–500 characters).'),
    },
    async ({ prompt }) => {
      if (!hasConfigInEnv(env)) {
        return {
          content: [{
            type: 'text' as const,
            text: '⚠️ OutSystems environment is not configured. Please set OS_HOSTNAME, OS_USERNAME, OS_PASSWORD, and OS_DEV_ENVID as Wrangler secrets.',
          }],
        };
      }

      const steps: string[] = [];
      try {
        for await (const step of createAndDeployApp(prompt, env)) {
          steps.push(step);
        }
      } catch (error: any) {
        steps.push(`❌ ${error.message}`);
      }
      return { content: [{ type: 'text' as const, text: steps.join('\n') || 'App creation completed.' }] };
    }
  );

  return server;
}

/**
 * Handles a single MCP request by bridging it through InMemoryTransport to a McpServer.
 * Supports: initialize, tools/list, tools/call, and all other JSON-RPC methods.
 */
export async function handleMcpStreamable(
  request: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return handleCorsPreFlight(request);
  }

  if (request.method !== 'POST') {
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      }),
      request
    );
  }

  let body: JSONRPCMessage;
  try {
    body = (await request.json()) as JSONRPCMessage;
  } catch {
    return addCorsHeaders(
      new Response(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      ),
      request
    );
  }

  // Notifications have no `id` — MCP spec says they must not be responded to.
  const requestId = (body as any).id ?? null;
  const isNotification = requestId === null && (body as any).method !== undefined;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildWorkerServer(env);
  await server.connect(serverTransport);

  try {
    if (isNotification) {
      await clientTransport.send(body);
      await server.close();
      return addCorsHeaders(new Response(null, { status: 202 }), request);
    }

    const responsePromise = new Promise<JSONRPCMessage>((resolve, reject) => {
      // createOutSystemsApp can take several minutes
      const timeout = setTimeout(() => reject(new Error('MCP request timed out')), 300_000);

      clientTransport.onmessage = (msg: JSONRPCMessage) => {
        if ((msg as any).id === requestId) {
          clearTimeout(timeout);
          resolve(msg);
        }
      };
    });

    await clientTransport.send(body);
    const response = await responsePromise;
    await server.close();

    return addCorsHeaders(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      request
    );
  } catch (error: any) {
    await server.close();
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: error.message ?? 'Internal error' },
          id: requestId,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      ),
      request
    );
  }
}
