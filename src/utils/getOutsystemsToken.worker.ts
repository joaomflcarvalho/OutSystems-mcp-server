/**
 * Cloudflare Workers-compatible OutSystems authentication
 * This version uses native fetch and crypto APIs instead of Node.js libraries
 */

import { TokenResponse } from "../types/api-types.js";
import { logger } from "./logger.js";

/**
 * Generates PKCE challenge and verifier
 */
async function generatePKCE(): Promise<{ code_verifier: string; code_challenge: string }> {
  // Generate random code verifier
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const code_verifier = btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  // Generate code challenge from verifier
  const encoder = new TextEncoder();
  const data = encoder.encode(code_verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const code_challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return { code_verifier, code_challenge };
}

/**
 * Performs Cognito authentication using native fetch
 */
async function cognitoLogin(
  username: string,
  password: string,
  hostname: string
): Promise<{ IdToken: string; AccessToken: string; RefreshToken: string }> {
  // 1. Get the Cognito configuration
  const configUrl = `https://${hostname}/authentication/rest/api/v1/tenant-config`;
  const configResponse = await fetch(configUrl);
  const configData = await configResponse.json() as any;
  const cognitoConfig = configData.cognitoConfig;

  // 2. Initiate Cognito authentication
  const authUrl = `https://cognito-idp.${cognitoConfig.region}.amazonaws.com/`;
  
  const initiateAuthRequest = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: cognitoConfig.amplifyClientId,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
    },
  };

  const authResponse = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify(initiateAuthRequest),
  });

  if (!authResponse.ok) {
    throw new Error(`Cognito authentication failed: ${authResponse.statusText}`);
  }

  const authData = await authResponse.json() as any;
  
  if (!authData.AuthenticationResult) {
    throw new Error('Cognito authentication failed: No authentication result');
  }

  return {
    IdToken: authData.AuthenticationResult.IdToken,
    AccessToken: authData.AuthenticationResult.AccessToken,
    RefreshToken: authData.AuthenticationResult.RefreshToken,
  };
}

/**
 * Main function to orchestrate the entire authentication flow for Cloudflare Workers
 */
export const getOutsystemsToken = async (
  OS_HOSTNAME: string,
  OS_USERNAME: string,
  OS_PASSWORD: string
): Promise<TokenResponse> => {
  try {
    // Store cookies manually since Workers don't have automatic cookie handling
    const cookies: Record<string, string> = {};
    
    const fetchWithCookies = async (url: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers || {});
      
      // Add stored cookies to request
      const cookieHeader = Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
      if (cookieHeader) {
        headers.set('Cookie', cookieHeader);
      }
      
      const response = await fetch(url, { ...options, headers });
      
      // Store cookies from response
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const cookieParts = setCookie.split(';')[0].split('=');
        if (cookieParts.length === 2) {
          cookies[cookieParts[0]] = cookieParts[1];
        }
      }
      
      return response;
    };

    // 1. Get the OIDC configuration
    const oidcConfigUrl = `https://${OS_HOSTNAME}/identity/.well-known/openid-configuration`;
    const oidcConfigResponse = await fetchWithCookies(oidcConfigUrl);
    const oidcConfig = await oidcConfigResponse.json() as any;
    const { authorization_endpoint, token_endpoint } = oidcConfig;

    // 2. Generate PKCE codes
    const { code_verifier, code_challenge } = await generatePKCE();
    const redirect_url = `https://${OS_HOSTNAME}/authentication/redirect`;

    // 3. Start the authorization flow
    const authPageParams = new URLSearchParams({
      response_type: "code",
      client_id: "unified_experience",
      redirect_uri: redirect_url,
      kc_idp_hint: "cognito",
      scope: "openid email profile",
      code_challenge: code_challenge,
      code_challenge_method: "S256",
    });
    
    const authPageResponse = await fetchWithCookies(
      `${authorization_endpoint}?${authPageParams.toString()}`,
      { redirect: 'manual' }
    );
    
    // Get redirect location
    let finalUrl = authPageResponse.headers.get('location') || authPageResponse.url;
    const responseUrl = new URL(finalUrl);
    const state = responseUrl.searchParams.get("state");
    const kcUri = responseUrl.searchParams.get("redirect_uri");
    const clientPoolId = responseUrl.searchParams.get("client_id");

    if (!state || !kcUri || !clientPoolId) {
      throw new Error(
        "Failed to retrieve state, kcUri, or clientPoolId from auth page."
      );
    }

    // 4. Perform Cognito login
    const cognitoTokens = await cognitoLogin(
      OS_USERNAME,
      OS_PASSWORD,
      OS_HOSTNAME
    );

    // 5. Exchange Cognito tokens for OutSystems auth code
    const storeTokenUrl = `https://${OS_HOSTNAME}/identityapi/v1alpha1/oidc/store-token`;
    const storeTokenResponse = await fetchWithCookies(storeTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ClientId: clientPoolId,
        ...cognitoTokens,
      }),
    });
    const storeTokenData = await storeTokenResponse.json() as any;
    const codeFromIdentity = storeTokenData.authCode;

    // 6. Exchange for Keycloak authorization code
    const keycloakUrl = `${kcUri}?code=${codeFromIdentity}&state=${state}`;
    const keycloakResponse = await fetchWithCookies(keycloakUrl, {
      redirect: 'manual'
    });
    
    const location = keycloakResponse.headers.get('location');
    if (!location) {
      throw new Error('Failed to get redirect location from Keycloak');
    }
    
    const finalRedirectUrl = new URL(location, redirect_url);
    const finalCode = finalRedirectUrl.searchParams.get("code");

    if (!finalCode) {
      throw new Error(
        "Failed to retrieve final authorization code from Keycloak redirect."
      );
    }

    // 7. Exchange for platform access token
    const tokenRequestData = new URLSearchParams({
      grant_type: "authorization_code",
      code: finalCode,
      code_verifier: code_verifier,
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
    
    logger.debug('Successfully obtained OutSystems token', {
      expiresIn
    });

    return {
      token: tokenData.access_token,
      expiresIn
    };
  } catch (error: any) {
    logger.error(
      "Failed to complete OutSystems authentication flow.",
      error
    );
    throw new Error("OutSystems authentication failed: " + error.message);
  }
};

