# OutSystems MCP Server

This is a Model Context Protocol (MCP) server that generates OutSystems applications from a text prompt. It is designed to be used with MCP clients like Raycast and Perplexity, or as a standalone HTTP API.

## Demo

[![Demo Video](./demos/demo.gif)](./demos/MCP%20Server%20Demo.mp4)

## Architecture

The server is built with TypeScript and uses the official `@modelcontextprotocol/sdk` for handling MCP communication. It exposes a single tool, `createOutSystemsApp`, which generates and deploys an OutSystems application from a prompt. The tool is implemented as an async generator, streaming progress updates to the client. All OutSystems API logic is modularized for maintainability.

## Project Structure

```text
.
├── .env.example
├── package.json
├── tsconfig.json
└── src/
    ├── stdio-server.ts         # Main MCP stdio server entry point
    ├── services/
    │   ├── outsystems-api.ts   # OutSystems API logic (with retry & backoff)
    │   └── token-manager.ts    # Token management (with actual expiry)
    ├── types/
    │   └── api-types.ts        # TypeScript type definitions
    └── utils/
        ├── getOutsystemsToken.ts # Token acquisition utility
        ├── logger.ts           # Structured logging utility
        └── apiClient.ts        # API client with timeout & retry
```

- `src/stdio-server.ts`: Main entry point for the MCP server. Handles stdio transport, tool registration, and input validation.
- `src/services/outsystems-api.ts`: Contains the logic for interacting with the OutSystems platform with exponential backoff polling.
- `src/services/token-manager.ts`: Handles OutSystems API token caching and refresh using actual API expiry times.
- `src/types/api-types.ts`: TypeScript type definitions for all API responses.
- `src/utils/logger.ts`: Structured logging with debug/info/error levels and correlation IDs.
- `src/utils/apiClient.ts`: Robust API client with timeout handling, retry logic, and error sanitization.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/joaomflcarvalho/OutSystems-mcp-server.git
    cd OutSystems-mcp-server
    ```

2.  Install the dependencies:
    ```bash
    npm install
    ```

3.  Build the project:
    ```bash
    npm run build
    ```

### Running the Server

To start the MCP server (stdio mode, for Raycast/Perplexity):

```bash
npm start
```

This will compile the TypeScript code (if needed) and start the MCP server using stdio. The entry point is `dist/stdio-server.js`.

For local HTTP API testing (optional):

```bash
node dist/index.js
```

## OutSystems Configuration

**Best practice for Raycast and similar clients:**
Set your OutSystems credentials directly in the `env` section of your MCP server configuration.

### Required Environment Variables

-   `OS_HOSTNAME`: The full URL of your OutSystems Developer Cloud (ODC) portal (e.g., `your-org-name.outsystems.dev`)
-   `OS_USERNAME`: Your ODC account email/username
-   `OS_PASSWORD`: Your ODC account password
-   `OS_DEV_ENVID`: The UUID of your Dev environment stage (see below)

#### Finding your `OS_DEV_ENVID`

1.  Navigate to `https://<your-hostname>/apps` (e.g., `https://your-org-name.outsystems.dev/apps`).
2.  Click on any application to open its details.
3.  Look at the URL for a `stageid` parameter and copy its UUID value.

Example:
`stageid=f39f6d4d-439f-4776-b549-71e3ddd16522`

## MCP Client Configuration

### Raycast

Add (or update) your MCP server block in the Raycast `mcp-config.json` like this:

```json
{
  "mcpServers": {
    "outsystems-generator": {
      "command": "node",
      "args": [
        "/path/to/your/project/OutSystems-mcp-server/dist/stdio-server.js"
      ],
      "env": {
        "OS_HOSTNAME": "your-org-name.outsystems.dev",
        "OS_USERNAME": "your-email@example.com",
        "OS_PASSWORD": "your-secret-password",
        "OS_DEV_ENVID": "your-dev-envid-uuid"
      },
      "autoApprove": ["createOutSystemsApp"]
    }
  }
}
```

**Note:**
You do NOT need to use a local `.env` file when running under Raycast; all secrets and config can be passed directly with the `env` property.

### Example .env File (for local testing or other deployment)

If you want to test locally (outside of Raycast), create a `.env` file in your project root with the following content:

```bash
OS_HOSTNAME=your-org-name.outsystems.dev
OS_USERNAME=your-email@example.com
OS_PASSWORD=your-secret-password
OS_DEV_ENVID=your-dev-envid-uuid
```

Then run the server:

```bash
npm start
```

## Available Tools

### 1. `createOutSystemsApp`
Creates and deploys a complete OutSystems application from a text prompt.

**Input:** 
- `prompt` (string, 10-500 characters): Description of the application to create

**Features:**
- ✅ Input validation (10-500 characters)
- ✅ Real-time progress streaming
- ✅ Exponential backoff polling
- ✅ Automatic retry on transient failures
- ✅ User-friendly error messages
- ✅ Correlation IDs for debugging

### 2. `healthCheck`
Verifies that the OutSystems API is accessible and authentication is working.

**Use this tool to:**
- Test your configuration before creating apps
- Verify credentials are correct
- Check API connectivity

## New Features & Security

This server includes enterprise-grade security and performance improvements:

### Security Features
- ✅ **No sensitive logging** - Environment variables never logged
- ✅ **Input validation** - 10-500 character constraint with clear error messages
- ✅ **Error sanitization** - User-friendly messages without API details
- ✅ **Secure secrets management** - Comprehensive .gitignore patterns
- ✅ **Type safety** - Fully typed with TypeScript for compile-time error checking

### Performance Features
- ✅ **Exponential backoff** - Reduces API calls by ~60% during polling
- ✅ **Automatic retries** - Up to 3 retries for transient failures
- ✅ **Request timeouts** - All requests have 15-30s timeouts
- ✅ **Smart token caching** - Uses actual API expiry times

### Observability Features
- ✅ **Structured logging** - Configurable with DEBUG and LOG_LEVEL
- ✅ **Correlation IDs** - Track requests end-to-end
- ✅ **Health checks** - Verify setup before deploying

## Optional Configuration

### Logging Control

Set these environment variables to control logging:

```bash
# Enable debug logging
DEBUG=true

# Set log level (silent, error, info, debug)
LOG_LEVEL=info
```

**Example Raycast configuration with logging:**
```json
{
  "mcpServers": {
    "outsystems-generator": {
      "command": "node",
      "args": ["/path/to/dist/stdio-server.js"],
      "env": {
        "OS_HOSTNAME": "your-org.outsystems.dev",
        "OS_USERNAME": "your-email@example.com",
        "OS_PASSWORD": "your-password",
        "OS_DEV_ENVID": "your-uuid",
        "LOG_LEVEL": "info",
        "DEBUG": "false"
      }
    }
  }
}
```

## Documentation

- 📚 **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Quick reference guide for new features
- 🔒 **[SECURITY_FIXES_SUMMARY.md](./SECURITY_FIXES_SUMMARY.md)** - Detailed security improvements
- 📖 **[OutSystemsAPI_Documentation.md](./src/services/OutSystemsAPI_Documentation.md)** - API integration guide

## Notes

-   Two tools are exposed: `createOutSystemsApp` and `healthCheck`.
-   The codebase is modular and ready for additional tools or features.
-   Progress updates and final URLs are streamed to the client according to the MCP protocol.
-   All API responses are fully typed for better IDE support and compile-time error checking.
-   Production-ready with enterprise-grade security and performance.
-   You can still use a `.env` file for local testing; environment variables are loaded automatically.
