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

export interface Config {
  apiKey: string;
  baseUrl: string;
  spaceName: string;
  agentName: string;
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

  return {
    apiKey,
    baseUrl: process.env.BUDA_API_BASE_URL ?? "https://buda.im/api/v1",
    spaceName: process.env.QUICKSTART_SPACE_NAME ?? "API Claws Quickstart",
    agentName: process.env.QUICKSTART_AGENT_NAME ?? "Watch Assistant",
  };
};
