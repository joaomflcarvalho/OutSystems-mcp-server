/**
 * Cloudflare Workers Environment Bindings
 */
export interface Env {
  // OutSystems Configuration
  OS_HOSTNAME: string;
  OS_USERNAME: string;
  OS_PASSWORD: string;
  OS_DEV_ENVID: string;
  
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

