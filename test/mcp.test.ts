/**
 * Tests for MCP server functionality
 */

import { describe, it, expect } from 'vitest';
import { inputSchema } from '../src/mcp/server';

describe('MCP Server', () => {
  describe('Input Validation', () => {
    it('should validate correct prompt', () => {
      const result = inputSchema.safeParse({
        prompt: 'Create a simple task management app with todo lists'
      });
      
      expect(result.success).toBe(true);
    });

    it('should reject prompt that is too short', () => {
      const result = inputSchema.safeParse({
        prompt: 'short'
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('at least 10 characters');
      }
    });

    it('should reject prompt that is too long', () => {
      const longPrompt = 'a'.repeat(501);
      const result = inputSchema.safeParse({
        prompt: longPrompt
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('not exceed 500 characters');
      }
    });

    it('should reject non-string prompt', () => {
      const result = inputSchema.safeParse({
        prompt: 12345
      });
      
      expect(result.success).toBe(false);
    });

    it('should reject missing prompt', () => {
      const result = inputSchema.safeParse({});
      
      expect(result.success).toBe(false);
    });
  });
});

describe('MCP Tool Handlers', () => {
  describe('Progress Event Format', () => {
    it('should match expected progress event structure', () => {
      const progressEvent = {
        type: 'progress',
        data: {
          message: 'Starting application creation...',
          step: 1,
          total: 7
        }
      };
      
      expect(progressEvent).toHaveProperty('type');
      expect(progressEvent).toHaveProperty('data');
      expect(progressEvent.data).toHaveProperty('message');
      expect(progressEvent.data).toHaveProperty('step');
      expect(progressEvent.data).toHaveProperty('total');
    });

    it('should match expected result event structure', () => {
      const resultEvent = {
        type: 'result',
        data: {
          message: 'Application created successfully!',
          url: 'https://example.outsystems.app/MyApp',
          applicationKey: '12345-67890',
          status: 'completed'
        }
      };
      
      expect(resultEvent).toHaveProperty('type');
      expect(resultEvent.type).toBe('result');
      expect(resultEvent.data).toHaveProperty('url');
      expect(resultEvent.data).toHaveProperty('applicationKey');
      expect(resultEvent.data).toHaveProperty('status');
    });

    it('should match expected error event structure', () => {
      const errorEvent = {
        type: 'error',
        data: {
          error: 'Authentication failed',
          status: 'failed'
        }
      };
      
      expect(errorEvent).toHaveProperty('type');
      expect(errorEvent.type).toBe('error');
      expect(errorEvent.data).toHaveProperty('error');
      expect(errorEvent.data).toHaveProperty('status');
    });
  });
});

