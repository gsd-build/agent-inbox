# agent-inbox

Give any AI agent a disposable email inbox in one tool call.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/gsd-build/agent-inbox/main/install.sh | bash
```

The installer auto-detects your AI coding agents (Claude Code, Cursor, Windsurf) and configures the MCP server + optional skill for each.

## What it does

An [MCP server](https://modelcontextprotocol.io) that creates real, temporary email addresses on demand. Your agent can sign up for services, receive confirmation emails, extract verification links, and clean up — without you lifting a finger.

No API keys. No accounts. No configuration. Works with any email-sending service — Supabase, Resend, SendGrid, Postmark, AWS SES, whatever.

## The problem

AI agents hit a wall when a service requires email verification. They can fill out a sign-up form, but they can't receive the confirmation email. So they stop and ask you to do it.

## The fix

```
Agent: create_inbox({ prefix: "signup" })
→ signup-1712345678@somedomain.com

Agent: [fills sign-up form with that email]

Agent: check_inbox({ address: "signup-1712345678@somedomain.com", wait_seconds: 15 })
→ Found 1 message
  Subject: Confirm your email
  Confirmation Links:
    → https://myapp.supabase.co/auth/v1/verify?token=abc123&type=signup

Agent: [clicks the confirmation link]

Agent: delete_inbox({ address: "signup-1712345678@somedomain.com" })
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
| `create_inbox` | Spin up a temporary email address. Pass an optional `prefix` for readability. |
| `check_inbox` | Poll for messages. Returns subjects, bodies, and auto-extracted verification links. `wait_seconds` lets the email arrive before checking. |
| `list_inboxes` | Show all active inboxes in the current session. |
| `delete_inbox` | Destroy an inbox and its backing account. |

## Skill

The installer can optionally add a skill file that teaches your AI agent *when* and *how* to use agent-inbox — so it reaches for the inbox tools automatically when it encounters auth flows, email verification, or sign-up testing.

To install the skill manually:

```bash
mkdir -p ~/.claude/skills/agent-inbox
curl -fsSL https://raw.githubusercontent.com/gsd-build/agent-inbox/main/skill/SKILL.md \
  -o ~/.claude/skills/agent-inbox/SKILL.md
```

## How it works

Uses the [mail.tm](https://mail.tm) API to create real, internet-facing email addresses. No API key or account required — mail.tm provides free disposable mailboxes.

- Inboxes are ephemeral — they live only as long as the MCP server process
- Each address gets a unique timestamp suffix to avoid collisions
- `check_inbox` auto-extracts confirmation/verification URLs via keyword matching
- Cleanup deletes the mailbox on the mail.tm side

## Limitations

- Some services block disposable email domains. If sign-up is rejected, the service likely has mail.tm on a blocklist.
- mail.tm rate limits to ~8 req/s. Don't poll in a tight loop.
- Inboxes don't survive server restarts (in-memory only).
- Text and HTML bodies only — no attachment support.

## License

MIT
