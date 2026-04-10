#!/usr/bin/env node

/**
 * Interactive installer for agent-inbox.
 * Detects AI coding agents, configures MCP server, installs skill.
 *
 * CJS + callback-based to work reliably under npx where stdin
 * may have been consumed by the "Ok to proceed?" prompt.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const https = require('https');

const PACKAGE = 'gsd-agent-inbox';
const REPO = 'gsd-build/agent-inbox';
const SKILL_URL = `https://raw.githubusercontent.com/${REPO}/main/skill/SKILL.md`;

// Colors
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

function banner() {
  console.log('');
  process.stdout.write(`${cyan}${bold}`);
  console.log('   █████╗  ██████╗ ███████╗███╗   ██╗████████╗');
  console.log('  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝');
  console.log('  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ');
  console.log('  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ');
  console.log('  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ');
  console.log('  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ');
  console.log('');
  console.log('  ██╗███╗   ██╗██████╗  ██████╗ ██╗  ██╗');
  console.log('  ██║████╗  ██║██╔══██╗██╔═══██╗╚██╗██╔╝');
  console.log('  ██║██╔██╗ ██║██████╔╝██║   ██║ ╚███╔╝ ');
  console.log('  ██║██║╚██╗██║██╔══██╗██║   ██║ ██╔██╗ ');
  console.log('  ██║██║ ╚████║██████╔╝╚██████╔╝██╔╝ ██╗');
  console.log('  ╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝');
  process.stdout.write(reset);
  console.log('');
  console.log(`  ${dim}Disposable email inboxes for AI agents${reset}`);
  console.log('');
}

const info = (msg) => console.log(`  ${cyan}>${reset} ${msg}`);
const ok = (msg) => console.log(`  ${green}✓${reset} ${msg}`);
const warn = (msg) => console.log(`  ${yellow}!${reset} ${msg}`);

function prompt(question, defaultValue, callback) {
  if (!process.stdin.isTTY) {
    callback(defaultValue);
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let answered = false;

  rl.on('close', () => {
    if (!answered) {
      answered = true;
      callback(defaultValue);
    }
  });

  rl.question(`  ${question} [${defaultValue}]: `, (answer) => {
    answered = true;
    rl.close();
    callback(answer.trim() || defaultValue);
  });
}

// --- Agent detection ---

function detectAgents() {
  const home = os.homedir();
  const agents = [];

  const candidates = [
    {
      id: 'claude',
      label: 'Claude Code',
      configPath: path.join(home, '.claude', 'settings.json'),
      skillDir: path.join(home, '.claude', 'skills', 'agent-inbox'),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: path.join(home, '.cursor', 'mcp.json'),
      skillDir: path.join(home, '.cursor', 'skills', 'agent-inbox'),
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      configPath: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      skillDir: path.join(home, '.codeium', 'windsurf', 'skills', 'agent-inbox'),
    },
  ];

  for (const agent of candidates) {
    const dir = path.dirname(agent.configPath);
    if (fs.existsSync(dir) || fs.existsSync(agent.configPath)) {
      agents.push(agent);
    }
  }

  return agents;
}

// --- MCP config injection ---

function injectMcpConfig(configPath, displayName) {
  const entry = { command: 'npx', args: ['-y', PACKAGE] };

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const cfg = JSON.parse(raw);

      if (cfg.mcpServers && cfg.mcpServers['agent-inbox']) {
        ok(`${displayName} already configured`);
        return;
      }

      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers['agent-inbox'] = entry;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
      ok(`${displayName} configured`);
    } catch {
      warn(`Could not parse ${configPath} — add agent-inbox manually`);
    }
  } else {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { 'agent-inbox': entry } }, null, 2) + '\n'
    );
    ok(`${displayName} configured (created)`);
  }
}

// --- Skill download ---

function downloadSkill(destDir, callback) {
  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, 'SKILL.md');

  https.get(SKILL_URL, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      https.get(res.headers.location, (res2) => {
        collectBody(res2, destFile, callback);
      }).on('error', () => {
        warn('Failed to download skill — check network');
        callback();
      });
      return;
    }
    collectBody(res, destFile, callback);
  }).on('error', () => {
    warn('Failed to download skill — check network');
    callback();
  });
}

function collectBody(res, destFile, callback) {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    fs.writeFileSync(destFile, data);
    ok(`Skill installed: ${path.dirname(destFile)}`);
    callback();
  });
}

// --- Selection helper ---

function parseSelection(input, maxIndex) {
  if (input === 'a' || input === 'A') return 'all';
  if (input === 's' || input === 'S') return 'skip';

  return input
    .split(/[\s,]+/)
    .map((n) => parseInt(n.trim(), 10))
    .filter((n) => n >= 1 && n <= maxIndex)
    .map((n) => n - 1); // Convert to zero-indexed
}

// --- Install flow ---

function installMcp(agents, callback) {
  console.log('');
  console.log(`  ${cyan}${bold}MCP Server Configuration${reset}`);
  console.log(`  ${dim}Configure agent-inbox as an MCP server for your AI coding agents${reset}`);
  console.log('');

  if (agents.length === 0) {
    warn('No AI coding agents detected (Claude Code, Cursor, Windsurf)');
    info(`Add the MCP config manually — see: https://github.com/${REPO}#manual-setup`);
    callback();
    return;
  }

  console.log('  Detected:');
  agents.forEach((a, i) => {
    console.log(`    ${bold}${i + 1})${reset} ${a.label}`);
  });
  console.log(`    ${bold}a)${reset} All detected`);
  console.log(`    ${bold}s)${reset} Skip`);
  console.log('');

  prompt('Configure MCP for which agent(s)?', 'a', (choice) => {
    const sel = parseSelection(choice, agents.length);

    if (sel === 'skip') {
      info('Skipping MCP configuration');
      callback();
      return;
    }

    const selected = sel === 'all' ? agents : sel.map((i) => agents[i]);

    if (selected.length === 0) {
      warn('No valid selection — skipping');
      callback();
      return;
    }

    console.log('');
    for (const agent of selected) {
      injectMcpConfig(agent.configPath, agent.label);
    }
    callback();
  });
}

function installSkill(agents, callback) {
  console.log('');
  console.log(`  ${cyan}${bold}AI Agent Skill Installation${reset}`);
  console.log(`  ${dim}Teach your AI agent when and how to use agent-inbox automatically${reset}`);
  console.log('');

  if (agents.length === 0) {
    info('No agents detected — skipping skill installation');
    callback();
    return;
  }

  console.log('  Detected:');
  agents.forEach((a, i) => {
    console.log(`    ${bold}${i + 1})${reset} ${a.label}`);
  });
  console.log(`    ${bold}a)${reset} All detected`);
  console.log(`    ${bold}s)${reset} Skip`);
  console.log('');

  prompt('Install skill for which agent(s)?', 'a', (choice) => {
    const sel = parseSelection(choice, agents.length);

    if (sel === 'skip') {
      info('Skipping skill installation');
      callback();
      return;
    }

    const selected = sel === 'all' ? agents : sel.map((i) => agents[i]);

    if (selected.length === 0) {
      warn('No valid selection — skipping');
      callback();
      return;
    }

    console.log('');

    let remaining = selected.length;
    for (const agent of selected) {
      info(`Installing skill for ${agent.label} → ${agent.skillDir}`);
      downloadSkill(agent.skillDir, () => {
        remaining--;
        if (remaining === 0) callback();
      });
    }
  });
}

function finish() {
  console.log('');
  console.log(`  ${green}${bold}Installation complete!${reset}`);
  console.log('');
  console.log(`  ${dim}Your AI agent can now:${reset}`);
  console.log(`    1. Create a disposable inbox    ${dim}create_inbox({ prefix: "test" })${reset}`);
  console.log(`    2. Receive real emails           ${dim}check_inbox({ address, wait_seconds: 15 })${reset}`);
  console.log(`    3. Extract verification links    ${dim}auto-detected in response${reset}`);
  console.log(`    4. Clean up when done            ${dim}delete_inbox({ address })${reset}`);
  console.log('');
  console.log(`  ${dim}GitHub:${reset} https://github.com/${REPO}`);
  console.log(`  ${dim}npm:${reset}    https://npmjs.com/package/${PACKAGE}`);
  console.log('');
}

function main() {
  banner();

  const agents = detectAgents();
  ok(`Node.js ${process.version}`);

  installMcp(agents, () => {
    installSkill(agents, () => {
      finish();
    });
  });
}

main();
