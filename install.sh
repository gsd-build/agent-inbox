#!/usr/bin/env bash
set -euo pipefail

# agent-inbox installer
# Usage: curl -fsSL https://raw.githubusercontent.com/gsd-build/agent-inbox/main/install.sh | bash

REPO="gsd-build/agent-inbox"
PACKAGE="gsd-agent-inbox"
SKILL_REPO_BASE="https://raw.githubusercontent.com/$REPO/main/skill"

# Colors
cyan="\033[36m"
green="\033[32m"
yellow="\033[33m"
red="\033[31m"
dim="\033[2m"
bold="\033[1m"
reset="\033[0m"

banner() {
  echo ""
  printf "${cyan}${bold}"
  echo "   █████╗  ██████╗ ███████╗███╗   ██╗████████╗"
  echo "  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝"
  echo "  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   "
  echo "  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   "
  echo "  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   "
  echo "  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   "
  echo ""
  echo "  ██╗███╗   ██╗██████╗  ██████╗ ██╗  ██╗"
  echo "  ██║████╗  ██║██╔══██╗██╔═══██╗╚██╗██╔╝"
  echo "  ██║██╔██╗ ██║██████╔╝██║   ██║ ╚███╔╝ "
  echo "  ██║██║╚██╗██║██╔══██╗██║   ██║ ██╔██╗ "
  echo "  ██║██║ ╚████║██████╔╝╚██████╔╝██╔╝ ██╗"
  echo "  ╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝"
  printf "${reset}\n"
  printf "  ${dim}Disposable email inboxes for AI agents${reset}\n\n"
}

info()  { printf "  ${cyan}>${reset} %s\n" "$1"; }
ok()    { printf "  ${green}✓${reset} %s\n" "$1"; }
warn()  { printf "  ${yellow}!${reset} %s\n" "$1"; }
fail()  { printf "  ${red}✗${reset} %s\n" "$1"; exit 1; }

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is required but not installed. Install it from https://nodejs.org"
  fi

  local node_version
  node_version=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$node_version" -lt 18 ]; then
    fail "Node.js 18+ required (found v$(node -v))"
  fi
  ok "Node.js $(node -v)"
}

check_npx() {
  if ! command -v npx >/dev/null 2>&1; then
    fail "npx is required but not found. It ships with npm — try reinstalling Node.js."
  fi
  ok "npx available"
}

verify_package() {
  info "Verifying $PACKAGE on npm..."
  if npx -y "$PACKAGE" --help >/dev/null 2>&1; then
    ok "Package verified: $PACKAGE"
  else
    # MCP servers don't have --help, they just start. Verify it exists on npm instead.
    if npm view "$PACKAGE" version >/dev/null 2>&1; then
      local ver
      ver=$(npm view "$PACKAGE" version 2>/dev/null)
      ok "Package verified: $PACKAGE@$ver"
    else
      fail "Package not found on npm: $PACKAGE"
    fi
  fi
}

# --- MCP Config Injection ---

inject_json_mcp() {
  local config_file="$1"
  local display_name="$2"

  # Check if already configured
  if [ -f "$config_file" ] && grep -q "agent-inbox" "$config_file" 2>/dev/null; then
    ok "$display_name already configured"
    return
  fi

  if [ -f "$config_file" ]; then
    # File exists — inject into mcpServers
    if grep -q '"mcpServers"' "$config_file" 2>/dev/null; then
      # mcpServers key exists — add our entry
      local tmp
      tmp=$(mktemp)
      node -e "
        const fs = require('fs');
        const cfg = JSON.parse(fs.readFileSync('$config_file', 'utf8'));
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers['agent-inbox'] = {
          command: 'npx',
          args: ['-y', '$PACKAGE']
        };
        fs.writeFileSync('$tmp', JSON.stringify(cfg, null, 2) + '\n');
      " 2>/dev/null && mv "$tmp" "$config_file" && {
        ok "$display_name configured"
        return
      }
      rm -f "$tmp"
    else
      # File exists but no mcpServers — add the key
      local tmp
      tmp=$(mktemp)
      node -e "
        const fs = require('fs');
        const cfg = JSON.parse(fs.readFileSync('$config_file', 'utf8'));
        cfg.mcpServers = {
          'agent-inbox': {
            command: 'npx',
            args: ['-y', '$PACKAGE']
          }
        };
        fs.writeFileSync('$tmp', JSON.stringify(cfg, null, 2) + '\n');
      " 2>/dev/null && mv "$tmp" "$config_file" && {
        ok "$display_name configured"
        return
      }
      rm -f "$tmp"
    fi
  else
    # File doesn't exist — create it
    mkdir -p "$(dirname "$config_file")"
    cat > "$config_file" << 'MCPJSON'
{
  "mcpServers": {
    "agent-inbox": {
      "command": "npx",
      "args": ["-y", "gsd-agent-inbox"]
    }
  }
}
MCPJSON
    ok "$display_name configured (created)"
    return
  fi

  warn "Could not auto-configure $display_name — add manually"
}

configure_claude() {
  local config_file="$HOME/.claude/settings.json"
  inject_json_mcp "$config_file" "Claude Code"
}

configure_cursor() {
  local config_file="$HOME/.cursor/mcp.json"
  inject_json_mcp "$config_file" "Cursor"
}

configure_windsurf() {
  local config_file="$HOME/.codeium/windsurf/mcp_config.json"
  inject_json_mcp "$config_file" "Windsurf"
}

install_mcp() {
  echo ""
  printf "  ${cyan}${bold}MCP Server Configuration${reset}\n"
  printf "  ${dim}Configure agent-inbox as an MCP server for your AI coding agents${reset}\n"
  echo ""

  # Detect available AI CLIs
  local available=()
  local labels=()
  local installers=()

  if [ -d "$HOME/.claude" ] || command -v claude >/dev/null 2>&1; then
    available+=("claude")
    labels+=("Claude Code")
    installers+=("configure_claude")
  fi
  if [ -d "$HOME/.cursor" ] || command -v cursor >/dev/null 2>&1; then
    available+=("cursor")
    labels+=("Cursor")
    installers+=("configure_cursor")
  fi
  if [ -d "$HOME/.codeium" ] || command -v windsurf >/dev/null 2>&1; then
    available+=("windsurf")
    labels+=("Windsurf")
    installers+=("configure_windsurf")
  fi

  if [ ${#available[@]} -eq 0 ]; then
    warn "No AI coding agents detected (Claude Code, Cursor, Windsurf)"
    info "Add the MCP config manually — see: https://github.com/$REPO#setup"
    return
  fi

  printf "  Detected:\n"
  local idx=1
  for label in "${labels[@]}"; do
    printf "    ${bold}%d)${reset} %s\n" "$idx" "$label"
    idx=$((idx + 1))
  done
  printf "    ${bold}a)${reset} All detected\n"
  printf "    ${bold}s)${reset} Skip\n"
  echo ""

  local choice
  read -rp "  Configure MCP for which agent(s)? [a]: " choice < /dev/tty || choice="a"
  choice="${choice:-a}"

  if [ "$choice" = "s" ] || [ "$choice" = "S" ]; then
    info "Skipping MCP configuration"
    return
  fi

  local selected=()
  if [ "$choice" = "a" ] || [ "$choice" = "A" ]; then
    selected=("${installers[@]}")
  else
    IFS=',' read -ra nums <<< "$choice"
    for num in "${nums[@]}"; do
      num=$(echo "$num" | tr -d ' ')
      if [[ "$num" =~ ^[0-9]+$ ]] && [ "$num" -ge 1 ] && [ "$num" -le ${#installers[@]} ]; then
        selected+=("${installers[$((num - 1))]}")
      fi
    done
  fi

  if [ ${#selected[@]} -eq 0 ]; then
    warn "No valid selection — skipping"
    return
  fi

  echo ""
  for installer in "${selected[@]}"; do
    $installer
  done
}

# --- Skill Installation ---

install_skill_to() {
  local dest="$1"
  mkdir -p "$dest"

  if ! curl -fsSL -o "$dest/SKILL.md" "$SKILL_REPO_BASE/SKILL.md" 2>/dev/null; then
    warn "Failed to download skill file"
    rm -rf "$dest"
    return 1
  fi

  ok "Skill installed: $dest"
  return 0
}

install_skill() {
  echo ""
  printf "  ${cyan}${bold}AI Agent Skill Installation${reset}\n"
  printf "  ${dim}Teach your AI agent when and how to use agent-inbox automatically${reset}\n"
  echo ""

  local available=()
  local labels=()

  if command -v claude >/dev/null 2>&1 || [ -d "$HOME/.claude" ]; then
    available+=("claude")
    labels+=("Claude Code")
  fi
  if command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ]; then
    available+=("codex")
    labels+=("OpenAI Codex CLI")
  fi
  if command -v gemini >/dev/null 2>&1 || [ -d "$HOME/.gemini" ]; then
    available+=("gemini")
    labels+=("Google Gemini CLI")
  fi

  if [ ${#available[@]} -eq 0 ]; then
    info "No AI coding agents detected — skip skill installation"
    info "Install a skill manually: cp skill/SKILL.md ~/.claude/skills/agent-inbox/SKILL.md"
    return
  fi

  printf "  Detected:\n"
  local idx=1
  for label in "${labels[@]}"; do
    printf "    ${bold}%d)${reset} %s\n" "$idx" "$label"
    idx=$((idx + 1))
  done
  printf "    ${bold}a)${reset} All detected\n"
  printf "    ${bold}s)${reset} Skip\n"
  echo ""

  local choice
  read -rp "  Install skill for which agent(s)? [a]: " choice < /dev/tty || choice="a"
  choice="${choice:-a}"

  if [ "$choice" = "s" ] || [ "$choice" = "S" ]; then
    info "Skipping skill installation"
    return
  fi

  local selected=()
  if [ "$choice" = "a" ] || [ "$choice" = "A" ]; then
    selected=("${available[@]}")
  else
    IFS=',' read -ra nums <<< "$choice"
    for num in "${nums[@]}"; do
      num=$(echo "$num" | tr -d ' ')
      if [[ "$num" =~ ^[0-9]+$ ]] && [ "$num" -ge 1 ] && [ "$num" -le ${#available[@]} ]; then
        selected+=("${available[$((num - 1))]}")
      fi
    done
  fi

  if [ ${#selected[@]} -eq 0 ]; then
    warn "No valid selection — skipping"
    return
  fi

  # Ask scope
  echo ""
  printf "  Install scope:\n"
  printf "    ${bold}g)${reset} Global (available in all projects)\n"
  printf "    ${bold}l)${reset} Local  (current directory only)\n"
  echo ""
  local scope
  read -rp "  Scope? [g]: " scope < /dev/tty || scope="g"
  scope="${scope:-g}"

  echo ""
  for tool in "${selected[@]}"; do
    local dest=""
    case "$tool" in
      claude)
        if [ "$scope" = "l" ] || [ "$scope" = "L" ]; then
          dest=".claude/skills/agent-inbox"
        else
          dest="$HOME/.claude/skills/agent-inbox"
        fi
        ;;
      codex)
        if [ "$scope" = "l" ] || [ "$scope" = "L" ]; then
          dest=".codex/skills/agent-inbox"
        else
          dest="$HOME/.codex/skills/agent-inbox"
        fi
        ;;
      gemini)
        if [ "$scope" = "l" ] || [ "$scope" = "L" ]; then
          dest=".gemini/skills/agent-inbox"
        else
          dest="$HOME/.gemini/skills/agent-inbox"
        fi
        ;;
    esac

    if [ -n "$dest" ]; then
      info "Installing skill for $tool → $dest"
      install_skill_to "$dest"
    fi
  done
}

main() {
  banner
  check_node
  check_npx
  verify_package
  install_mcp
  install_skill

  echo ""
  printf "  ${green}${bold}Installation complete!${reset}\n"
  echo ""
  printf "  ${dim}Your AI agent can now:${reset}\n"
  printf "    1. Create a disposable inbox    ${dim}create_inbox({ prefix: \"test\" })${reset}\n"
  printf "    2. Receive real emails           ${dim}check_inbox({ address, wait_seconds: 15 })${reset}\n"
  printf "    3. Extract verification links    ${dim}auto-detected in response${reset}\n"
  printf "    4. Clean up when done            ${dim}delete_inbox({ address })${reset}\n"
  echo ""
  printf "  ${dim}GitHub:${reset} https://github.com/$REPO\n"
  printf "  ${dim}npm:${reset}    https://npmjs.com/package/$PACKAGE\n"
  echo ""
}

main
