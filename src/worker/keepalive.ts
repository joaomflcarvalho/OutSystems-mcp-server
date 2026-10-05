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

const KV_REFRESH_KEY = 'refresh_token';

/**
 * Exchanges a Keycloak refresh token for an access token. The refresh token
 * rotates, so the newest one is persisted in KV; the secret is the bootstrap/fallback.
 */
async function refreshAccessToken(env: Env, hostname: string): Promise<string> {
  const oidc: any = await (await fetch(`https://${hostname}/identity/.well-known/openid-configuration`)).json();
  const candidates: string[] = [];
  const stored = await env.KEEPALIVE_KV?.get(KV_REFRESH_KEY);
  if (stored) candidates.push(stored);
  if (env.KEEPALIVE_REFRESH_TOKEN && env.KEEPALIVE_REFRESH_TOKEN !== stored) candidates.push(env.KEEPALIVE_REFRESH_TOKEN);

  let lastError = '';
  for (const refreshToken of candidates) {
    const res = await fetch(oidc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: 'unified_experience',
      }).toString(),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && data.access_token) {
      if (data.refresh_token && env.KEEPALIVE_KV) await env.KEEPALIVE_KV.put(KV_REFRESH_KEY, data.refresh_token);
      return data.access_token;
    }
    lastError = `${res.status} ${data.error ?? ''} ${data.error_description ?? ''}`.trim();
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
