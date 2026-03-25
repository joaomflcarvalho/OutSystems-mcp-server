/**
 * Direct auth flow test — runs the OutSystems auth steps one by one
 * to identify exactly where it fails, with full error output.
 *
 * Usage: npx tsx scripts/test-auth.ts
 */
import * as dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const OS_HOSTNAME = process.env.OS_HOSTNAME!;
const OS_USERNAME = process.env.OS_USERNAME!;
const OS_PASSWORD = process.env.OS_PASSWORD!;

if (!OS_HOSTNAME || !OS_USERNAME || !OS_PASSWORD) {
  console.error('Missing OS_HOSTNAME, OS_USERNAME, or OS_PASSWORD in .env');
  process.exit(1);
}

const dim  = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`;

function step(n: number, label: string) {
  console.log(`\n${cyan(bold(`Step ${n}:`))} ${label}`);
}
function ok(msg: string)   { console.log(green('  ✓ ') + msg); }
function err(msg: string)  { console.log(red('  ✗ ') + msg); }
function log(msg: string)  { console.log(dim('    ' + msg)); }

const cookies: Record<string, string> = {};

async function fetchWithCookies(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers ?? {});
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookieHeader) headers.set('Cookie', cookieHeader);

  log(`→ ${options.method ?? 'GET'} ${url}`);
  const t0 = Date.now();
  const res = await fetch(url, { ...options, headers });
  log(`← ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`);

  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const parts = setCookie.split(';')[0].split('=');
    if (parts.length === 2) {
      cookies[parts[0]] = parts[1];
      log(`  Cookie set: ${parts[0]}`);
    }
  }
  return res;
}

console.log(bold('\n🔍 OutSystems Auth Flow Debugger'));
console.log(dim(`   Hostname: ${OS_HOSTNAME}`));
console.log(dim(`   Username: ${OS_USERNAME}`));

// ─── Step 1: OIDC Configuration ───────────────────────────────────────────────
step(1, 'OIDC configuration');
const oidcUrl = `https://${OS_HOSTNAME}/identity/.well-known/openid-configuration`;
let authorization_endpoint: string;
let token_endpoint: string;

try {
  const res = await fetchWithCookies(oidcUrl);
  if (!res.ok) {
    err(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const cfg = await res.json() as any;
  authorization_endpoint = cfg.authorization_endpoint;
  token_endpoint = cfg.token_endpoint;
  ok(`authorization_endpoint: ${authorization_endpoint}`);
  ok(`token_endpoint: ${token_endpoint}`);
} catch (e: any) {
  err(`OIDC config failed: ${e.message}`);
  process.exit(1);
}

// ─── Step 2: PKCE ─────────────────────────────────────────────────────────────
step(2, 'PKCE challenge');
const randomBytes = new Uint8Array(32);
crypto.getRandomValues(randomBytes);
const code_verifier = btoa(String.fromCharCode(...randomBytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code_verifier));
const code_challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
ok(`code_verifier length: ${code_verifier.length}`);
ok(`code_challenge: ${code_challenge.slice(0, 20)}...`);
const redirect_url = `https://${OS_HOSTNAME}/authentication/redirect`;

// ─── Step 3a: Authorization → Broker redirect ─────────────────────────────────
step(3, 'Authorization endpoint → broker redirect');
const authParams = new URLSearchParams({
  response_type: 'code',
  client_id: 'unified_experience',
  redirect_uri: redirect_url,
  kc_idp_hint: 'cognito',
  scope: 'openid email profile',
  code_challenge,
  code_challenge_method: 'S256',
});

let brokerLocation: string;
try {
  const res = await fetchWithCookies(`${authorization_endpoint}?${authParams}`, { redirect: 'manual' });
  brokerLocation = res.headers.get('location') ?? '';
  if (!brokerLocation) {
    err(`No Location header. Status: ${res.status}`);
    const body = await res.text();
    log(`Body: ${body.slice(0, 300)}`);
    process.exit(1);
  }
  ok(`Broker redirect: ${brokerLocation.slice(0, 100)}`);
} catch (e: any) {
  err(`Authorization endpoint failed: ${e.message}`);
  process.exit(1);
}

// ─── Step 3b: Broker → Cognito redirect ───────────────────────────────────────
step(4, 'Broker redirect → Cognito parameters');
let state: string, kcUri: string, clientPoolId: string;
try {
  const res = await fetchWithCookies(brokerLocation, { redirect: 'manual' });
  const cognitoLocation = res.headers.get('location') ?? '';
  if (!cognitoLocation) {
    err(`No Location header from broker. Status: ${res.status}`);
    const body = await res.text();
    log(`Body: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  ok(`Cognito redirect: ${cognitoLocation.slice(0, 120)}`);

  const u = new URL(cognitoLocation);
  state = u.searchParams.get('state') ?? '';
  kcUri = u.searchParams.get('redirect_uri') ?? '';
  clientPoolId = u.searchParams.get('client_id') ?? '';

  if (!state || !kcUri || !clientPoolId) {
    err(`Missing params — state=${state}, kcUri=${kcUri}, clientPoolId=${clientPoolId}`);
    process.exit(1);
  }
  ok(`state: ${state.slice(0, 30)}...`);
  ok(`kcUri: ${kcUri}`);
  ok(`clientPoolId: ${clientPoolId}`);
} catch (e: any) {
  err(`Broker follow failed: ${e.message}`);
  process.exit(1);
}

// ─── Step 4: Tenant config → Cognito SRP ─────────────────────────────────────
step(5, 'Tenant config (Cognito pool details)');
let poolId: string, amplifyClientId: string, region: string;
try {
  const res = await fetchWithCookies(`https://${OS_HOSTNAME}/authentication/rest/api/v1/tenant-config`);
  if (!res.ok) {
    err(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json() as any;
  poolId = data.cognitoConfig?.poolId;
  amplifyClientId = data.cognitoConfig?.amplifyClientId;
  region = data.cognitoConfig?.region;
  ok(`poolId: ${poolId}`);
  ok(`amplifyClientId: ${amplifyClientId}`);
  ok(`region: ${region}`);
} catch (e: any) {
  err(`Tenant config failed: ${e.message}`);
  process.exit(1);
}

// ─── Step 5: Cognito SRP ──────────────────────────────────────────────────────
step(6, 'Cognito SRP authentication (native BigInt)');
// Import from worker-compatible file
// We replicate the key math here inline for a direct test
const N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64' +
  'ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B' +
  'F12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
  'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31' +
  '43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';

const N_VAL = BigInt('0x' + N_HEX);
const g_VAL = 2n;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) hex = '0' + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return out;
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function padHex(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  else if ('89abcdefABCDEF'.includes(hex[0])) hex = '00' + hex;
  return hexToBytes(hex);
}
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp & 1n) result = result * base % mod;
    exp >>= 1n;
    base = base * base % mod;
  }
  return result;
}
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer));
}
async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key.buffer, { name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data.buffer));
}

// SRP A
const aBytes = new Uint8Array(128);
crypto.getRandomValues(aBytes);
const a = BigInt('0x' + bytesToHex(aBytes));
const A = modPow(g_VAL, a, N_VAL);
const srpA = A.toString(16);
ok(`SRP A computed (${srpA.length} hex chars)`);

// Initiate auth
log(`Calling Cognito InitiateAuth...`);
const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;
let SRP_B: string, SALT: string, SECRET_BLOCK: string, challengeUser: string;
try {
  const initRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_SRP_AUTH',
      ClientId: amplifyClientId,
      AuthParameters: { USERNAME: OS_USERNAME, SRP_A: srpA },
    }),
  });
  const initData = await initRes.json() as any;
  log(`InitiateAuth response: ${JSON.stringify(initData).slice(0, 200)}`);

  if (initData.ChallengeName !== 'PASSWORD_VERIFIER') {
    err(`Unexpected challenge: ${initData.ChallengeName ?? JSON.stringify(initData)}`);
    process.exit(1);
  }
  ({ SRP_B, SALT, SECRET_BLOCK, USERNAME: challengeUser } = initData.ChallengeParameters);
  ok(`Got PASSWORD_VERIFIER challenge`);
  ok(`challengeUser: ${challengeUser}`);
} catch (e: any) {
  err(`InitiateAuth failed: ${e.message}`);
  process.exit(1);
}

// Compute S
const B = BigInt('0x' + SRP_B);
const effectiveUser = challengeUser ?? OS_USERNAME;
const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const now = new Date();
const pad2 = (n: number) => n.toString().padStart(2,'0');
const timestamp = `${days[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${now.getUTCDate()} ${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}:${pad2(now.getUTCSeconds())} UTC ${now.getUTCFullYear()}`;

const kHash = await sha256(concat(padHex(N_VAL), padHex(g_VAL)));
const k = BigInt('0x' + bytesToHex(kHash));
const uHash = await sha256(concat(padHex(A), padHex(B)));
const u = BigInt('0x' + bytesToHex(uHash));

const saltBig = BigInt('0x' + SALT);
const userInfo = new TextEncoder().encode(`${poolId.split('_')[1]}${effectiveUser}:${OS_PASSWORD}`);
const inner = await sha256(userInfo);
const outer = await sha256(concat(padHex(saltBig), inner));
const x = BigInt('0x' + bytesToHex(outer));

const gx  = modPow(g_VAL, x, N_VAL);
const kgx = k * gx % N_VAL;
const diff = ((B - kgx) % N_VAL + N_VAL) % N_VAL;
const S = modPow(diff, a + u * x, N_VAL);

ok(`SRP S computed`);

// HKDF
const prk = await hmacSha256(padHex(u), padHex(S));
const info = concat(new TextEncoder().encode('Caldera Derived Key'), new Uint8Array([1]));
const authKey = (await hmacSha256(prk, info)).slice(0, 16);

// Signature
const poolShort = poolId.split('_')[1];
const secretBlockBytes = Uint8Array.from(atob(SECRET_BLOCK), c => c.charCodeAt(0));
const message = concat(
  new TextEncoder().encode(poolShort),
  new TextEncoder().encode(effectiveUser),
  secretBlockBytes,
  new TextEncoder().encode(timestamp)
);
const sig = await hmacSha256(authKey, message);
const signature = btoa(String.fromCharCode(...sig));
ok(`Signature computed`);

// RespondToAuthChallenge
log(`Calling RespondToAuthChallenge...`);
try {
  const respondRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
    },
    body: JSON.stringify({
      ClientId: amplifyClientId,
      ChallengeName: 'PASSWORD_VERIFIER',
      ChallengeResponses: {
        USERNAME: effectiveUser,
        PASSWORD_CLAIM_SECRET_BLOCK: SECRET_BLOCK,
        TIMESTAMP: timestamp,
        PASSWORD_CLAIM_SIGNATURE: signature,
      },
    }),
  });
  const respondData = await respondRes.json() as any;
  log(`RespondToAuthChallenge: ${JSON.stringify(respondData).slice(0, 300)}`);

  if (!respondData.AuthenticationResult) {
    err(`SRP auth failed: ${JSON.stringify(respondData)}`);
    process.exit(1);
  }
  ok(`✅ Cognito SRP auth SUCCESS`);
  ok(`IdToken length: ${respondData.AuthenticationResult.IdToken?.length}`);
  ok(`AccessToken length: ${respondData.AuthenticationResult.AccessToken?.length}`);
  ok(`RefreshToken length: ${respondData.AuthenticationResult.RefreshToken?.length}`);
} catch (e: any) {
  err(`RespondToAuthChallenge failed: ${e.message}`);
  process.exit(1);
}

console.log('\n\x1b[32m\x1b[1m✅ Auth flow completed successfully!\x1b[0m\n');
