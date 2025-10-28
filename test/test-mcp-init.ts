import { spawn } from 'child_process';

const serverPath = '/Users/joao.carvalho/Projects/outsystems-mcp-server/dist/stdio-server.js';

// Start the server
const server = spawn('node', [serverPath], {
  env: {
    ...process.env,
    OS_HOSTNAME: 'test.outsystems.dev',
    OS_USERNAME: 'test@example.com',
    OS_PASSWORD: 'test-password',
    OS_DEV_ENVID: 'test-uuid',
    LOG_LEVEL: 'debug'
  }
});

let stdoutData = '';
let stderrData = '';

server.stdout.on('data', (data) => {
  stdoutData += data.toString();
  console.log('STDOUT:', data.toString());
});

server.stderr.on('data', (data) => {
  stderrData += data.toString();
  console.log('STDERR:', data.toString());
});

// Send initialize request
setTimeout(() => {
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    }
  };
  
  console.log('Sending initialize request:', JSON.stringify(initRequest));
  server.stdin.write(JSON.stringify(initRequest) + '\n');
}, 1000);

// Wait for response
setTimeout(() => {
  console.log('\n=== Test Complete ===');
  console.log('STDOUT data:', stdoutData);
  console.log('STDERR data:', stderrData);
  server.kill();
  process.exit(0);
}, 5000);

