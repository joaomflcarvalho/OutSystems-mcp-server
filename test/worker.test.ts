/**
 * Tests for Cloudflare Worker endpoints
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Env } from '../src/worker/types';

// Mock environment for tests
const mockEnv: Env = {
  OS_HOSTNAME: 'test.outsystems.dev',
  OS_USERNAME: 'test@example.com',
  OS_PASSWORD: 'test-password',
  OS_DEV_ENVID: '00000000-0000-0000-0000-000000000000',
  MCP_SERVER_SECRET: 'test-secret-token',
  LOG_LEVEL: 'silent'
};

describe('Worker Routes', () => {
  describe('GET /health', () => {
    it('should return 200 OK', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/health', {
        method: 'GET'
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('version');
      expect(data.version).toBe('3.0.0');
    });
  });

  describe('GET /metrics', () => {
    it('should return metrics', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/metrics', {
        method: 'GET'
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('requestCount');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('version');
    });
  });

  describe('POST /mcp/invoke - Authentication', () => {
    it('should reject request without auth header', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/mcp/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tool: 'healthCheck',
          params: {}
        })
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.status).toBe(401);
    });

    it('should reject request with invalid auth token', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/mcp/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer wrong-token'
        },
        body: JSON.stringify({
          tool: 'healthCheck',
          params: {}
        })
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.status).toBe(401);
    });

    it('should accept request with valid auth token', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/mcp/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-secret-token'
        },
        body: JSON.stringify({
          tool: 'healthCheck',
          params: {}
        })
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.status).not.toBe(401);
    });
  });

  describe('POST /mcp/invoke - Validation', () => {
    it('should reject request without tool parameter', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/mcp/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-secret-token'
        },
        body: JSON.stringify({
          params: {}
        })
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.error).toBe('Bad Request');
    });

    it('should reject createOutSystemsApp with invalid prompt length', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/mcp/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-secret-token'
        },
        body: JSON.stringify({
          tool: 'createOutSystemsApp',
          params: {
            prompt: 'short' // Less than 10 characters
          }
        })
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.message).toContain('10 and 500 characters');
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight request', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/mcp/invoke', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://chat.openai.com'
        }
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://chat.openai.com');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should add CORS headers to responses', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/health', {
        method: 'GET',
        headers: {
          'Origin': 'https://chat.openai.com'
        }
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://chat.openai.com');
    });
  });

  describe('Unknown routes', () => {
    it('should return 404 for unknown routes', async () => {
      const { handleRequest } = await import('../src/worker/router');
      
      const request = new Request('https://test.workers.dev/unknown', {
        method: 'GET'
      });
      
      const response = await handleRequest(request, mockEnv);
      expect(response.status).toBe(404);
      
      const data = await response.json();
      expect(data.error).toBe('Not Found');
    });
  });
});

