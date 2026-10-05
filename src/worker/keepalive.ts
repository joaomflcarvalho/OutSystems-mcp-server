/**
 * Keep-alive: logs in to an OutSystems environment and lists its apps, so the
 * environment registers developer activity and doesn't hibernate.
 *
 * Uses dedicated KEEPALIVE_* bindings so the MCP server's own OS_* config
 * (the demo environment) is untouched.
 */

import { Env } from './types.js';
import { getOutsystemsToken } from '../utils/getOutsystemsToken.worker.js';
import { OutSystemsApiClient } from '../utils/apiClient.js';

export interface KeepAliveResult {
  ok: boolean;
  hostname: string;
  timestamp: string;
  loggedIn: boolean;
  listedApps: boolean;
  appCount?: number;
  endpoint?: string;
  error?: string;
}

// Undocumented API: candidate list endpoints, tried in order until one succeeds.
const LIST_APPS_ENDPOINTS = ['/api/v1/applications', '/api/v1/applications?limit=50'];

export async function runKeepAlive(env: Env): Promise<KeepAliveResult> {
  const hostname = env.KEEPALIVE_HOSTNAME;
  const result: KeepAliveResult = {
    ok: false,
    hostname: hostname ?? '',
    timestamp: new Date().toISOString(),
    loggedIn: false,
    listedApps: false,
  };

  if (!hostname || !env.KEEPALIVE_USERNAME || !env.KEEPALIVE_PASSWORD) {
    result.error = 'Missing KEEPALIVE_HOSTNAME, KEEPALIVE_USERNAME or KEEPALIVE_PASSWORD';
    return result;
  }

  try {
    // Always a fresh login (no token cache) — the login is the activity we want.
    const { token } = await getOutsystemsToken(hostname, env.KEEPALIVE_USERNAME, env.KEEPALIVE_PASSWORD);
    result.loggedIn = true;

    const client = new OutSystemsApiClient(hostname);
    let lastError = '';
    for (const endpoint of LIST_APPS_ENDPOINTS) {
      try {
        const data: any = await client.request<any>(endpoint, { token, timeout: 15000 });
        const items = Array.isArray(data) ? data : (data?.items ?? data?.applications ?? data?.data ?? []);
        result.listedApps = true;
        result.appCount = Array.isArray(items) ? items.length : undefined;
        result.endpoint = endpoint;
        break;
      } catch (e: any) {
        lastError = `${endpoint}: ${e.message}`;
      }
    }
    if (!result.listedApps) result.error = `List apps failed (${lastError})`;
    result.ok = result.loggedIn && result.listedApps;
  } catch (e: any) {
    result.error = e.message;
  }

  console.log('keepalive', JSON.stringify(result));
  return result;
}
