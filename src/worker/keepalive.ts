/**
 * Keep-alive: signs in to the OutSystems environment in a headless browser
 * (Cloudflare Browser Rendering) exactly like a developer would, then opens the
 * portal so the environment registers developer activity and doesn't hibernate.
 *
 * Why a browser: the PE's APIs only accept tokens from an interactive SSO login
 * (OutSystems Community), which cannot be reproduced with plain HTTP calls.
 *
 * Uses dedicated KEEPALIVE_* bindings so the MCP server's own OS_* config
 * (the demo environment) is untouched.
 */

import puppeteer from '@cloudflare/puppeteer';
import { Env } from './types.js';

export interface KeepAliveResult {
  ok: boolean;
  hostname: string;
  timestamp: string;
  loggedIn: boolean;
  usedSavedSession: boolean;
  finalUrl?: string;
  title?: string;
  apiResponses?: Record<string, number>;
  error?: string;
}

const KV_COOKIES_KEY = 'session_cookies';

async function alert(env: Env, result: KeepAliveResult): Promise<void> {
  if (!env.KEEPALIVE_ALERT_WEBHOOK) return;
  try {
    await fetch(env.KEEPALIVE_ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `⚠️ PE keep-alive FAILED for ${result.hostname}: ${result.error ?? 'unknown error'}` }),
    });
  } catch {
    /* alerting is best-effort */
  }
}

export async function runKeepAlive(env: Env): Promise<KeepAliveResult> {
  const hostname = env.KEEPALIVE_HOSTNAME ?? '';
  const result: KeepAliveResult = {
    ok: false,
    hostname,
    timestamp: new Date().toISOString(),
    loggedIn: false,
    usedSavedSession: false,
  };

  if (!hostname || !env.KEEPALIVE_USERNAME || !env.KEEPALIVE_PASSWORD) {
    result.error = 'Missing KEEPALIVE_HOSTNAME, KEEPALIVE_USERNAME or KEEPALIVE_PASSWORD';
    return result;
  }
  if (!env.BROWSER) {
    result.error = 'Missing BROWSER binding (Cloudflare Browser Rendering)';
    return result;
  }

  const base = `https://${hostname}`;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);

    // Evidence that the portal really talked to the environment.
    const api: Record<string, number> = {};
    page.on('response', (res) => {
      const u = new URL(res.url());
      if (u.hostname === hostname && /\/(screenservices|api)\//.test(u.pathname)) {
        const key = `${res.status()}`;
        api[key] = (api[key] ?? 0) + 1;
      }
    });

    // Reuse the previous session when we have one (fewer full logins).
    const saved = await env.KEEPALIVE_KV?.get(KV_COOKIES_KEY);
    if (saved) {
      try {
        await page.setCookie(...JSON.parse(saved));
        result.usedSavedSession = true;
      } catch {
        /* ignore a corrupt saved session */
      }
    }

    const onLoginPage = () => new URL(page.url()).hostname.endsWith('id.outsystems.com');

    await page.goto(`${base}/apps/`, { waitUntil: 'networkidle2' });
    // The PE redirects to the central login when there is no valid session.
    if (!onLoginPage()) await new Promise((r) => setTimeout(r, 1500));

    if (onLoginPage()) {
      await page.waitForSelector('#Input_Email');
      // Dismiss the cookie banner without accepting optional cookies.
      await page.evaluate(() => document.querySelector('#onetrust-consent-sdk')?.remove());
      await page.type('#Input_Email', env.KEEPALIVE_USERNAME, { delay: 25 });
      await page.type('#Input_Password', env.KEEPALIVE_PASSWORD, { delay: 25 });
      await Promise.all([
        page.waitForFunction((h) => location.hostname === h, { timeout: 60000 }, hostname),
        page.keyboard.press('Enter'),
      ]);
      await page.waitForNetworkIdle({ idleTime: 1500, timeout: 45000 }).catch(() => undefined);
    }

    // Open a portal page that loads data (same as a developer browsing the environment).
    await page.goto(`${base}/configurations/organization`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 2000));

    result.finalUrl = page.url().split('?')[0];
    result.title = await page.title();
    result.apiResponses = api;
    result.loggedIn = !onLoginPage();
    result.ok = result.loggedIn && (api['200'] ?? 0) > 0;
    if (!result.ok) result.error = onLoginPage() ? 'Still on the login page after signing in' : 'Portal loaded but no successful API responses seen';

    if (result.loggedIn && env.KEEPALIVE_KV) {
      await env.KEEPALIVE_KV.put(KV_COOKIES_KEY, JSON.stringify(await page.cookies(base, 'https://id.outsystems.com')));
    }
  } catch (e: any) {
    result.error = e?.message ?? String(e);
  } finally {
    await browser?.close().catch(() => undefined);
  }

  console.log('keepalive', JSON.stringify({ ...result }));
  if (!result.ok) await alert(env, result);
  return result;
}
