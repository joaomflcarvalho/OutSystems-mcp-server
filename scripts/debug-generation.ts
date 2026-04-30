/**
 * Direct generation flow debugger — bypasses MCP entirely.
 * Shows the raw JSON response at every step so we can see exact field names.
 *
 * Usage: npx tsx scripts/debug-generation.ts
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

const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function section(label: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(bold(cyan(label)));
  console.log('─'.repeat(60));
}
function ok(msg: string)  { console.log(green('  ✓ ') + msg); }
function fail(msg: string){ console.log(red('  ✗ ') + msg); }
function info(msg: string){ console.log(dim('    ' + msg)); }

// ─── Auth ─────────────────────────────────────────────────────────────────────

section('Step 0: Authenticate');
import { getValidOutSystemsToken } from '../src/services/token-manager.js';

let token: string;
try {
  token = await getValidOutSystemsToken();
  ok(`Token acquired (length: ${token.length})`);
} catch (e: any) {
  fail(`Auth failed: ${e.message}`);
  process.exit(1);
}

async function apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `https://${OS_HOSTNAME}${path}`;
  info(`→ ${method} ${url}`);
  const t0 = Date.now();
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const elapsed = Date.now() - t0;
  info(`← ${res.status} ${res.statusText} (${elapsed}ms)`);
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    fail(`HTTP ${res.status}`);
    console.log(red('  Response body:'));
    console.log(red('    ' + JSON.stringify(json, null, 2).replace(/\n/g, '\n    ')));
    throw new Error(`HTTP ${res.status} on ${method} ${path}`);
  }
  return json;
}

const PROMPT = 'Create a simple task management app with a list of tasks that have a title and status.';

// ─── Step 1: Create job ───────────────────────────────────────────────────────

section('Step 1: Create generation job');
let jobId: string;
try {
  const job = await apiCall('POST', '/api/app-generation/v1alpha4/jobs', {
    portfolioKey: null,
  }) as any;
  ok(`Job created`);
  console.log(yellow('  Full response:'));
  console.log(yellow('    ' + JSON.stringify(job, null, 2).replace(/\n/g, '\n    ')));
  jobId = job.key;
  if (!jobId) { fail('No key in response'); process.exit(1); }
  ok(`Job ID: ${jobId}`);
} catch (e: any) {
  fail(e.message);
  process.exit(1);
}

// ─── Step 2: Poll until ReadyToGenerate ──────────────────────────────────────

section('Step 2: Poll until ReadyToGenerate');
let readyStatus: any;
const maxPolls = 60;
for (let i = 0; i < maxPolls; i++) {
  try {
    const status = await apiCall('GET', `/api/app-generation/v1alpha4/jobs/${jobId}`) as any;
    info(`Poll ${i + 1}: status = ${status.status}`);

    if (status.status === 'ReadyToGenerate') {
      ok('Reached ReadyToGenerate!');
      console.log(yellow('\n  *** FULL ReadyToGenerate response (all fields): ***'));
      console.log(yellow('    ' + JSON.stringify(status, null, 2).replace(/\n/g, '\n    ')));
      readyStatus = status;
      break;
    }

    if (status.status === 'Failed') {
      fail('Job failed during preparation');
      console.log(red('    ' + JSON.stringify(status, null, 2)));
      process.exit(1);
    }

    await new Promise(r => setTimeout(r, 2000));
  } catch (e: any) {
    fail(`Poll failed: ${e.message}`);
    process.exit(1);
  }
}

if (!readyStatus) {
  fail(`Job never reached ReadyToGenerate after ${maxPolls} polls`);
  process.exit(1);
}

// ─── Step 2b: Fetch generation-messages ──────────────────────────────────────

section('Step 2b: GET generation-messages');
try {
  const msgs = await apiCall('GET', `/api/app-generation/v1alpha4/jobs/${jobId}/generation-messages`);
  console.log(yellow('  Full generation-messages response:'));
  console.log(yellow('    ' + JSON.stringify(msgs, null, 2).replace(/\n/g, '\n    ')));
} catch (e: any) {
  info(`generation-messages failed (non-fatal): ${e.message}`);
}

// ─── Step 3: Attempt generation with current body ─────────────────────────────

section('Step 3: Trigger generation');
info('Sending prompt as plain JSON string body (per API docs: schema is "string")');
try {
  await apiCall('POST', `/api/app-generation/v1alpha4/jobs/${jobId}/generation`, PROMPT);
  ok('Generation triggered successfully!');
} catch (e: any) {
  fail(`Generation trigger failed: ${e.message}`);
  process.exit(1);
}

// ─── Step 4: Poll until Done ──────────────────────────────────────────────────

section('Step 4: Poll until Done');
let doneStatus: any;
for (let i = 0; i < 120; i++) {
  try {
    const status = await apiCall('GET', `/api/app-generation/v1alpha4/jobs/${jobId}`) as any;
    info(`Poll ${i + 1}: status = ${status.status}`);

    if (status.status === 'Done') {
      ok('Generation complete!');
      console.log(yellow('\n  Full Done response:'));
      console.log(yellow('    ' + JSON.stringify(status, null, 2).replace(/\n/g, '\n    ')));
      doneStatus = status;
      break;
    }

    if (status.status === 'Failed') {
      fail('Generation failed');
      console.log(red('    ' + JSON.stringify(status, null, 2)));
      process.exit(1);
    }

    await new Promise(r => setTimeout(r, 3000));
  } catch (e: any) {
    fail(`Poll failed: ${e.message}`);
    process.exit(1);
  }
}

if (!doneStatus) { fail('Timed out waiting for Done'); process.exit(1); }

const applicationKey = doneStatus.appSpec?.appKey;
if (!applicationKey) { fail('No appKey in Done response'); process.exit(1); }
ok(`Application key: ${applicationKey}`);
