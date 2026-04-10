#!/usr/bin/env node

/**
 * Interactive installer for agent-inbox.
 * Detects AI coding agents, configures MCP server, installs skill.
 * Runs when `npx gsd-agent-inbox` is called from a TTY.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const PACKAGE = "gsd-agent-inbox";
const REPO = "gsd-build/agent-inbox";
const SKILL_URL = `https://raw.githubusercontent.com/${REPO}/main/skill/SKILL.md`;

// --- Colors ---
const cyan = "\x1b[36m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const dim = "\x1b[2m";
const bold = "\x1b[1m";
const reset = "\x1b[0m";

function banner() {
  console.log("");
  process.stdout.write(`${cyan}${bold}`);
  console.log("   █████╗  ██████╗ ███████╗███╗   ██╗████████╗");
  console.log("  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝");
  console.log("  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ");
  console.log("  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ");
  console.log("  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ");
  console.log("  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ");
  console.log("");
  console.log("  ██╗███╗   ██╗██████╗  ██████╗ ██╗  ██╗");
  console.log("  ██║████╗  ██║██╔══██╗██╔═══██╗╚██╗██╔╝");
  console.log("  ██║██╔██╗ ██║██████╔╝██║   ██║ ╚███╔╝ ");
  console.log("  ██║██║╚██╗██║██╔══██╗██║   ██║ ██╔██╗ ");
  console.log("  ██║██║ ╚████║██████╔╝╚██████╔╝██╔╝ ██╗");
  console.log("  ╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝");
  process.stdout.write(reset);
  console.log("");
  console.log(`  ${dim}Disposable email inboxes for AI agents${reset}`);
  console.log("");
}

const info = (msg: string) => console.log(`  ${cyan}>${reset} ${msg}`);
const ok = (msg: string) => console.log(`  ${green}✓${reset} ${msg}`);
const warn = (msg: string) => console.log(`  ${yellow}!${reset} ${msg}`);
const fail = (msg: string) => {
  console.log(`  ${red}✗${reset} ${msg}`);
  process.exit(1);
};

function ask(prompt: string, defaultValue: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ${prompt} [${defaultValue}]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

// --- MCP Config ---

interface McpConfig {
  mcpServers?: Record<string, { command: string; args: string[] }>;
  [key: string]: unknown;
}

function injectMcpConfig(configPath: string, displayName: string) {
  const entry = { command: "npx", args: ["-y", PACKAGE] };

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf8");
      const cfg: McpConfig = JSON.parse(raw);

      if (cfg.mcpServers?.["agent-inbox"]) {
        ok(`${displayName} already configured`);
        return;
      }

      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers["agent-inbox"] = entry;
      writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
      ok(`${displayName} configured`);
    } catch {
      warn(`Could not parse ${configPath} — add agent-inbox manually`);
    }
  } else {
    const dir = configPath.substring(0, configPath.lastIndexOf("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { "agent-inbox": entry } }, null, 2) + "\n"
    );
    ok(`${displayName} configured (created)`);
  }
}

interface Agent {
  id: string;
  label: string;
  configPath: string;
  skillDir: string;
}

function detectAgents(): Agent[] {
  const home = homedir();
  const agents: Agent[] = [];

  const candidates: Agent[] = [
    {
      id: "claude",
      label: "Claude Code",
      configPath: join(home, ".claude", "settings.json"),
      skillDir: join(home, ".claude", "skills", "agent-inbox"),
    },
    {
      id: "cursor",
      label: "Cursor",
      configPath: join(home, ".cursor", "mcp.json"),
      skillDir: join(home, ".cursor", "skills", "agent-inbox"),
    },
    {
      id: "windsurf",
      label: "Windsurf",
      configPath: join(home, ".codeium", "windsurf", "mcp_config.json"),
      skillDir: join(home, ".codeium", "windsurf", "skills", "agent-inbox"),
    },
  ];

  for (const agent of candidates) {
    const dir = agent.configPath.substring(
      0,
      agent.configPath.lastIndexOf("/")
    );
    if (existsSync(dir) || existsSync(agent.configPath)) {
      agents.push(agent);
    }
  }

  return agents;
}

async function installMcp(agents: Agent[]) {
  console.log("");
  console.log(`  ${cyan}${bold}MCP Server Configuration${reset}`);
  console.log(
    `  ${dim}Configure agent-inbox as an MCP server for your AI coding agents${reset}`
  );
  console.log("");

  if (agents.length === 0) {
    warn("No AI coding agents detected (Claude Code, Cursor, Windsurf)");
    info(`Add the MCP config manually — see: https://github.com/${REPO}#setup`);
    return;
  }

  console.log("  Detected:");
  agents.forEach((a, i) => {
    console.log(`    ${bold}${i + 1})${reset} ${a.label}`);
  });
  console.log(`    ${bold}a)${reset} All detected`);
  console.log(`    ${bold}s)${reset} Skip`);
  console.log("");

  const choice = await ask("Configure MCP for which agent(s)?", "a");

  if (choice === "s" || choice === "S") {
    info("Skipping MCP configuration");
    return;
  }

  let selected: Agent[];
  if (choice === "a" || choice === "A") {
    selected = agents;
  } else {
    selected = choice
      .split(",")
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => n >= 1 && n <= agents.length)
      .map((n) => agents[n - 1]!);
  }

  if (selected.length === 0) {
    warn("No valid selection — skipping");
    return;
  }

  console.log("");
  for (const agent of selected) {
    injectMcpConfig(agent.configPath, agent.label);
  }
}

async function installSkill(agents: Agent[]) {
  console.log("");
  console.log(`  ${cyan}${bold}AI Agent Skill Installation${reset}`);
  console.log(
    `  ${dim}Teach your AI agent when and how to use agent-inbox automatically${reset}`
  );
  console.log("");

  if (agents.length === 0) {
    info("No agents detected — skipping skill installation");
    return;
  }

  console.log("  Detected:");
  agents.forEach((a, i) => {
    console.log(`    ${bold}${i + 1})${reset} ${a.label}`);
  });
  console.log(`    ${bold}a)${reset} All detected`);
  console.log(`    ${bold}s)${reset} Skip`);
  console.log("");

  const choice = await ask("Install skill for which agent(s)?", "a");

  if (choice === "s" || choice === "S") {
    info("Skipping skill installation");
    return;
  }

  let selected: Agent[];
  if (choice === "a" || choice === "A") {
    selected = agents;
  } else {
    selected = choice
      .split(",")
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => n >= 1 && n <= agents.length)
      .map((n) => agents[n - 1]!);
  }

  if (selected.length === 0) {
    warn("No valid selection — skipping");
    return;
  }

  console.log("");

  for (const agent of selected) {
    info(`Installing skill for ${agent.label} → ${agent.skillDir}`);
    try {
      const res = await fetch(SKILL_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = await res.text();
      mkdirSync(agent.skillDir, { recursive: true });
      writeFileSync(join(agent.skillDir, "SKILL.md"), content);
      ok(`Skill installed: ${agent.skillDir}`);
    } catch {
      warn(`Failed to download skill — check network`);
    }
  }
}

async function main() {
  banner();

  const agents = detectAgents();
  ok(`Node.js ${process.version}`);

  await installMcp(agents);
  await installSkill(agents);

  console.log("");
  console.log(`  ${green}${bold}Installation complete!${reset}`);
  console.log("");
  console.log(`  ${dim}Your AI agent can now:${reset}`);
  console.log(
    `    1. Create a disposable inbox    ${dim}create_inbox({ prefix: "test" })${reset}`
  );
  console.log(
    `    2. Receive real emails           ${dim}check_inbox({ address, wait_seconds: 15 })${reset}`
  );
  console.log(
    `    3. Extract verification links    ${dim}auto-detected in response${reset}`
  );
  console.log(
    `    4. Clean up when done            ${dim}delete_inbox({ address })${reset}`
  );
  console.log("");
  console.log(`  ${dim}GitHub:${reset} https://github.com/${REPO}`);
  console.log(`  ${dim}npm:${reset}    https://npmjs.com/package/${PACKAGE}`);
  console.log("");
}

main();
