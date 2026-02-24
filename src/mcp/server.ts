/**
 * Core MCP Server Logic
 * This file maintains the stdio MCP server for local development
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAndDeployApp } from "../services/outsystems-api.js";
import { getValidOutSystemsToken } from "../services/token-manager.js";
import { z } from "zod";
import { logger } from "../utils/logger.js";
import { setRuntimeConfig, hasConfig, clearRuntimeConfig } from "../utils/runtime-config.js";

// Input validation schema
export const inputSchemaShape = {
  prompt: z
    .string()
    .min(10, "Prompt must be at least 10 characters")
    .max(500, "Prompt must not exceed 500 characters")
    .describe("A prompt with a detailed description of the application to create. Must be between 10-500 characters."),
};

export const inputSchema = z.object(inputSchemaShape);

/**
 * Initialize and configure the MCP server
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "outsystems-app-generator",
    version: "3.0.0",
    instructions: "Creates and deploys OutSystems applications from prompts.",
    displayName: "OutSystems App Generator"
  });

  // Configuration tool - allows setting credentials at runtime
  server.tool(
    "configureOutSystemsEnvironment",
    "Configure OutSystems environment credentials for the current session. Use this if environment variables are not set. The agent will guide you through finding each credential.",
    {
      hostname: z
        .string()
        .min(1)
        .describe("OutSystems Developer Cloud hostname (e.g., your-org.outsystems.dev). Find this in your OutSystems portal URL."),
      username: z
        .string()
        .email()
        .describe("Your OutSystems account email address. This is the email you use to log into OutSystems."),
      password: z
        .string()
        .min(1)
        .describe("Your OutSystems account password. This is the password you use to log into OutSystems."),
      devEnvId: z
        .string()
        .uuid()
        .describe("Development environment stage ID (UUID format). To find this: 1) Go to https://<your-hostname>/apps, 2) Click any application, 3) Look for 'stageid' parameter in the URL, 4) Copy the UUID value (e.g., f39f6d4d-439f-4776-b549-71e3ddd16522).")
    },
    async ({ hostname, username, password, devEnvId }) => {
      try {
        logger.info('Configuring OutSystems environment');
        
        // Set runtime configuration
        setRuntimeConfig({
          hostname,
          username,
          password,
          devEnvId
        });
        
        logger.info('Configuration set successfully');
        
        return {
          content: [{ 
            type: "text", 
            text: `✅ OutSystems environment configured successfully!\n\n` +
                  `📍 Hostname: ${hostname}\n` +
                  `👤 Username: ${username}\n` +
                  `🔧 Environment ID: ${devEnvId}\n\n` +
                  `You can now use the createOutSystemsApp tool to generate applications.`
          }]
        };
      } catch (error: any) {
        logger.error('Failed to configure environment', error);
        return {
          content: [{ 
            type: "text", 
            text: `❌ Failed to configure environment: ${error.message}` 
          }]
        };
      }
    }
  );

  // Clear configuration tool - allows clearing runtime credentials
  server.tool(
    "clearOutSystemsConfiguration",
    "Clear the runtime OutSystems configuration. This does not affect environment variables.",
    {},
    async () => {
      try {
        logger.info('Clearing OutSystems configuration');
        clearRuntimeConfig();
        logger.info('Configuration cleared successfully');
        
        return {
          content: [{ 
            type: "text", 
            text: "✅ OutSystems runtime configuration cleared. Environment variables (if set) will be used for the next operation."
          }]
        };
      } catch (error: any) {
        logger.error('Failed to clear configuration', error);
        return {
          content: [{ 
            type: "text", 
            text: `❌ Failed to clear configuration: ${error.message}` 
          }]
        };
      }
    }
  );

  // Health check tool
  server.tool(
    "healthCheck",
    "Checks if the OutSystems API is accessible and authentication is working",
    {},
    async () => {
      try {
        logger.info('Running health check');
        const token = await getValidOutSystemsToken();
        logger.info('Health check passed');
        return {
          content: [{ 
            type: "text", 
            text: "✅ OutSystems API is accessible and authentication is working properly." 
          }]
        };
      } catch (error: any) {
        logger.error('Health check failed', error);
        return {
          content: [{ 
            type: "text", 
            text: "❌ OutSystems API is not accessible. Please check your configuration and credentials." 
          }]
        };
      }
    }
  );

  // Main tool: Create and deploy OutSystems application
  server.tool(
    "createOutSystemsApp",
    "Creates and deploys a complete OutSystems application from a text prompt. The prompt should describe the desired application in 10-500 characters. Note: If environment variables are not configured, you must first call configureOutSystemsEnvironment to set up your credentials.",
    inputSchemaShape,
    async ({ prompt }, extra: any) => {
      // Check if configuration is available
      if (!hasConfig()) {
        logger.info('Attempted to create app without configuration');
        return {
          content: [{
            type: "text",
            text: "⚠️ OutSystems environment is not configured.\n\n" +
                  "Please use the `configureOutSystemsEnvironment` tool to set up your credentials first.\n\n" +
                  "You'll need to provide:\n" +
                  "1. **Hostname**: Your OutSystems Developer Cloud hostname (e.g., your-org.outsystems.dev)\n" +
                  "2. **Username**: Your OutSystems account email\n" +
                  "3. **Password**: Your OutSystems account password\n" +
                  "4. **Environment ID**: Your development environment stage ID (UUID)\n\n" +
                  "To find your Environment ID:\n" +
                  "   • Go to https://<your-hostname>/apps\n" +
                  "   • Click on any application\n" +
                  "   • Look for the 'stageid' parameter in the URL\n" +
                  "   • Copy the UUID value\n\n" +
                  "Alternatively, you can set these as environment variables in your MCP client configuration."
          }]
        };
      }

      let lastUrl: string | null = null;
      let lastText: string | null = null;
      
      logger.info('Creating OutSystems app', { 
        promptLength: prompt.length 
      });

      if (extra.progress) {
        // Stream progress updates to the user
        for await (const step of createAndDeployApp(prompt)) {
          lastText = step;
          
          // Extract URL if present in the step
          const urlMatch = step.match(/https:\/\/\S+/);
          if (urlMatch) {
            lastUrl = urlMatch[0];
          }
          
          extra.progress({ content: [{ type: "text", text: step }] });
        }
        
        // Return final result
        if (lastUrl && typeof lastUrl === "string" && lastUrl.startsWith("http")) {
          logger.info('App creation completed successfully', { url: lastUrl });
          return {
            content: [
              { type: "text", text: `🎉 Your OutSystems application is now live!\n\n📱 Access your app at:\n${lastUrl}` }
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: lastText || "App creation completed, but URL extraction failed.",
              },
            ],
          };
        }
      } else {
        // Fallback if extra.progress is not present
        let finalMsg = "";
        for await (const step of createAndDeployApp(prompt)) {
          finalMsg = step;
          const urlMatch = step.match(/https:\/\/\S+/);
          if (urlMatch) {
            lastUrl = urlMatch[0];
          }
        }
        
        if (lastUrl && typeof lastUrl === "string" && lastUrl.startsWith("http")) {
          logger.info('App creation completed successfully', { url: lastUrl });
          return {
            content: [
              { type: "text", text: `🎉 Your OutSystems application is now live!\n\n📱 Access your app at:\n${lastUrl}` }
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: finalMsg || "App creation completed, but URL extraction failed.",
              },
            ],
          };
        }
      }
    }
  );

  return server;
}

/**
 * Start the stdio MCP server (for local development)
 */
export function startStdioServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport);
  logger.info("OutSystems MCP Server initialized and ready (stdio mode)");
}

