/**
 * Keep-alive: logs in to an OutSystems environment and lists its apps, so the
 * environment registers developer activity and doesn't hibernate.
 *
 * Uses dedicated KEEPALIVE_* bindings so the MCP server's own OS_* config
 * (the demo environment) is untouched.
 */

import { Env } from './types.js';
import { OutSystemsApiClient } from '../utils/apiClient.js';
import { getOutsystemsToken } from '../utils/getOutsystemsToken.worker.js';

export interface KeepAliveResult {
  ok: boolean;
  hostname: string;
  timestamp: string;
  loggedIn: boolean;
  listedApps: boolean;
  appCount?: number;
  endpoint?: string;
  probes?: Record<string, string>;
  appNames?: unknown[];
  sample?: string;
  error?: string;
}

/**
 * Calls a tool on the tenant's OutSystems MCP endpoint (https://<host>/mcp, Streamable HTTP).
 */
async function callOutSystemsMcpTool(hostname: string, token: string, name: string, args: Record<string, unknown>): Promise<any> {
  const url = `https://${hostname}/mcp`;
  const base = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  const rpc = async (body: object, extra: Record<string, string> = {}) => {
    const res = await fetch(url, { method: 'POST', headers: { ...base, ...extra }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP ${res.status}: ${text.slice(0, 120)}`);
    // Response is JSON or an SSE stream containing one JSON "data:" line.
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    const payload = dataLine ? dataLine.slice(5).trim() : text.trim();
    return { res, json: payload ? JSON.parse(payload) : null };
  };

  const init = await rpc({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'keepalive', version: '1.0.0' } },
  });
  const sessionId = init.res.headers.get('mcp-session-id');
  const session: Record<string, string> = sessionId ? { 'Mcp-Session-Id': sessionId } : {};
  await fetch(url, { method: 'POST', headers: { ...base, ...session }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  const call = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, session);
  if (call.json?.error) throw new Error(`MCP error: ${JSON.stringify(call.json.error).slice(0, 150)}`);
  return call.json?.result;
}

const KV_REFRESH_KEY = 'refresh_token';

/**
 * Exchanges a Keycloak refresh token for an access token. The refresh token
 * rotates, so the newest one is persisted in KV; the secret is the bootstrap/fallback.
 */
function decodeJwtPayload(jwt: string): any {
  const part = jwt.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

async function refreshAccessToken(env: Env, _hostname: string): Promise<string> {
  const candidates: string[] = [];
  const stored = await env.KEEPALIVE_KV?.get(KV_REFRESH_KEY);
  if (stored) candidates.push(stored);
  if (env.KEEPALIVE_REFRESH_TOKEN && env.KEEPALIVE_REFRESH_TOKEN !== stored) candidates.push(env.KEEPALIVE_REFRESH_TOKEN);

  let lastError = 'no refresh token available';
  for (const refreshToken of candidates) {
    try {
      // The token itself says who issued it (central OutSystems IdP) and for which client.
      const claims = decodeJwtPayload(refreshToken);
      const res = await fetch(`${claims.iss}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: claims.azp,
        }).toString(),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) {
        if (data.refresh_token && env.KEEPALIVE_KV) await env.KEEPALIVE_KV.put(KV_REFRESH_KEY, data.refresh_token);
        return data.access_token;
      }
      lastError = `${res.status} ${data.error ?? ''} ${data.error_description ?? ''}`.trim();
    } catch (e: any) {
      lastError = `unreadable refresh token (${e.message})`;
    }
  }
  throw new Error(`Refresh token rejected (${lastError}) — sign in again and re-set KEEPALIVE_REFRESH_TOKEN`);
}

export async function runKeepAlive(env: Env): Promise<KeepAliveResult> {
  const hostname = env.KEEPALIVE_HOSTNAME;
  const result: KeepAliveResult = {
    ok: false,
    hostname: hostname ?? '',
    timestamp: new Date().toISOString(),
    loggedIn: false,
    listedApps: false,
  };

  const useRefresh = !!env.KEEPALIVE_REFRESH_TOKEN;
  if (!hostname || (!useRefresh && (!env.KEEPALIVE_USERNAME || !env.KEEPALIVE_PASSWORD))) {
    result.error = 'Missing KEEPALIVE_HOSTNAME and either KEEPALIVE_REFRESH_TOKEN or KEEPALIVE_USERNAME/KEEPALIVE_PASSWORD';
    return result;
  }

  try {
    // Always a fresh login/refresh (no token cache) — that is the activity we want.
    const token = useRefresh
      ? await refreshAccessToken(env, hostname)
      : (await getOutsystemsToken(hostname, env.KEEPALIVE_USERNAME!, env.KEEPALIVE_PASSWORD!)).token;
    result.loggedIn = true;

    // Direct environment APIs (the ones the MCP server already uses).
    const client = new OutSystemsApiClient(hostname);
    const nil = '00000000-0000-0000-0000-000000000000';
    result.probes = {};
    for (const endpoint of [
      '/api/app-generation/v1alpha4/jobs',
      `/api/v1/applications/${nil}`,
      `/api/v1/publications/${nil}`,
    ]) {
      try {
        await client.request<any>(endpoint, { token, timeout: 15000 });
        result.probes[endpoint] = '200';
        result.listedApps = true;
      } catch (e: any) {
        result.probes[endpoint] = `${e.status ?? ''} ${String(e.body ?? e.message).slice(0, 120)}`.trim();
      }
    }
    if (!result.listedApps) result.error = 'No direct API call accepted the token (see probes)';
    result.ok = result.loggedIn && result.listedApps;
  } catch (e: any) {
    result.error = e.message;
  }

  console.log('keepalive', JSON.stringify(result));
  return result;
}
