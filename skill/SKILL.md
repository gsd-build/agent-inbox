---
name: agent-inbox
description: Create temporary email inboxes and receive emails for testing auth flows, email verification, account confirmation, and any scenario where an AI agent needs to receive an email. Uses the agent-inbox MCP server backed by mail.tm.
---

<objective>
Create temporary email inboxes on demand, receive real emails from any service (Supabase, Resend, SendGrid, etc.), extract confirmation/verification links, and hand them off to browser automation for clicking.
</objective>

<when_to_use>
- Testing sign-up / auth flows that require email verification
- Receiving "confirm your account" or "verify your email" links
- Any automated workflow where you need to receive an email
- E2E testing of email-sending features
</when_to_use>

<tools>
Four MCP tools from the `agent-inbox` server:

- `mcp__agent-inbox__create_inbox` — Create a new temporary inbox. Returns a real email address.
- `mcp__agent-inbox__check_inbox` — Poll for messages. Returns subjects, bodies, and extracted confirmation links.
- `mcp__agent-inbox__list_inboxes` — List all active inboxes in this session.
- `mcp__agent-inbox__delete_inbox` — Delete an inbox when done.
</tools>

<process>

1. **Create inbox** — Call `create_inbox` with an optional `prefix` (e.g. `gsd-test`, `signup-flow`). Save the returned address.

2. **Use the address** — Enter it wherever the service asks for an email (sign-up form, invite field, etc.).

3. **Poll for messages** — Call `check_inbox` with the address. Use `wait_seconds: 10` on the first attempt to give email time to arrive. If empty, retry with `wait_seconds: 15-30`. Most emails arrive within 5-30 seconds.

4. **Extract links** — The tool auto-extracts confirmation/verification URLs. Look for the "Confirmation/Verification Links" section in the response. If no confirmation links are detected, check "All Links" for the right one.

5. **Act on links** — Navigate to the confirmation link (via browser automation or direct HTTP) to complete the verification flow.

6. **Clean up** — Call `delete_inbox` when done. Inboxes are also destroyed when the MCP server restarts.

</process>

<important_notes>
- Inboxes are real internet-facing email addresses (mail.tm domains). Any service can deliver to them.
- Inboxes are ephemeral — they only persist for the duration of the MCP server process.
- The in-memory store means if you create an inbox in one session, you cannot access it from another session after a server restart.
- Rate limit: mail.tm allows ~8 requests/second. Don't spam `check_inbox` in a tight loop.
- Some services block disposable email domains. If sign-up is rejected, the service may have mail.tm domains on a blocklist.
</important_notes>

<example>
**Testing a Supabase auth sign-up flow:**

```
1. create_inbox(prefix: "auth-test")
   → auth-test-1234567890@somedomain.com

2. Fill sign-up form with that address + a password

3. check_inbox(address: "auth-test-1234567890@somedomain.com", wait_seconds: 15)
   → Found 1 message
     Subject: Confirm your email
     Confirmation Links:
       → https://myapp.supabase.co/auth/v1/verify?token=abc123&type=signup

4. Navigate to that confirmation link

5. delete_inbox(address: "auth-test-1234567890@somedomain.com")
```
</example>
