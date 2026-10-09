/**
 * Config loading with zero dependencies.
 *
 * Reads .env if present, then the environment. The key never appears in argv, so it cannot leak
 * into shell history or a process listing.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const quickstartRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const loadDotEnv = (): void => {
  const envPath = path.join(quickstartRoot, ".env");
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return parsed;
};

export interface Config {
  apiKey: string;
  baseUrl: string;
  /** Pin a Space. Unset = the account's API Claws Developer Space. */
  spaceId?: string;
  /** Where the account owner enables API Claws and tops up credits. */
  developerCenterUrl: string;
  agentName: string;
  /** How long to poll a turn before stopping. The run itself keeps going server-side. */
  pollTimeoutMs: number;
}

export const loadConfig = (): Config => {
  loadDotEnv();

  const apiKey = process.env.BUDA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "BUDA_API_KEY is not set.\n" +
        "  1. Create a key in the Buda dashboard: Settings -> API Keys (it is shown once)\n" +
        "  2. cp .env.example .env\n" +
        "  3. Put the sk_ key in .env",
    );
  }

  const baseUrl = process.env.BUDA_API_BASE_URL ?? "https://buda.im/api/v1";
  return {
    apiKey,
    baseUrl,
    spaceId: process.env.QUICKSTART_SPACE_ID?.trim() || undefined,
    developerCenterUrl: `${new URL(baseUrl).origin}/developer`,
    agentName: process.env.QUICKSTART_AGENT_NAME ?? "Watch Assistant",
    pollTimeoutMs: parsePositiveInt(process.env.QUICKSTART_POLL_TIMEOUT_MS, 180_000),
  };
};
