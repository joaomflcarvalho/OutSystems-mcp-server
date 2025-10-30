/**
 * Runtime Configuration Manager
 * Manages OutSystems credentials that can be set at runtime via MCP tools
 */

export interface OutSystemsConfig {
  hostname: string;
  username: string;
  password: string;
  devEnvId: string;
}

// In-memory runtime configuration
let runtimeConfig: OutSystemsConfig | null = null;

/**
 * Set the runtime configuration for OutSystems
 */
export function setRuntimeConfig(config: OutSystemsConfig): void {
  runtimeConfig = config;
}

/**
 * Get the current runtime configuration
 */
export function getRuntimeConfig(): OutSystemsConfig | null {
  return runtimeConfig;
}

/**
 * Clear the runtime configuration
 */
export function clearRuntimeConfig(): void {
  runtimeConfig = null;
}

/**
 * Check if runtime configuration is set
 */
export function hasRuntimeConfig(): boolean {
  return runtimeConfig !== null;
}

/**
 * Get configuration from runtime or environment variables
 * Returns null if neither is available
 */
export function getConfig(): OutSystemsConfig | null {
  // First priority: runtime configuration
  if (runtimeConfig) {
    return runtimeConfig;
  }

  // Second priority: environment variables
  const { OS_HOSTNAME, OS_USERNAME, OS_PASSWORD, OS_DEV_ENVID } = process.env;
  
  if (OS_HOSTNAME && OS_USERNAME && OS_PASSWORD && OS_DEV_ENVID) {
    return {
      hostname: OS_HOSTNAME,
      username: OS_USERNAME,
      password: OS_PASSWORD,
      devEnvId: OS_DEV_ENVID,
    };
  }

  return null;
}

/**
 * Check if any configuration (runtime or env) is available
 */
export function hasConfig(): boolean {
  return getConfig() !== null;
}



