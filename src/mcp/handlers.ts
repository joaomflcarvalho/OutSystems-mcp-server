/**
 * MCP Tool Handlers
 * Implements the core business logic for MCP tools
 */

// Use worker-compatible versions for Cloudflare Workers
import { createAndDeployApp } from '../services/outsystems-api.worker.js';
import { getValidOutSystemsToken as getValidOutSystemsTokenWorker } from '../services/token-manager.worker.js';
import { Env, ProgressEvent } from '../worker/types.js';

/**
 * Creates a streaming response for createOutSystemsApp tool
 */
export function createOutSystemsAppStream(prompt: string, env: Env): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  
  // Start the async processing
  (async () => {
    try {
      // Send initial progress event
      const startEvent: ProgressEvent = {
        type: 'progress',
        data: {
          message: 'Starting application creation...',
          step: 0,
          total: 7
        }
      };
      await writer.write(encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`));
      
      let stepNumber = 1;
      let finalUrl: string | undefined;
      let applicationKey: string | undefined;
      
      // Stream progress updates from the generator
      for await (const message of createAndDeployApp(prompt, env)) {
        // Extract URL and application key if present
        const urlMatch = message.match(/https:\/\/\S+/);
        if (urlMatch) {
          finalUrl = urlMatch[0];
        }
        
        const keyMatch = message.match(/Key: ([a-f0-9-]+)/);
        if (keyMatch) {
          applicationKey = keyMatch[1];
        }
        
        const progressEvent: ProgressEvent = {
          type: 'progress',
          data: {
            message,
            step: stepNumber,
            total: 7
          }
        };
        
        await writer.write(encoder.encode(`data: ${JSON.stringify(progressEvent)}\n\n`));
        
        if (message.includes('Step')) {
          stepNumber++;
        }
      }
      
      // Send final result event
      const resultEvent: ProgressEvent = {
        type: 'result',
        data: {
          message: 'Application created successfully!',
          url: finalUrl,
          applicationKey,
          status: 'completed'
        }
      };
      await writer.write(encoder.encode(`data: ${JSON.stringify(resultEvent)}\n\n`));
      
    } catch (error: any) {
      // Send error event
      const errorEvent: ProgressEvent = {
        type: 'error',
        data: {
          error: error.message || 'An unexpected error occurred',
          status: 'failed'
        }
      };
      await writer.write(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
    } finally {
      await writer.close();
    }
  })();
  
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

/**
 * Health check handler
 */
export async function healthCheckHandler(env: Env): Promise<{ success: boolean; message: string }> {
  try {
    // Attempt to get a valid token to verify connectivity
    await getValidOutSystemsTokenWorker(env);
    return {
      success: true,
      message: 'OutSystems API is accessible and authentication is working properly.'
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'OutSystems API is not accessible. Please check your configuration and credentials.'
    };
  }
}

