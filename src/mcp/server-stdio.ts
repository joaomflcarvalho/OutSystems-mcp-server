/**
 * Stdio MCP Server Entry Point
 * For local development and MCP clients like Raycast
 */

import dotenv from "dotenv";
import { startStdioServer } from "./server.js";

// Load environment variables silently (MCP requires clean stdout)
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (() => true) as any;
dotenv.config({ debug: false });
process.stdout.write = originalStdoutWrite;

// Start the stdio server
startStdioServer();

