# OutSystems MCP Server

<p align="center">
  <strong>Production-ready Model Context Protocol server for generating OutSystems applications</strong><br/>
  <em>Deploy to Cloudflare Workers • Integrate with ChatGPT • Build apps from natural language</em>
</p>

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/joaomflcarvalho/OutSystems-mcp-server)

## 🚀 What is This?

This is a **Model Context Protocol (MCP) server** that generates and deploys OutSystems applications from natural language descriptions. It supports two deployment modes:

1. **🔌 Stdio Mode** - For local MCP clients (Raycast, Perplexity, etc.)
2. **☁️ Cloudflare Workers** - For ChatGPT GPT Store and HTTP integrations

## ✨ Features

- ✅ **Production-Ready** - Fully tested, typed, and documented
- ✅ **Streaming Progress** - Real-time updates during app creation
- ✅ **Cloudflare Workers** - Serverless deployment with global edge network
- ✅ **ChatGPT Integration** - Publish as a GPT in the GPT Store
- ✅ **Secure by Default** - Bearer token auth, CORS, input validation
- ✅ **Auto-Deployment** - GitHub Actions CI/CD pipeline included
- ✅ **Enterprise-Grade** - Exponential backoff, retries, error handling
- ✅ **Fully Typed** - TypeScript with complete type safety

## 📚 Documentation

- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Quick reference guide
- **[PUBLISHING.md](./PUBLISHING.md)** - Complete deployment & ChatGPT setup guide
- **[SECURITY.md](./SECURITY.md)** - Security features and best practices
- **[OutSystemsAPI_Documentation.md](./src/services/OutSystemsAPI_Documentation.md)** - API integration details

## 🎯 Quick Start

### Prerequisites

- Node.js 18+ 
- OutSystems Developer Cloud account
- Cloudflare account (for Workers deployment)
- ChatGPT Plus (for GPT integration)

### Local Development (Stdio Mode)

Perfect for testing with MCP clients like Raycast:

    ```bash
# 1. Clone and install
    git clone https://github.com/joaomflcarvalho/OutSystems-mcp-server.git
    cd OutSystems-mcp-server
    npm install

# 2. Build
    npm run build

# 3. Configure environment (see Configuration section)
cp .env.example .env
# Edit .env with your OutSystems credentials

# 4. Run stdio server
npm start
```

### Cloudflare Workers Deployment

Deploy to the edge for ChatGPT integration:

```bash
# 1. Install dependencies
npm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Set secrets (see Configuration section)
npm run secrets:setup

# 4. Test locally
npm run dev
# Visit http://localhost:8787/health

# 5. Deploy to production
npm run deploy:production
```

**📖 For detailed deployment instructions, see [PUBLISHING.md](./PUBLISHING.md)**

## ⚙️ Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OS_HOSTNAME` | OutSystems Developer Cloud hostname | `your-org.outsystems.dev` |
| `OS_USERNAME` | OutSystems account email | `user@example.com` |
| `OS_PASSWORD` | OutSystems account password | `your-password` |
| `OS_DEV_ENVID` | Development environment stage ID | `f39f6d4d-439f-...` |
| `MCP_SERVER_SECRET` | API authentication token (Workers only) | `your-secret-token` |

### Finding Your `OS_DEV_ENVID`

1. Navigate to `https://<your-hostname>/apps`
2. Click on any application
3. Look for the `stageid` parameter in the URL
4. Copy the UUID value

Example: `stageid=f39f6d4d-439f-4776-b549-71e3ddd16522`

### Setting Secrets for Cloudflare Workers

```bash
# Set each secret individually
wrangler secret put OS_HOSTNAME
wrangler secret put OS_USERNAME  
wrangler secret put OS_PASSWORD
wrangler secret put OS_DEV_ENVID

# Generate and set a secure MCP_SERVER_SECRET
openssl rand -base64 48 | wrangler secret put MCP_SERVER_SECRET
```

### Local Development Configuration

Create a `.env` file in the project root:

```bash
OS_HOSTNAME=your-org.outsystems.dev
OS_USERNAME=your-email@example.com
OS_PASSWORD=your-password
OS_DEV_ENVID=your-dev-env-uuid
MCP_SERVER_SECRET=your-local-secret

# Optional
LOG_LEVEL=info
DEBUG=false
```

**⚠️ Never commit `.env` to git!**

## 🛠️ Available Scripts

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run build` | Build TypeScript to dist/ |
| `npm start` | Run stdio MCP server (local) |
| `npm run dev` | Run Cloudflare Worker locally |
| `npm run deploy` | Deploy to Cloudflare Workers (dev) |
| `npm run deploy:production` | Deploy to production |
| `npm test` | Run all tests |
| `npm run typecheck` | Type-check without building |

## 🔌 MCP Client Configuration

### Raycast

Add to your `mcp-config.json`:

```json
{
  "mcpServers": {
    "outsystems-generator": {
      "command": "node",
      "args": [
        "/absolute/path/to/outsystems-mcp-server/dist/mcp/server-stdio.js"
      ],
      "env": {
        "OS_HOSTNAME": "your-org.outsystems.dev",
        "OS_USERNAME": "your-email@example.com",
        "OS_PASSWORD": "your-password",
        "OS_DEV_ENVID": "your-dev-env-uuid"
      },
      "autoApprove": ["createOutSystemsApp"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "outsystems": {
      "command": "node",
      "args": ["/path/to/dist/mcp/server-stdio.js"],
      "env": {
        "OS_HOSTNAME": "your-org.outsystems.dev",
        "OS_USERNAME": "your@email.com",
        "OS_PASSWORD": "your-password",
        "OS_DEV_ENVID": "your-uuid"
      }
    }
  }
}
```

## 🌐 HTTP API Endpoints

When deployed to Cloudflare Workers:

### Health Check

```bash
curl https://outsystems-mcp.<subdomain>.workers.dev/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-28T12:00:00.000Z",
  "version": "3.0.0",
  "uptime": 123
}
```

### Metrics

```bash
curl https://outsystems-mcp.<subdomain>.workers.dev/metrics
```

Response:
```json
{
  "requestCount": 42,
  "uptime": 3600,
  "version": "3.0.0",
  "lastRequest": "2025-10-28T12:00:00.000Z"
}
```

### MCP Invoke (Protected)

```bash
curl -X POST https://outsystems-mcp.<subdomain>.workers.dev/mcp/invoke \
  -H "Authorization: Bearer YOUR_MCP_SERVER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "createOutSystemsApp",
    "params": {
      "prompt": "Create a simple task management app with todo lists"
    }
  }'
```

Response (streaming):
```
data: {"type":"progress","data":{"message":"🔐 Authenticating...","step":0,"total":7}}
data: {"type":"progress","data":{"message":"🏗️ Step 1/7: Creating job...","step":1,"total":7}}
...
data: {"type":"result","data":{"url":"https://...","status":"completed"}}
```

## 🧪 Available Tools

### 1. createOutSystemsApp

Creates and deploys a complete OutSystems application from a text prompt.

**Input:**
- `prompt` (string, 10-500 characters): Description of the application

**Output:**
- Real-time progress updates (7 steps)
- Final application URL
- Application key

**Example:**

```typescript
{
  "tool": "createOutSystemsApp",
  "params": {
    "prompt": "Create a customer feedback form with email notifications"
  }
}
```

### 2. healthCheck

Verifies OutSystems API connectivity and authentication.

**Input:** None

**Output:**
- Status message
- Connectivity confirmation

**Example:**

```typescript
{
  "tool": "healthCheck",
  "params": {}
}
```

## 📊 Architecture

```
outsystems-mcp-server/
├── src/
│   ├── mcp/                    # MCP server core
│   │   ├── server.ts           # MCP server logic
│   │   ├── server-stdio.ts     # Stdio entry point
│   │   ├── handlers.ts         # Tool implementations
│   │   └── manifest.json       # MCP metadata
│   ├── worker/                 # Cloudflare Workers
│   │   ├── index.ts            # Worker entry point
│   │   ├── router.ts           # Request routing
│   │   ├── auth.ts             # Authentication
│   │   ├── cors.ts             # CORS handling
│   │   └── types.ts            # Type definitions
│   ├── services/
│   │   ├── outsystems-api.ts   # OutSystems API client
│   │   └── token-manager.ts    # Token caching
│   ├── utils/
│   │   ├── apiClient.ts        # HTTP client + retry
│   │   ├── logger.ts           # Structured logging
│   │   └── getOutsystemsToken.ts # Auth flow
│   └── types/
│       └── api-types.ts        # API type definitions
├── test/                       # Vitest tests
├── .github/workflows/          # CI/CD
├── wrangler.toml               # Cloudflare config
└── package.json
```

## 🔒 Security

### Authentication

- **Bearer Token** - Required for all MCP invoke endpoints
- **CORS Protection** - Whitelist of allowed origins
- **Input Validation** - Zod schemas for all inputs
- **Secret Sanitization** - No secrets in logs or errors

### Best Practices

✅ **DO:**
- Use `wrangler secret put` for all secrets
- Rotate `MCP_SERVER_SECRET` every 90 days
- Use different secrets for dev/prod
- Enable Cloudflare analytics

❌ **DON'T:**
- Commit secrets to git
- Share secrets in plaintext
- Use weak or short tokens
- Disable CORS protection

**📖 For complete security details, see [SECURITY.md](./SECURITY.md)**

## 🚢 Deployment

### Manual Deployment

```bash
# Build and deploy to production
npm run build
npm run deploy:production
```

### Automatic Deployment (GitHub Actions)

Push to `main` branch triggers automatic deployment:

```bash
git add .
git commit -m "feat: add new feature"
git push origin main
```

**Required GitHub Secrets:**
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

**📖 For complete setup, see [PUBLISHING.md](./PUBLISHING.md)**

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npm run typecheck
```

### Test Coverage

- ✅ Worker routing and authentication
- ✅ CORS preflight handling
- ✅ Input validation
- ✅ Error responses
- ✅ MCP tool schemas

## 📈 Monitoring

### Cloudflare Dashboard

1. Go to **Workers & Pages** → `outsystems-mcp`
2. View metrics:
   - Request count
   - Error rate
   - Response time
   - CPU usage

### Logs

```bash
# Tail logs in real-time
wrangler tail

# View recent logs
wrangler tail --format pretty
```

### Setting Up Alerts

1. Go to **Notifications** in Cloudflare
2. Create alerts for:
   - Error rate > 5%
   - Response time > 10s
   - Request rate spikes

## 🤝 ChatGPT Integration

### Create a GPT

1. Go to [ChatGPT](https://chat.openai.com/) → **My GPTs**
2. Click **Create a GPT**
3. Configure:
   - **Name:** OutSystems App Generator
   - **Description:** Creates OutSystems apps from natural language
   - **Instructions:** See [PUBLISHING.md](./PUBLISHING.md)
4. Add Action:
   - **Endpoint:** `https://outsystems-mcp.<subdomain>.workers.dev/mcp/invoke`
   - **Auth:** Bearer Token
   - **Token:** Your `MCP_SERVER_SECRET`
5. Test and publish!

**📖 For complete ChatGPT setup, see [PUBLISHING.md](./PUBLISHING.md)**

## 🐛 Troubleshooting

### Common Issues

#### "401 Unauthorized"

**Cause:** Missing or invalid `MCP_SERVER_SECRET`

**Solution:**
```bash
# Verify secret is set
wrangler secret list

# Reset if needed
wrangler secret put MCP_SERVER_SECRET
```

#### "503 Service Unavailable"

**Cause:** OutSystems API not reachable

**Solution:**
1. Check OutSystems credentials
2. Verify `OS_HOSTNAME` is correct
3. Test health endpoint: `/health`

#### Build Errors

**Cause:** TypeScript compilation issues

**Solution:**
```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

#### CORS Errors

**Cause:** Origin not in allowed list

**Solution:**
Edit `src/worker/cors.ts` and add your origin to `ALLOWED_ORIGINS`

## 🛣️ Roadmap

- [ ] Rate limiting with Cloudflare Workers KV
- [ ] Webhook support for async notifications
- [ ] Multi-app batch creation
- [ ] Custom template support
- [ ] Application update/deletion tools
- [ ] Monitoring dashboard
- [ ] CLI tool for local development

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

[ISC License](./LICENSE)

## 🙏 Acknowledgments

- [Model Context Protocol](https://platform.openai.com/docs/mcp) by OpenAI
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [OutSystems Developer Cloud](https://www.outsystems.com/)

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/joaomflcarvalho/OutSystems-mcp-server/issues)
- **Discussions:** [GitHub Discussions](https://github.com/joaomflcarvalho/OutSystems-mcp-server/discussions)
- **Email:** security@example.com (replace with your email)

---

**Made with ❤️ for the OutSystems and AI communities**

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/joaomflcarvalho/OutSystems-mcp-server)
