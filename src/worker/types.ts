/**
 * Cloudflare Workers Environment Bindings
 */
export interface Env {
  // OutSystems Configuration
  OS_HOSTNAME: string;
  OS_USERNAME: string;
  OS_PASSWORD: string;
  OS_DEV_ENVID: string;
  
  // Cognito refresh token (bootstrapped once via scripts/bootstrap-token.ts)
  COGNITO_REFRESH_TOKEN: string;

  // Keep-alive target (separate from OS_* so the MCP keeps using the demo env)
  KEEPALIVE_HOSTNAME?: string;
  KEEPALIVE_USERNAME?: string;
  KEEPALIVE_PASSWORD?: string;
  KEEPALIVE_KV?: KVNamespace; // saved browser session cookies
  KEEPALIVE_ALERT_WEBHOOK?: string; // optional Slack-style webhook for failure alerts
  BROWSER?: import('@cloudflare/puppeteer').BrowserWorker; // Browser Rendering binding

  // MCP Server Security
  MCP_SERVER_SECRET: string;
  
  // Optional
  LOG_LEVEL?: string;
  DEBUG?: string;
}

/**
 * MCP Tool Invocation Request
 */
export interface McpInvokeRequest {
  tool: string;
  params: Record<string, any>;
}

/**
 * Progress Update Event
 */
export interface ProgressEvent {
  type: 'progress' | 'result' | 'error';
  data: {
    message?: string;
    step?: number;
    total?: number;
    url?: string;
    applicationKey?: string;
    status?: string;
    error?: string;
  };
}

/**
 * Health Check Response
 */
export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
  uptime?: number;
}

/**
 * Metrics Response
 */
export interface MetricsResponse {
  requestCount: number;
  uptime: number;
  version: string;
  lastRequest?: string;
}

