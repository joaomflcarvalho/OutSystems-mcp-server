/**
 * Cognito SRP authentication using native BigInt + SubtleCrypto
 *
 * Replaces amazon-cognito-identity-js (which uses the slow bn.js library)
 * so that SRP fits within Cloudflare Workers' CPU time limit.
 *
 * Implements the USER_SRP_AUTH + PASSWORD_VERIFIER challenge flow.
 * All hash inputs match exactly what amazon-cognito-identity-js produces.
 */

// ─── SRP Group Parameters (3072-bit RFC 5054 Group 18) ───────────────────────

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

const N = BigInt('0x' + N_HEX);
const g = 2n;

// ─── Utilities ────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) hex = '0' + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Minimal hex padding — exactly as amazon-cognito-identity-js does it:
 * - ensures even number of hex chars
 * - prepends '00' if the first hex digit is in [8-f] (high bit set, avoids sign issues)
 */
function padHex(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  else if ('89abcdefABCDEF'.includes(hex[0])) hex = '00' + hex;
  return hexToBytes(hex);
}

async function sha256(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const buf = data instanceof Uint8Array ? data.buffer as ArrayBuffer : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data.buffer as ArrayBuffer));
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
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

// ─── Cognito-specific hash computations ──────────────────────────────────────

/**
 * k = SHA-256(padHex(N) || padHex(g))
 * Note: padHex(N) = 770 hex chars (385 bytes, 00-prefixed), padHex(g) = '02' (1 byte)
 */
async function computeK(): Promise<bigint> {
  const hash = await sha256(concat(padHex(N), padHex(g)));
  return BigInt('0x' + bytesToHex(hash));
}

/**
 * u = SHA-256(padHex(A) || padHex(B))
 */
async function computeU(A: bigint, B: bigint): Promise<bigint> {
  const hash = await sha256(concat(padHex(A), padHex(B)));
  return BigInt('0x' + bytesToHex(hash));
}

/**
 * x = SHA-256(padHex(salt) || SHA-256(poolShortName + username + ":" + password))
 *
 * IMPORTANT: uses the short pool name (part after "_"), matching amazon-cognito-identity-js
 * which initialises AuthenticationHelper with getUserPoolName() = userPoolId.split('_')[1].
 * Using the full userPoolId here produces the wrong x and causes NotAuthorizedException.
 */
async function computeX(saltHex: string, userPoolId: string, username: string, password: string): Promise<bigint> {
  const salt = BigInt('0x' + saltHex);
  const poolShortName = userPoolId.split('_')[1];
  const userInfo = new TextEncoder().encode(`${poolShortName}${username}:${password}`);
  const inner = await sha256(userInfo);
  const outer = await sha256(concat(padHex(salt), inner));
  return BigInt('0x' + bytesToHex(outer));
}

/**
 * HKDF key derivation matching Cognito's computeHkdf:
 * prk = HMAC-SHA256(salt=padHex(u), msg=padHex(S))
 * key = HMAC-SHA256(prk, 'Caldera Derived Key' + '\x01')[:16]
 */
async function computeHkdf(S: bigint, u: bigint): Promise<Uint8Array> {
  const ikm = padHex(S);
  const salt = padHex(u);
  const prk = await hmacSha256(salt, ikm);
  const info = concat(
    new TextEncoder().encode('Caldera Derived Key'),
    new Uint8Array([1])
  );
  return (await hmacSha256(prk, info)).slice(0, 16);
}

// ─── Timestamp ────────────────────────────────────────────────────────────────

function formatTimestamp(): string {
  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  return `${days[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${now.getUTCDate()} ${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}:${pad2(now.getUTCSeconds())} UTC ${now.getUTCFullYear()}`;
}

// ─── Full Cognito SRP Auth Flow ───────────────────────────────────────────────

export interface CognitoSrpResult {
  IdToken: string;
  AccessToken: string;
  RefreshToken: string;
}

export async function cognitoSrpAuth(
  username: string,
  password: string,
  userPoolId: string,
  clientId: string,
  region: string
): Promise<CognitoSrpResult> {
  const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;

  // Generate client private key a (1024 bits, matching library default)
  const aBytes = new Uint8Array(128);
  crypto.getRandomValues(aBytes);
  const a = BigInt('0x' + bytesToHex(aBytes));
  const A = modPow(g, a, N);
  const srpA = A.toString(16);

  // Step 1: Initiate SRP auth
  const initRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_SRP_AUTH',
      ClientId: clientId,
      AuthParameters: { USERNAME: username, SRP_A: srpA },
    }),
  });

  const initData = await initRes.json() as any;

  if (initData.ChallengeName !== 'PASSWORD_VERIFIER') {
    throw new Error(`Unexpected Cognito challenge: ${initData.ChallengeName ?? JSON.stringify(initData)}`);
  }

  const { SRP_B, SALT, SECRET_BLOCK, USERNAME: challengeUser } = initData.ChallengeParameters;
  const B = BigInt('0x' + SRP_B);
  const effectiveUsername = challengeUser ?? username;
  const timestamp = formatTimestamp();

  // Step 2: Compute S and derive auth key
  const [k, u, x] = await Promise.all([
    computeK(),
    computeU(A, B),
    computeX(SALT, userPoolId, effectiveUsername, password),
  ]);

  const gx = modPow(g, x, N);
  const kgx = k * gx % N;
  const diff = ((B - kgx) % N + N) % N;
  const S = modPow(diff, a + u * x, N);

  const authKey = await computeHkdf(S, u);

  // Step 3: Compute signature
  // Signature uses the short pool name (part after "_")
  const poolShortName = userPoolId.split('_')[1];
  const secretBlockBytes = Uint8Array.from(atob(SECRET_BLOCK), c => c.charCodeAt(0));
  const message = concat(
    new TextEncoder().encode(poolShortName),
    new TextEncoder().encode(effectiveUsername),
    secretBlockBytes,
    new TextEncoder().encode(timestamp)
  );
  const sig = await hmacSha256(authKey, message);
  const signature = btoa(String.fromCharCode(...sig));

  // Step 4: Respond to challenge
  const respondRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
    },
    body: JSON.stringify({
      ClientId: clientId,
      ChallengeName: 'PASSWORD_VERIFIER',
      ChallengeResponses: {
        USERNAME: effectiveUsername,
        PASSWORD_CLAIM_SECRET_BLOCK: SECRET_BLOCK,
        TIMESTAMP: timestamp,
        PASSWORD_CLAIM_SIGNATURE: signature,
      },
    }),
  });

  const respondData = await respondRes.json() as any;

  if (!respondData.AuthenticationResult) {
    throw new Error(`Cognito SRP auth failed: ${JSON.stringify(respondData)}`);
  }

  return {
    IdToken: respondData.AuthenticationResult.IdToken,
    AccessToken: respondData.AuthenticationResult.AccessToken,
    RefreshToken: respondData.AuthenticationResult.RefreshToken,
  };
}
