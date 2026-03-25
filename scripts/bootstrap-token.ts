/**
 * Run once locally to get the Cognito refresh token.
 * The refresh token lasts ~30 days and lets the Worker avoid SRP auth entirely.
 *
 * Usage:
 *   npx ts-node --esm scripts/bootstrap-token.ts
 *
 * Then store the printed refresh token:
 *   echo "<token>" | npx wrangler secret put COGNITO_REFRESH_TOKEN
 */

import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: join(fileURLToPath(import.meta.url), '../../.env') });

const hostname = process.env.OS_HOSTNAME;
const username = process.env.OS_USERNAME;
const password = process.env.OS_PASSWORD;

if (!hostname || !username || !password) {
  console.error('Missing OS_HOSTNAME, OS_USERNAME, or OS_PASSWORD in src/.env');
  process.exit(1);
}

const configRes = await fetch(`https://${hostname}/authentication/rest/api/v1/tenant-config`);
const configData = await configRes.json() as any;
const cognitoConfig = configData.cognitoConfig;

const userPool = new CognitoUserPool({
  UserPoolId: cognitoConfig.poolId,
  ClientId: cognitoConfig.amplifyClientId,
});

const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
const authDetails = new AuthenticationDetails({ Username: username, Password: password });

cognitoUser.authenticateUser(authDetails, {
  onSuccess: (result) => {
    const refreshToken = result.getRefreshToken().getToken();
    console.log('\n✅ SRP auth successful!\n');
    console.log('Run this command to store the refresh token as a Wrangler secret:\n');
    console.log(`echo "${refreshToken}" | npx wrangler secret put COGNITO_REFRESH_TOKEN\n`);
  },
  onFailure: (err) => {
    console.error('❌ Auth failed:', err.message);
    process.exit(1);
  },
});
