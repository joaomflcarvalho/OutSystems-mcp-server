/**
 * Runtime Configuration Manager (Worker Version)
 * For Cloudflare Workers - uses Env bindings
 */

import { Env } from '../worker/types.js';

export interface OutSystemsConfig {
  hostname: string;
  username: string;
  password: string;
  devEnvId: string;
}

/**
 * Get configuration from Env bindings
 * In Workers mode, we always use the Env bindings
 */
export function getConfigFromEnv(env: Env): OutSystemsConfig | null {
  if (env.OS_HOSTNAME && env.OS_USERNAME && env.OS_PASSWORD && env.OS_DEV_ENVID) {
    return {
      hostname: env.OS_HOSTNAME,
      username: env.OS_USERNAME,
      password: env.OS_PASSWORD,
      devEnvId: env.OS_DEV_ENVID,
    };
  }
  return null;
}

/**
 * Check if configuration is available in Env
 */
export function hasConfigInEnv(env: Env): boolean {
  return getConfigFromEnv(env) !== null;
}



