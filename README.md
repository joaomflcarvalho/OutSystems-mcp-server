# OutSystems MCP Server

<p align="center">
  <strong>Build and deploy OutSystems applications from natural language</strong><br/>
  <em>Works with Raycast, Claude Desktop, and Claude.ai</em>
</p>

![Demo](demos/demo.gif)

## What is This?

An **MCP (Model Context Protocol) server** that lets AI assistants create and deploy complete OutSystems applications from a text prompt. Describe what you want to build, and the server handles everything: authentication, code generation, and deployment — returning a live URL.

It supports two use cases:

1. **Raycast / Claude Desktop** — Run locally via stdio. Your credentials stay on your machine.
2. **Claude.ai connector** — Deploy to Cloudflare Workers and connect as a custom integration in Claude.ai.

---

## Use Case 1 — Raycast & Claude Desktop (Stdio)

### Setup

**1. Clone and build**

```bash
git clone https://github.com/joaomflcarvalho/OutSystems-mcp-server.git
cd OutSystems-mcp-server
npm install
npm run build
```

**2. Create a `.env` file**

```bash
OS_HOSTNAME=your-org.outsystems.dev
OS_USERNAME=your-email@example.com
OS_PASSWORD=your-password
OS_DEV_ENVID=your-dev-env-uuid

# Optional
LOG_LEVEL=info
DEBUG=false
```

> **Never commit `.env` to git.**

**Finding `OS_DEV_ENVID`:** Go to `https://<your-hostname>/apps`, click any app, and copy the `stageid` UUID from the URL.

### Raycast Configuration

Add to your `mcp-config.json`:

```json
{
  "mcpServers": {
    "outsystems": {
      "command": "node",
      "args": ["/absolute/path/to/outsystems-mcp-server/dist/mcp/server-stdio.js"],
      "env": {
        "OS_HOSTNAME": "your-org.outsystems.dev",
        "OS_USERNAME": "your-email@example.com",
        "OS_PASSWORD": "your-password",
        "OS_DEV_ENVID": "your-dev-env-uuid"
      }
    }
  }
}
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "outsystems": {
      "command": "node",
      "args": ["/absolute/path/to/outsystems-mcp-server/dist/mcp/server-stdio.js"],
      "env": {
        "OS_HOSTNAME": "your-org.outsystems.dev",
        "OS_USERNAME": "your-email@example.com",
        "OS_PASSWORD": "your-password",
        "OS_DEV_ENVID": "your-dev-env-uuid"
      }
    }
  }
}
```

### Example Prompts

Once connected, ask:

> **"Create a task management app with Tasks and Projects. Tasks have a title, due date, and status. Projects group multiple tasks."**

> **"Build an employee directory with Employees and Departments. Each employee has a name, role, and photo."**

> **"Create an expense tracker with Expenses and Categories. Expenses have an amount, date, and description."**

> **Note:** OutSystems requires at least 2 data entities in your description. The more detail you provide, the better the generated app.

---

## Use Case 2 — Claude.ai Custom Connector

This deploys the MCP server to Cloudflare Workers and connects it as a custom integration in Claude.ai, so you can build OutSystems apps directly in any Claude.ai conversation.

### 1. Deploy to Cloudflare Workers

**Prerequisites:** A Cloudflare account (free tier works).

```bash
# Install dependencies
npm install

# Login to Cloudflare
npx wrangler login

# Set your OutSystems credentials as secrets
wrangler secret put OS_HOSTNAME
wrangler secret put OS_USERNAME
wrangler secret put OS_PASSWORD
wrangler secret put OS_DEV_ENVID

# Deploy
npm run deploy
```

Your Worker will be live at `https://outsystems-mcp.<your-subdomain>.workers.dev`.

### 2. Add to Claude.ai

1. Go to **Claude.ai** → **Settings** → **Integrations** → **Add custom integration**
2. Enter a name (e.g. `OutSystems`) and your Worker URL:
   ```
   https://outsystems-mcp.<your-subdomain>.workers.dev/mcp
   ```
3. Leave authentication empty (the server uses your Wrangler secrets internally)
4. Click **Connect**

### 3. Use it in Claude.ai

Start a new conversation and ask Claude to build an app:

> **"Use the OutSystems connector to create a customer feedback app with Feedback and Products. Each feedback entry has a rating, comment, and the product it refers to."**

> **"Build an inventory management app in OutSystems with Products and Suppliers. Products have a name, stock level, and price."**

> **"Create a leave request system in OutSystems with LeaveRequests and Employees. Requests have a start date, end date, and approval status."**

Claude will run the tool and show you each step as it progresses:

```
🔐 Authenticating with OutSystems...
🏗️ Step 1/7: Creating generation job...
✓ Job created
⏳ Step 2/7: Waiting for job to be ready...
⚙️ Step 3/7: Generating application logic...
🔄 Step 4/7: Waiting for generation to complete...
✓ Application generated
🚀 Step 5/7: Starting application deployment...
📦 Step 6/7: Waiting for deployment to complete...
🔍 Step 7/7: Retrieving application URL...
🎉 Your app is ready! Access it at: https://your-org-dev.outsystems.app/YourApp
```

### Verify the deployment

```bash
# Quick health check
curl https://outsystems-mcp.<your-subdomain>.workers.dev/health

# Test the full pipeline (creates a real app — takes ~3 minutes)
npx tsx scripts/test-mcp.ts

# Quick connectivity check only
SKIP_HEALTH=1 npx tsx scripts/test-mcp.ts
```

---

## Available Tools

| Tool | Description |
|------|-------------|
| `createOutSystemsApp` | Creates and deploys a complete OutSystems app from a text description. Returns a live URL. |
| `healthCheck` | Runs a full end-to-end test of the pipeline (creates a sample app to verify everything works). |

**Prompt requirements for `createOutSystemsApp`:**
- Must be between 10 and 500 characters
- Should describe **at least 2 data entities** (e.g. Tasks and Projects, Products and Orders)
- More detail produces better apps

---

## Configuration Reference

> **Don't have an OutSystems environment?** Sign up for a free Personal Edition at [try.outsystems.com](https://try.outsystems.com/) — no credit card required. You'll get a fully functional OutSystems Developer Cloud environment to use with this server.

| Variable | Description | Example |
|----------|-------------|---------|
| `OS_HOSTNAME` | Your OutSystems Developer Cloud hostname | `your-org.outsystems.dev` |
| `OS_USERNAME` | Your OutSystems account email | `user@example.com` |
| `OS_PASSWORD` | Your OutSystems account password | `your-password` |
| `OS_DEV_ENVID` | Development environment stage ID (UUID) | `f39f6d4d-439f-...` |

For Cloudflare Workers, set these with `wrangler secret put`. For local stdio mode, put them in `.env`.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm start` | Run stdio MCP server |
| `npm run dev` | Run Worker locally (port 8787) |
| `npm run deploy` | Deploy to Cloudflare Workers |
| `npx tsx scripts/test-mcp.ts` | Test the deployed Worker end-to-end |
| `npx tsx scripts/test-auth.ts` | Debug the OutSystems auth flow step-by-step |
| `wrangler tail` | Stream live Worker logs |

---

## Troubleshooting

**"Failed to generate data model. Please provide at least 2 entities."**
Your prompt doesn't describe enough data entities. Add more detail — e.g. instead of "a to-do app", say "a to-do app with Tasks and Lists where tasks have a title, due date, and completion status."

**Auth fails immediately**
Run `npx tsx scripts/test-auth.ts` to step through the auth flow locally and see exactly which step fails.

**Worker pipeline fails at Step 4+**
The OutSystems generation service is having trouble with your prompt. Try rephrasing with more explicit entity names and fields.

**Claude.ai shows "connection failed"**
Verify your Worker URL ends in `/mcp` and the Worker is responding:
```bash
curl -X POST https://outsystems-mcp.<your-subdomain>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

---

## License

[MIT License](./LICENSE)

---

**Made for the OutSystems and AI communities**
