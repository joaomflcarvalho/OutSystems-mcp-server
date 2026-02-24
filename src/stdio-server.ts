// stdio-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAndDeployApp } from "./services/outsystems-api.js";
import { getValidOutSystemsToken } from "./services/token-manager.js";
import { z } from "zod";
import dotenv from "dotenv";
import { logger } from "./utils/logger.js";

// Load environment variables silently (MCP requires clean stdout)
// Suppress dotenv's stdout output by temporarily redirecting it
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (() => true) as any;
dotenv.config({ debug: false });
process.stdout.write = originalStdoutWrite;

// Input validation with proper constraints
export const inputSchemaShape = {
  prompt: z
    .string()
    .min(10, "Prompt must be at least 10 characters")
    .max(500, "Prompt must not exceed 500 characters")
    .describe("A prompt with a detailed description of the application to create. Must be between 10-500 characters."),
};

// Server initialization with displayName
const server = new McpServer({
  name: "outsystems-app-generator",
  version: "2.0.0",
  instructions: "Creates and deploys OutSystems applications from prompts.",
  displayName: "OutSystems App Generator"
});

export const inputSchema = z.object(inputSchemaShape);

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
  "Creates and deploys a complete OutSystems application from a text prompt. The prompt should describe the desired application in 10-500 characters.",
  inputSchemaShape,
  async ({ prompt }, extra: any) => {
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

// Initialize transport and connect
const transport = new StdioServerTransport();
server.connect(transport);

logger.info("OutSystems MCP Server initialized and ready");
