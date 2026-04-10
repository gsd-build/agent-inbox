---
name: agent-inbox
description: Create temporary email inboxes and receive emails for testing auth flows, email verification, account confirmation, and any scenario where an AI agent needs to receive an email. Uses the agent-inbox MCP server with mail.tm + 1secmail fallback.
---

<objective>
Create temporary email inboxes on demand, receive real emails from any service (Supabase, Resend, SendGrid, etc.), extract confirmation/verification links, and optionally verify them in one tool call.
</objective>

<when_to_use>
- Testing sign-up / auth flows that require email verification
- Receiving "confirm your account" or "verify your email" links
- Any automated workflow where you need to receive an email
- E2E testing of email-sending features
</when_to_use>

<tools>
Six MCP tools from the `agent-inbox` server:

- `mcp__agent-inbox__create_inbox` — Create a new temporary inbox. Optional `name` parameter for easy reference.
- `mcp__agent-inbox__check_inbox` — Check for messages. Returns subjects, bodies, and extracted confirmation links.
- `mcp__agent-inbox__wait_for_email` — Poll until a matching email arrives. Filters by `from` and `subject_contains`. Auto-retries with backoff.
- `mcp__agent-inbox__verify_email` — One-shot: polls for confirmation email, extracts link, visits it via HTTP GET. Three steps in one call.
- `mcp__agent-inbox__list_inboxes` — List all active inboxes in this session.
- `mcp__agent-inbox__delete_inbox` — Delete an inbox when done.
</tools>

<process>

**Fast path (recommended) — use `verify_email` for the common case:**

1. **Create inbox** — `create_inbox({ prefix: "signup", name: "test" })`
2. **Use the address** — Enter it in a sign-up form, invite field, etc.
3. **Verify in one call** — `verify_email({ address: "test", subject_contains: "confirm" })` — polls for the email, extracts the link, visits it via HTTP.
4. **Clean up** — `delete_inbox({ address: "test" })`

**Manual path — when you need more control:**

1. **Create inbox** — `create_inbox({ prefix: "signup", name: "test" })`
2. **Use the address** — Enter it wherever the service asks for an email.
3. **Wait for email** — `wait_for_email({ address: "test", from: "noreply@example.com", timeout_seconds: 60 })` — polls with backoff until a matching email arrives.
4. **Act on links** — Navigate to the confirmation link via browser automation or HTTP.
5. **Clean up** — `delete_inbox({ address: "test" })`

</process>

<important_notes>
- Named inboxes: pass `name` to `create_inbox`, then use that name in all other tools instead of the full email address.
- Fallback providers: mail.tm is primary, 1secmail kicks in automatically if mail.tm is down.
- Inboxes are cleaned up automatically when the MCP server shuts down.
- Some services block disposable email domains. If sign-up is rejected, the service may have these domains on a blocklist.
</important_notes>

<example>
**Testing a Supabase auth sign-up flow (fast path):**

```
1. create_inbox(prefix: "auth-test", name: "signup")
   → auth-test-1234567890@somedomain.com (name: signup)

2. Fill sign-up form with that address + a password

3. verify_email(address: "signup", subject_contains: "confirm")
   → Email verified successfully!
     HTTP Status: 200
     Final URL: https://myapp.com/welcome

4. delete_inbox(address: "signup")
```
</example>
