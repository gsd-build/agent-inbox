# agent-inbox

Give any AI agent a disposable email inbox in one tool call.

## Install

```bash
npx gsd-agent-inbox
```

The interactive installer auto-detects your AI coding agents (Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf), configures the MCP server, and installs the optional skill for each.

When launched by an MCP client (non-TTY), it starts the MCP server normally. When you run it from a terminal, you get the installer.

## What it does

An [MCP server](https://modelcontextprotocol.io) that creates real, temporary email addresses on demand. Your agent can sign up for services, receive confirmation emails, extract verification links, and clean up — without you lifting a finger.

No API keys. No accounts. No configuration. Works with any email-sending service — Supabase, Resend, SendGrid, Postmark, AWS SES, whatever.

## The problem

AI agents hit a wall when a service requires email verification. They can fill out a sign-up form, but they can't receive the confirmation email. So they stop and ask you to do it.

## The fix

```
Agent: create_inbox({ prefix: "signup", name: "test" })
→ signup-1712345678@somedomain.com (name: test)

Agent: [fills sign-up form with that email]

Agent: verify_email({ address: "test", subject_contains: "confirm" })
→ Email verified successfully!
  Verification URL: https://myapp.supabase.co/auth/v1/verify?token=abc123
  HTTP Status: 200

Agent: delete_inbox({ address: "test" })
→ Done.
```

## Manual setup

If you prefer to configure manually instead of using the installer:

### Claude Code

```bash
claude mcp add agent-inbox -- npx -y gsd-agent-inbox
```

Or add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "agent-inbox": {
      "command": "npx",
      "args": ["-y", "gsd-agent-inbox"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agent-inbox": {
      "command": "npx",
      "args": ["-y", "gsd-agent-inbox"]
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "agent-inbox": {
      "command": "npx",
      "args": ["-y", "gsd-agent-inbox"]
    }
  }
}
```

### Any other MCP client

Any client that supports stdio transport:

```json
{
  "command": "npx",
  "args": ["-y", "gsd-agent-inbox"]
}
```

### Build from source

```bash
git clone https://github.com/gsd-build/agent-inbox.git
cd agent-inbox
npm install
npm run build
npm start
```

## Tools

| Tool | What it does |
|------|-------------|
| `create_inbox` | Spin up a temporary email address. Optional `prefix` for readability, optional `name` for easy reference. |
| `check_inbox` | Check for messages. Returns subjects, bodies, and auto-extracted verification links. |
| `wait_for_email` | Poll until a matching email arrives. Filters by sender and subject. Auto-retries with backoff. |
| `verify_email` | One-shot verification: polls for confirmation email, extracts the link, visits it via HTTP. Three steps in one tool call. |
| `list_inboxes` | Show all active inboxes with names and providers. |
| `delete_inbox` | Destroy an inbox and its backing account. |

### Named inboxes

Give inboxes a name for easy reference across multiple tool calls:

```
create_inbox({ prefix: "signup", name: "main" })
wait_for_email({ address: "main", subject_contains: "confirm" })
delete_inbox({ address: "main" })
```

## Skill

The installer can optionally add a skill file that teaches your AI agent *when* and *how* to use agent-inbox — so it reaches for the inbox tools automatically when it encounters auth flows, email verification, or sign-up testing.

To install the skill manually:

```bash
mkdir -p ~/.claude/skills/agent-inbox
curl -fsSL https://raw.githubusercontent.com/gsd-build/agent-inbox/main/skill/SKILL.md \
  -o ~/.claude/skills/agent-inbox/SKILL.md
```

## How it works

Uses [mail.tm](https://mail.tm) as the primary provider with automatic fallback to [1secmail](https://www.1secmail.com) if mail.tm is down. No API keys or accounts required.

- **Fallback providers** — if mail.tm fails, 1secmail kicks in automatically
- **Cleanup on exit** — inboxes are deleted when the MCP server shuts down (SIGINT/SIGTERM)
- **Smart polling** — `wait_for_email` retries with backoff (3s → 5s → 10s → 15s)
- **Link extraction** — confirmation/verification URLs auto-detected via keyword matching

## Limitations

- Some services block disposable email domains. If sign-up is rejected, try a different service or provider.
- Inboxes don't survive server restarts (in-memory only).
- Text and HTML bodies only — no attachment support.

## License

MIT
