# MCP Server Security & Structure Review

## Executive Summary

Your OutSystems MCP server has been reviewed against OpenAI's Apps SDK examples and security best practices. Overall, the implementation is **solid** but requires some critical improvements before deployment to ChatGPT.

**Status:** ⚠️ **REQUIRES ACTION** - Security and structure improvements needed

---

## 1. OpenAI Structure Adherence ✅ MOSTLY COMPLIANT

### What You're Doing Right:
- ✅ Using the official `@modelcontextprotocol/sdk` package
- ✅ Proper stdio transport implementation
- ✅ Following MCP protocol with `tools` capability
- ✅ Streaming progress updates using `extra.progress`
- ✅ Proper TypeScript structure with compiled output
- ✅ Tool schema with Zod validation

### Differences from OpenAI Examples:

| Aspect | OpenAI Examples | Your Implementation | Recommendation |
|--------|----------------|---------------------|----------------|
| **Transport** | SSE/HTTP + stdio | stdio only | ✅ Fine for ChatGPT - stdio is correct |
| **Widget/UI** | Returns HTML widgets with `_meta.openai/outputTemplate` | Returns plain text | ⚠️ Consider adding rich UI (see below) |
| **Server Info** | Includes `displayName` | Missing `displayName` | ⚠️ Add for better UX |
| **Environment Config** | Uses `BASE_URL` for asset hosting | Uses direct env vars | ✅ Your approach is fine |

### Key Structural Improvements Needed:

#### 1.1 Add Display Name to Server Info
```typescript
// In stdio-server.ts, line 27-31
const server = new McpServer({
  name: "outsystems-app-generator",
  version: "2.0.0",
  instructions: "Creates and deploys OutSystems applications from prompts.",
  // ADD THIS:
  displayName: "OutSystems App Generator"
});
```

#### 1.2 Consider Adding Rich UI Response (Optional but Recommended)
OpenAI's Apps SDK examples return embedded HTML/widgets. You could enhance your final response:

```typescript
// Example of how OpenAI does it:
return {
  content: [
    { type: "text", text: `🎉 Application is Live at ${lastUrl}` }
  ],
  _meta: {
    "openai/outputTemplate": {
      uri: "https://your-hosted-assets.com/app-success-widget.html",
      data: {
        appUrl: lastUrl,
        appName: "Generated App",
        timestamp: new Date().toISOString()
      }
    }
  }
};
```

---

## 2. Security Analysis 🔴 CRITICAL ISSUES FOUND

### 2.1 CRITICAL: Log File Contains Sensitive Information

**Issue:** `src/error.log` contains your hostname information:
```
Loaded OS_HOSTNAME: joaocarvalhosdemos.outsystems.dev
```

**Risk Level:** 🔴 HIGH - Exposes your organization's infrastructure details

**Fix Required:**
1. Delete the log file from git history if it was committed
2. The file is already in `.gitignore` (good!) but check git history:

```bash
# Check if error.log was ever committed
git log --all --full-history -- "*error.log"

# If found, remove from history:
git filter-repo --path src/error.log --invert-paths
```

### 2.2 CRITICAL: Debug Logging in Production Code

**Issues Found:**
- Line 18 in `stdio-server.ts`: `console.error("Loaded OS_HOSTNAME:", process.env.OS_HOSTNAME);`
- Lines 53-54, 102-103: Debug logging of URLs and messages
- Lines 10-14: Commented-out code that writes to hardcoded file path

**Risk Level:** 🔴 HIGH - Leaks environment configuration

**Fix Required:**
```typescript
// Remove this line (stdio-server.ts:18):
console.error("Loaded OS_HOSTNAME:", process.env.OS_HOSTNAME);

// Replace debug logs with conditional logging:
const DEBUG = process.env.DEBUG === 'true';

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.error('[DEBUG]', ...args);
  }
}

// Then use: debugLog("Progress message:", lastText);
```

### 2.3 MEDIUM: Token Logging

**Issue:** `token-manager.ts` logs token fetch operations:
```typescript
console.error('Using cached OutSystems token.');
console.error('Fetching a new OutSystems token...');
```

**Risk Level:** 🟡 MEDIUM - Verbose logging could expose timing information

**Recommendation:** Use a proper logging library with levels:
```typescript
// Add a logger utility
export const logger = {
  info: (msg: string) => process.env.LOG_LEVEL !== 'silent' && console.error(`[INFO] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err),
  debug: (msg: string) => process.env.DEBUG === 'true' && console.error(`[DEBUG] ${msg}`)
};
```

### 2.4 Security Best Practices Missing

**Issues:**
1. ❌ No input validation on prompt length before API call
2. ❌ No rate limiting for token requests
3. ❌ Error messages leak API implementation details
4. ❌ No timeout configurations for long-running operations

**Recommendations:**

```typescript
// 1. Add input validation
export const inputSchemaShape = {
  prompt: z
    .string()
    .min(10, "Prompt must be at least 10 characters")
    .max(500, "Prompt must not exceed 500 characters") // API limit
    .describe("A prompt with a detailed description of the application..."),
};

// 2. Add timeouts to fetch calls
async function startGenerationJob(token: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, files: [], ignoreTenantContext: true }),
      signal: controller.signal
    });
    // ... rest of code
  } finally {
    clearTimeout(timeout);
  }
}

// 3. Sanitize error messages
catch (error: any) {
  // Don't expose internal API responses
  const userMessage = `Failed to create application. Please try again.`;
  console.error('[ERROR] API Error:', error.message); // Log internally
  yield userMessage; // Return safe message to user
  throw new Error(userMessage);
}
```

---

## 3. Secrets Management ✅ MOSTLY SECURE

### What You're Doing Right:
- ✅ `.env` is in `.gitignore`
- ✅ Using `process.env` for all sensitive data
- ✅ Config files are `.example` files, not actual configs
- ✅ No hardcoded credentials found
- ✅ `*.log` files are ignored
- ✅ `config/default.json` and `config/initialize.json` are in `.gitignore`

### Issues Found:

#### 3.1 CRITICAL: Hardcoded Absolute Path
**Location:** `stdio-server.ts` lines 10-14 (commented out, but still present)

```typescript
/*const errorLogStream = fs.createWriteStream(
  "/Users/joao.carvalho/Projects/outsystems-mcp-server/src/error.log",
  { flags: "a" }
);
process.stderr.write = errorLogStream.write.bind(errorLogStream);*/
```

**Risk:** Exposes your local file system structure

**Fix:** Remove this commented code entirely

#### 3.2 MEDIUM: Config File in Git
**Issue:** `config/initialize.json` is tracked by git (appears in project structure) even though it's in `.gitignore`

**Check Required:**
```bash
git ls-files | grep initialize.json
# If it returns results, remove it:
git rm --cached config/initialize.json
git commit -m "Remove tracked config file"
```

### Recommended `.gitignore` Additions:

```gitignore
# Your current .gitignore is good, but add these for completeness:

# Environment files
.env*
!.env.example

# Logs (you have this, but be explicit)
*.log
logs/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Config files
config/default.json
config/initialize.json
config/*.json
!config/*.example

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Testing
coverage/
.nyc_output/

# Build outputs
dist/
build/

# Sensitive test files
bash-tests/test.sh
```

---

## 4. Coding & Performance Best Practices ⚠️ NEEDS IMPROVEMENT

### 4.1 Performance Issues

#### Issue: Polling Intervals Too Aggressive
```typescript
// In outsystems-api.ts
await delay(5000);  // 5 seconds for ReadyToGenerate
await delay(10000); // 10 seconds for Done/Finished
```

**Problems:**
- Wastes API calls
- May hit rate limits
- No exponential backoff

**Recommendation:**
```typescript
// Implement exponential backoff with max interval
async function pollWithBackoff(
  pollFn: () => Promise<any>,
  checkFn: (status: any) => boolean,
  failFn: (status: any) => boolean,
  maxInterval: number = 30000,
  initialInterval: number = 2000
): Promise<any> {
  let interval = initialInterval;
  let attempts = 0;
  const maxAttempts = 60; // Maximum 60 attempts
  
  while (attempts < maxAttempts) {
    const result = await pollFn();
    
    if (checkFn(result)) return result;
    if (failFn(result)) throw new Error(`Operation failed with status: ${result.status}`);
    
    await delay(interval);
    interval = Math.min(interval * 1.5, maxInterval); // Exponential backoff
    attempts++;
  }
  
  throw new Error(`Polling timeout after ${attempts} attempts`);
}

// Usage:
yield "Step 2/7: Polling for 'ReadyToGenerate' status...";
const jobStatus = await pollWithBackoff(
  () => getJobStatus(token, jobId),
  (status) => status.status === 'ReadyToGenerate',
  (status) => status.status === 'Failed',
  30000, // max 30s between polls
  2000   // start with 2s
);
```

#### Issue: Token Cache Assumes Fixed Expiry
```typescript
// token-manager.ts:30
const expiresAt = nowInSeconds + 3600; // Hardcoded 1 hour
```

**Problem:** Doesn't use actual token expiry from API

**Fix:** Update `getOutsystemsToken` to return expiry info:
```typescript
// In getOutsystemsToken.ts, modify return:
export const getOutsystemsToken = async (): Promise<{token: string, expiresIn: number}> => {
  // ... existing code ...
  const tokenResponse = await session.post(token_endpoint, tokenRequestData, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  
  return {
    token: tokenResponse.data.access_token,
    expiresIn: tokenResponse.data.expires_in || 3600 // Use actual expiry or fallback
  };
};

// In token-manager.ts:
const { token: accessToken, expiresIn } = await getOutsystemsToken();
const expiresAt = nowInSeconds + expiresIn;
```

### 4.2 Code Quality Issues

#### Issue: Repetitive Error Handling
Every function has nearly identical error handling:

**Recommendation:** Create a reusable API client:
```typescript
// New file: src/utils/apiClient.ts
export class OutSystemsApiClient {
  constructor(private hostname: string) {}
  
  async request<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: any;
      token: string;
      timeout?: number;
    }
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
    
    try {
      const response = await fetch(`https://${this.hostname}${endpoint}`, {
        method: options.method || 'GET',
        headers: {
          'Authorization': `Bearer ${options.token}`,
          ...(options.body && { 'Content-Type': 'application/json' })
        },
        ...(options.body && { body: JSON.stringify(options.body) }),
        signal: controller.signal
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new ApiError(response.status, errorBody, endpoint);
      }
      
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public endpoint: string
  ) {
    super(`API Error: ${status} on ${endpoint}`);
  }
}
```

#### Issue: Missing Type Safety
Several functions return `any`:

```typescript
// Change these:
async function getJobStatus(token: string, jobId: string): Promise<any>
async function getPublicationStatus(token: string, publicationKey: string): Promise<any>

// To:
interface JobStatus {
  status: 'Pending' | 'ReadyToGenerate' | 'Generating' | 'Done' | 'Failed';
  appSpec?: { appKey: string };
  // ... other fields
}

interface PublicationStatus {
  status: 'Queued' | 'Running' | 'Finished' | 'Failed';
  key: string;
  // ... other fields
}

async function getJobStatus(token: string, jobId: string): Promise<JobStatus>
async function getPublicationStatus(token: string, publicationKey: string): Promise<PublicationStatus>
```

#### Issue: Commented-Out Code
Remove all commented code (lines 10-14, 67-70, 76-79, 118-120, 125-130 in `stdio-server.ts`)

### 4.3 Observability Issues

**Missing:**
- ❌ No structured logging
- ❌ No error tracking/reporting
- ❌ No metrics/monitoring
- ❌ No correlation IDs for debugging

**Recommendation:**
```typescript
// Add correlation IDs to track requests
import { randomUUID } from 'crypto';

export async function* createAndDeployApp(prompt: string): AsyncGenerator<string> {
  const correlationId = randomUUID();
  const logger = createLogger(correlationId);
  
  logger.info('Starting app creation', { prompt: prompt.substring(0, 50) + '...' });
  
  try {
    // ... existing code with logger.info/debug/error calls
  } catch (error) {
    logger.error('App creation failed', { error: error.message });
    throw error;
  }
}
```

---

## 5. Additional Recommendations for ChatGPT Deployment

### 5.1 Add Health Check Endpoint
Since ChatGPT will be calling your server, consider adding a health check:

```typescript
// Optional: Add a simple health check tool
server.tool(
  "healthCheck",
  "Checks if the OutSystems API is accessible",
  {},
  async () => {
    try {
      const token = await getValidOutSystemsToken();
      return {
        content: [{ type: "text", text: "✅ OutSystems API is accessible" }]
      };
    } catch {
      return {
        content: [{ type: "text", text: "❌ OutSystems API is not accessible" }]
      };
    }
  }
);
```

### 5.2 Add Better User Feedback
```typescript
// Instead of generic "Fetching API token..."
yield "🔐 Authenticating with OutSystems...";
yield "🏗️ Creating your application...";
yield "⚙️ Generating application logic...";
yield "🚀 Deploying to OutSystems cloud...";
yield "✅ Verifying deployment...";
yield `🎉 Your app is ready! ${finalUrl}`;
```

### 5.3 Consider Adding Retry Logic
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === maxRetries - 1 || error.status !== 429) throw error;
      await delay(Math.pow(2, i) * 1000); // Exponential backoff
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## Priority Action Items

### 🔴 Critical (Do Before Deployment):
1. **Remove sensitive logging** (stdio-server.ts:18)
2. **Delete commented hardcoded path** (stdio-server.ts:10-14)
3. **Implement input validation** (max 500 chars)
4. **Add proper error sanitization**
5. **Check and remove error.log from git history**
6. **Add displayName to server info**

### 🟡 Important (Do Soon):
7. **Implement exponential backoff for polling**
8. **Use actual token expiry from API**
9. **Add timeout handling to all API calls**
10. **Add structured logging**
11. **Create type definitions for API responses**
12. **Remove all commented code**

### 🟢 Nice to Have (Future Improvements):
13. **Add rich UI widgets like OpenAI examples**
14. **Implement API client abstraction**
15. **Add health check tool**
16. **Add correlation IDs**
17. **Improve user feedback messages**
18. **Add retry logic for transient failures**

---

## Deployment Checklist

Before deploying to ChatGPT:

- [ ] All critical security issues fixed
- [ ] No sensitive data in logs
- [ ] No hardcoded paths
- [ ] Input validation implemented
- [ ] Environment variables documented
- [ ] Error messages sanitized
- [ ] Code tested with various prompts
- [ ] README.md updated with deployment instructions
- [ ] `.gitignore` reviewed and complete

---

## Conclusion

Your MCP server is **structurally sound** and follows most best practices. However, there are **critical security issues** that must be addressed before deployment:

**Security Grade:** 🟡 C+ (Requires fixes before production)
**Structure Grade:** ✅ B+ (Good adherence to MCP standards)
**Performance Grade:** 🟡 C (Needs optimization)
**Overall Readiness:** ⚠️ **NOT PRODUCTION READY** - Fix critical issues first

**Estimated Time to Fix Critical Issues:** 2-4 hours

Once the critical issues are resolved, your server will be ready for ChatGPT deployment. The code is well-organized and maintainable, which makes these improvements straightforward to implement.

