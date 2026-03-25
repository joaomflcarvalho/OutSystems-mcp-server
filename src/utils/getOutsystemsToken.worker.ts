/**
 * Cloudflare Workers-compatible OutSystems authentication
 *
 * Uses native BigInt + SubtleCrypto for Cognito SRP (via cognito-srp.worker.ts),
 * which is 5-10x faster than amazon-cognito-identity-js (bn.js) and fits within
 * Cloudflare Workers' CPU time limit.
 */

import { cognitoSrpAuth } from './cognito-srp.worker.js';
import { TokenResponse } from "../types/api-types.js";
import { logger } from "./logger.js";

/**
 * Main auth orchestration for Cloudflare Workers.
 */
export const getOutsystemsToken = async (
  OS_HOSTNAME: string,
  OS_USERNAME: string,
  OS_PASSWORD: string,
): Promise<TokenResponse> => {
  try {
    const cookies: Record<string, string> = {};

    const fetchWithCookies = async (url: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers || {});
      const cookieHeader = Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
      if (cookieHeader) headers.set('Cookie', cookieHeader);

      const response = await fetch(url, { ...options, headers });

      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const cookieParts = setCookie.split(';')[0].split('=');
        if (cookieParts.length === 2) cookies[cookieParts[0]] = cookieParts[1];
      }

      return response;
    };

    // 1. Get OIDC configuration
    const oidcConfigUrl = `https://${OS_HOSTNAME}/identity/.well-known/openid-configuration`;
    const oidcConfigResponse = await fetchWithCookies(oidcConfigUrl);
    const oidcConfig = await oidcConfigResponse.json() as any;
    const { authorization_endpoint, token_endpoint } = oidcConfig;

    // 2. Generate PKCE codes
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const code_verifier = btoa(String.fromCharCode(...randomBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(code_verifier));
    const code_challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const redirect_url = `https://${OS_HOSTNAME}/authentication/redirect`;

    // 3a. Hit the authorization endpoint — redirects to broker/os-builtin/login
    const authPageParams = new URLSearchParams({
      response_type: "code",
      client_id: "unified_experience",
      redirect_uri: redirect_url,
      kc_idp_hint: "cognito",
      scope: "openid email profile",
      code_challenge,
      code_challenge_method: "S256",
    });

    const authPageResponse = await fetchWithCookies(
      `${authorization_endpoint}?${authPageParams.toString()}`,
      { redirect: 'manual' }
    );
    const brokerLocation = authPageResponse.headers.get('location');
    if (!brokerLocation) {
      throw new Error("Failed to get broker redirect from authorization endpoint.");
    }

    // 3b. Follow broker redirect — gets Cognito redirect with state, kcUri, clientPoolId
    const brokerResponse = await fetchWithCookies(brokerLocation, { redirect: 'manual' });
    const cognitoLocation = brokerResponse.headers.get('location');
    if (!cognitoLocation) {
      throw new Error("Failed to get Cognito redirect from broker endpoint.");
    }

    const responseUrl = new URL(cognitoLocation);
    const state = responseUrl.searchParams.get("state");
    const kcUri = responseUrl.searchParams.get("redirect_uri");
    const clientPoolId = responseUrl.searchParams.get("client_id");

    if (!state || !kcUri || !clientPoolId) {
      throw new Error(
        `Failed to retrieve state, kcUri, or clientPoolId. Got URL: ${cognitoLocation}`
      );
    }

    // 4. Perform Cognito SRP auth using native BigInt (fast, no bn.js)
    const configUrl = `https://${OS_HOSTNAME}/authentication/rest/api/v1/tenant-config`;
    const configResponse = await fetchWithCookies(configUrl);
    const configData = await configResponse.json() as any;
    const { poolId, amplifyClientId, region } = configData.cognitoConfig;

    const cognitoTokens = await cognitoSrpAuth(
      OS_USERNAME,
      OS_PASSWORD,
      poolId,
      amplifyClientId,
      region
    );

    // 5. Exchange Cognito tokens for OutSystems auth code
    const storeTokenUrl = `https://${OS_HOSTNAME}/identityapi/v1alpha1/oidc/store-token`;
    const storeTokenResponse = await fetchWithCookies(storeTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ClientId: clientPoolId, ...cognitoTokens }),
    });
    const storeTokenData = await storeTokenResponse.json() as any;
    const codeFromIdentity = storeTokenData.authCode;

    // 6. Exchange for Keycloak authorization code
    const keycloakUrl = `${kcUri}?code=${codeFromIdentity}&state=${state}`;
    const keycloakResponse = await fetchWithCookies(keycloakUrl, { redirect: 'manual' });
    const location = keycloakResponse.headers.get('location');
    if (!location) throw new Error('Failed to get redirect location from Keycloak');

    const finalRedirectUrl = new URL(location, redirect_url);
    const finalCode = finalRedirectUrl.searchParams.get("code");
    if (!finalCode) throw new Error("Failed to retrieve final authorization code.");

    // 7. Exchange for platform access token
    const tokenRequestData = new URLSearchParams({
      grant_type: "authorization_code",
      code: finalCode,
      code_verifier,
      redirect_uri: redirect_url,
      client_id: "unified_experience",
    });

    const tokenResponse = await fetchWithCookies(token_endpoint, {
      method: 'POST',
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequestData.toString(),
    });

    const tokenData = await tokenResponse.json() as any;
    const expiresIn = tokenData.expires_in || 3600;

    logger.debug('Successfully obtained OutSystems token', { expiresIn });

    return { token: tokenData.access_token, expiresIn };
  } catch (error: any) {
    logger.error("Failed to complete OutSystems authentication flow.", error);
    throw new Error("OutSystems authentication failed: " + error.message);
  }
};
