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
  appNames?: unknown[];
  sample?: string;
  error?: string;
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

    // Asset Versioning API: GET /api/source-control/v2/assets (Bearer JWT)
    const client = new OutSystemsApiClient(hostname);
    const endpoint = '/api/source-control/v2/assets?limit=100&assetTypes=WebApplication&assetTypes=MobileApplication';
    try {
      const data: any = await client.request<any>(endpoint, { token, timeout: 20000 });
      const items: any[] = data?.results ?? [];
      result.listedApps = true;
      result.endpoint = '/api/source-control/v2/assets';
      result.appCount = data?.page?.totalResults ?? items.length;
      result.appNames = items.slice(0, 50).map((a) => a.name);
    } catch (e: any) {
      result.error = `List apps failed: ${e.status ?? ''} ${String(e.body ?? e.message).slice(0, 160)}`.trim();
    }
    result.ok = result.loggedIn && result.listedApps;
  } catch (e: any) {
    result.error = e.message;
  }

  console.log('keepalive', JSON.stringify(result));
  return result;
}
