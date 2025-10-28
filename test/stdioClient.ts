const { spawn } = require("child_process");

const server = spawn("node", ["./dist/stdio-server.js"]); // adjust path and command as needed

// Log child process output (responses from server)
server.stdout.on("data", (data: Buffer) => {
  console.log("[SERVER STDOUT]", data.toString());
});

server.stderr.on("data", (data: Buffer) => {
  console.error("[SERVER STDERR]", data.toString());
});

server.on("close", (code: Buffer) => {
  console.log(`[SERVER EXITED] code: ${code}`);
});

server.on("error", (err: Buffer) => {
  console.error("[PROCESS ERROR]", err);
});

// Compose and send the initialize request
const initializeMsg = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "debug-script", version: "1.0.0" },
  },
};

console.log("[CLIENT]", "Sending initialize:", JSON.stringify(initializeMsg));
server.stdin.write(JSON.stringify(initializeMsg) + "\n");

// 2. After a delay, send tool/execute with your desired input
setTimeout(() => {
  const toolExecuteMsg = {
    jsonrpc: "2.0",
    id: 2,
    method: "tool/execute",
    params: {
      tool_name: "createOutSystemsApp",
      executionId: "exec-timetracking-" + Date.now(), // unique per test
      input: {
        prompt: "A time tracking app for a software delivery team working on multiple projects."
      }
    }
  };
  console.log("[CLIENT] Sending tool/execute:", JSON.stringify(toolExecuteMsg));
  server.stdin.write(JSON.stringify(toolExecuteMsg) + "\n");
}, 5000); // Wait 500ms after initialize (adjust as needed)

// 3. After another delay, send a shutdown request
setTimeout(() => {
  console.log("[CLIENT] Sending shutdown request");
const shutdownMsg = {
  jsonrpc: "2.0",
  id: 3,
  method: "shutdown",
  params: {}
};
server.stdin.write(JSON.stringify(shutdownMsg) + "\n");

// Optional: close stdin so the server process knows it won't get more input
server.stdin.end();
}, 240000); // Wait 4 mintues before shutdown (adjust as needed)

