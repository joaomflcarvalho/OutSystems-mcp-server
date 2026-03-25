/**
 * MCP endpoint test script — mimics the exact request sequence Claude.ai sends.
 *
 * Usage:
 *   # Test the deployed Cloudflare Worker (default):
 *   npx tsx scripts/test-mcp.ts
 *
 *   # Test a local wrangler dev server (run `npm run dev` first):
 *   MCP_URL=http://localhost:8787/mcp npx tsx scripts/test-mcp.ts
 *
 *   # Skip the slow healthCheck (full app creation):
 *   SKIP_HEALTH=1 npx tsx scripts/test-mcp.ts
 */

const BASE_URL = process.env.MCP_URL ?? 'https://outsystems-mcp.joaomfcarvalho.workers.dev/mcp';
const SKIP_HEALTH = process.env.SKIP_HEALTH === '1';

let nextId = 1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function section(title: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(bold(cyan(`  ${title}`)));
  console.log('═'.repeat(60));
}

function pass(msg: string) { console.log(green('  ✓ ') + msg); }
function fail(msg: string) { console.log(red('  ✗ ') + msg); }
function info(msg: string) { console.log(dim('    ' + msg)); }

async function mcpCall(method: string, params: Record<string, any> = {}, id?: number | null): Promise<any> {
  const requestId = id !== undefined ? id : nextId++;

  const body: any = { jsonrpc: '2.0', method, params };
  if (requestId !== null) body.id = requestId;

  console.log(dim(`\n  → POST ${BASE_URL}`));
  console.log(dim(`    ${JSON.stringify(body).slice(0, 200)}`));

  const t0 = Date.now();
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;

  if (res.status === 202) {
    pass(`${method}  ${dim(`→ 202 No Content (notification ack)  ${elapsed}ms`)}`);
    return null;
  }

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    fail(`${method}  HTTP ${res.status} — response is not JSON`);
    console.log(red('    Body: ') + text.slice(0, 500));
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }

  if (json.error) {
    fail(`${method}  HTTP ${res.status}  ${elapsed}ms`);
    console.log(red('    JSON-RPC error: ') + JSON.stringify(json.error));
    throw new Error(`JSON-RPC error: ${JSON.stringify(json.error)}`);
  }

  pass(`${method}  ${dim(`HTTP ${res.status}  ${elapsed}ms`)}`);
  return json.result;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testInitialize() {
  section('1. initialize  (Claude.ai sends this first)');
  const result = await mcpCall('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'claude-test-harness', version: '1.0' },
  });
  info(`Server: ${result?.serverInfo?.name} v${result?.serverInfo?.version}`);
  info(`Protocol: ${result?.protocolVersion}`);
  info(`Instructions: ${result?.instructions?.slice(0, 100)}`);

  // Acknowledge — Claude always sends this notification after initialize
  await mcpCall('notifications/initialized', {}, null);
}

async function testListTools() {
  section('2. tools/list');
  const result = await mcpCall('tools/list');
  const tools: any[] = result?.tools ?? [];
  if (tools.length === 0) {
    fail('No tools returned!');
    return;
  }
  pass(`${tools.length} tool(s) registered`);
  for (const t of tools) {
    info(`• ${bold(t.name)}: ${t.description?.slice(0, 80)}`);
  }
}

async function testHealthCheck() {
  section('3. tools/call → healthCheck  (runs full 7-step pipeline)');
  console.log(yellow('  ⏳ This creates a real OutSystems app — can take 3-10 minutes...\n'));

  const t0 = Date.now();
  try {
    const result = await mcpCall('tools/call', { name: 'healthCheck', arguments: {} });
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const text: string = result?.content?.[0]?.text ?? '(empty response)';

    console.log('\n  ' + bold('Pipeline output:'));
    for (const line of text.split('\n')) {
      if (line.startsWith('❌')) {
        console.log(red('    ' + line));
      } else if (line.startsWith('🎉')) {
        console.log(green('    ' + line));
      } else {
        console.log('    ' + line);
      }
    }
    console.log(dim(`\n  Total elapsed: ${elapsed}s`));

    if (text.includes('🎉')) {
      pass('healthCheck completed successfully — full pipeline works!');
    } else if (text.includes('❌')) {
      fail('Pipeline failed — see output above for which step failed');
    }
  } catch (err: any) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    fail(`healthCheck threw after ${elapsed}s: ${err.message}`);
  }
}

async function testCreateApp(prompt: string) {
  section('4. tools/call → createOutSystemsApp');
  console.log(yellow(`  ⏳ Prompt: "${prompt}"\n`));

  const t0 = Date.now();
  try {
    const result = await mcpCall('tools/call', {
      name: 'createOutSystemsApp',
      arguments: { prompt },
    });
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const text: string = result?.content?.[0]?.text ?? '(empty)';

    console.log('\n  ' + bold('Tool output:'));
    for (const line of text.split('\n')) {
      if (line.startsWith('❌')) {
        console.log(red('    ' + line));
      } else if (line.startsWith('🎉')) {
        console.log(green('    ' + line));
      } else {
        console.log('    ' + line);
      }
    }
    console.log(dim(`\n  Total elapsed: ${elapsed}s`));
  } catch (err: any) {
    fail(`createOutSystemsApp threw: ${err.message}`);
  }
}

async function testUnknownMethod() {
  section('5. Unknown method  (error handling check)');
  try {
    await mcpCall('tools/call', { name: 'nonExistentTool', arguments: {} });
    fail('Expected an error but got none');
  } catch {
    pass('Correctly returned error for unknown tool');
  }
}

async function testServerInfo() {
  section('0. Quick connectivity check');
  const res = await fetch(BASE_URL.replace('/mcp', '/health'));
  if (res.ok) {
    const j = await res.json() as any;
    pass(`/health → ${j.status}  (server uptime: ${j.uptime}s)`);
  } else {
    fail(`/health returned HTTP ${res.status}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(bold('\n🔬 OutSystems MCP Endpoint Test Harness'));
console.log(dim(`   Target: ${BASE_URL}`));
console.log(dim(`   Time:   ${new Date().toISOString()}`));

try {
  await testServerInfo();
  await testInitialize();
  await testListTools();

  if (!SKIP_HEALTH) {
    await testHealthCheck();
  } else {
    console.log(yellow('\n  [healthCheck skipped — set SKIP_HEALTH=0 to enable]'));
  }

  await testUnknownMethod();

  console.log('\n' + '═'.repeat(60));
  console.log(green(bold('  All checks done.')));
  console.log('═'.repeat(60) + '\n');
} catch (err: any) {
  console.log('\n' + red('═'.repeat(60)));
  console.log(red(bold('  Test run aborted: ')) + err.message);
  console.log(red('═'.repeat(60)) + '\n');
  process.exit(1);
}
