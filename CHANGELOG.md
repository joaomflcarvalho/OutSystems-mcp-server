# Changelog

All notable changes to the OutSystems MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2025-10-28

### 🚀 Major Release - Cloudflare Workers Support

This is a complete refactor to support production deployment on Cloudflare Workers while maintaining backward compatibility with stdio MCP clients.

### Added

#### Cloudflare Workers Support
- ✨ Full Cloudflare Workers runtime support with HTTP endpoints
- ✨ Worker entry point (`src/worker/index.ts`) with `fetch()` handler
- ✨ Request routing system (`src/worker/router.ts`)
- ✨ Bearer token authentication (`src/worker/auth.ts`)
- ✨ CORS handling for ChatGPT integration (`src/worker/cors.ts`)
- ✨ Streaming progress updates via Server-Sent Events (SSE)
- ✨ Health check endpoint (`GET /health`)
- ✨ Metrics endpoint (`GET /metrics`)
- ✨ MCP invoke endpoint (`POST /mcp/invoke`)

#### Documentation
- 📚 **PUBLISHING.md** - Complete deployment and ChatGPT setup guide
- 📚 **SECURITY.md** - Comprehensive security documentation
- 📚 **DEPLOYMENT_CHECKLIST.md** - Step-by-step deployment verification
- 📚 **ENV_TEMPLATE.md** - Environment variables reference
- 📚 **CHANGELOG.md** - This file
- 📚 Updated README.md with Worker deployment instructions

#### CI/CD
- 🤖 GitHub Actions CI workflow (`.github/workflows/ci.yml`)
- 🤖 GitHub Actions deployment workflow (`.github/workflows/deploy.yml`)
- 🤖 Automatic deployment on push to main branch
- 🤖 Automated testing in CI pipeline

#### Testing
- ✅ Vitest test framework setup
- ✅ Worker endpoint tests (`test/worker.test.ts`)
- ✅ MCP validation tests (`test/mcp.test.ts`)
- ✅ Authentication tests
- ✅ CORS tests
- ✅ Input validation tests

#### Configuration
- ⚙️ `wrangler.toml` - Cloudflare Workers configuration
- ⚙️ `vitest.config.ts` - Test configuration
- ⚙️ `.eslintrc.json` - Code linting rules
- ⚙️ `.prettierrc.json` - Code formatting rules
- ⚙️ Updated `tsconfig.json` for Workers compatibility

#### MCP Server Core
- 🔧 Refactored MCP server logic (`src/mcp/server.ts`)
- 🔧 Separated stdio entry point (`src/mcp/server-stdio.ts`)
- 🔧 MCP tool handlers (`src/mcp/handlers.ts`)
- 🔧 MCP manifest (`src/mcp/manifest.json`)

#### Security
- 🔒 Bearer token authentication for all protected endpoints
- 🔒 CORS whitelisting (ChatGPT, localhost)
- 🔒 Input validation with Zod schemas
- 🔒 Error sanitization (no sensitive data exposure)
- 🔒 Secret management via Wrangler CLI

### Changed

#### Breaking Changes
- 💥 Main entry point changed from `dist/stdio-server.js` to `dist/mcp/server-stdio.js`
- 💥 Requires `MCP_SERVER_SECRET` environment variable for Workers deployment
- 💥 TypeScript module resolution changed from `Node16` to `bundler`

#### Improvements
- ⚡ Refactored UUID generation to use Web Crypto API (Node + Workers compatible)
- ⚡ Updated package.json with Workers-specific dependencies
- ⚡ Improved error handling and user-friendly error messages
- ⚡ Better structured logging with correlation IDs
- ⚡ Enhanced type safety across the codebase

#### Dependencies
- ➕ Added `@cloudflare/workers-types` for Worker type definitions
- ➕ Added `vitest` for testing
- ➕ Added `wrangler` for Workers deployment
- ➕ Added `eslint` and `prettier` for code quality
- ➖ Removed unused `express`, `cors`, `axios`, and other Node-specific packages from dependencies (moved to devDependencies where needed)

### Fixed
- 🐛 UUID generation now works in both Node.js and Cloudflare Workers
- 🐛 Proper error handling for API timeouts
- 🐛 CORS preflight requests now handled correctly
- 🐛 Environment variable loading in stdio mode

### Deprecated
- ⚠️ Old stdio-server.ts location (use `src/mcp/server-stdio.ts` instead)

### Security
- 🔐 All secrets now managed via Wrangler (never in code)
- 🔐 Enhanced authentication with Bearer tokens
- 🔐 CORS protection enabled by default
- 🔐 Input validation on all endpoints
- 🔐 No secrets logged or exposed in errors

---

## [2.0.0] - 2024

### Added
- Token caching with actual API expiry times
- Exponential backoff for polling
- Retry logic for transient failures
- Structured logging with correlation IDs
- Health check tool
- Input validation (10-500 character constraint)
- Error sanitization
- Comprehensive type definitions

### Changed
- Modular architecture with separated concerns
- Improved API client with timeout handling
- Better error messages for users

---

## [1.0.0] - 2024

### Added
- Initial release
- Basic MCP server for OutSystems app generation
- stdio transport support
- createOutSystemsApp tool
- OutSystems API integration
- Cognito authentication flow

---

## Upgrade Guide

### From 2.x to 3.0.0

#### For Stdio Users (Raycast, etc.)

1. Update your MCP configuration:
   ```json
   {
     "args": [
       "/path/to/dist/mcp/server-stdio.js"  // Changed from dist/stdio-server.js
     ]
   }
   ```

2. Rebuild the project:
   ```bash
   npm install
   npm run build
   ```

#### For New Cloudflare Workers Deployment

1. Install new dependencies:
   ```bash
   npm install
   ```

2. Configure secrets:
   ```bash
   wrangler secret put OS_HOSTNAME
   wrangler secret put OS_USERNAME
   wrangler secret put OS_PASSWORD
   wrangler secret put OS_DEV_ENVID
   wrangler secret put MCP_SERVER_SECRET
   ```

3. Deploy:
   ```bash
   npm run deploy:production
   ```

See **PUBLISHING.md** for complete instructions.

---

## Versioning Policy

- **Major** (X.0.0): Breaking changes, major new features
- **Minor** (x.X.0): New features, backward compatible
- **Patch** (x.x.X): Bug fixes, security patches

---

**For detailed deployment instructions, see [PUBLISHING.md](./PUBLISHING.md)**  
**For security information, see [SECURITY.md](./SECURITY.md)**

