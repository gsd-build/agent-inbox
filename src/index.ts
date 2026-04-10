#!/usr/bin/env node

// If stdin is a TTY, user ran this from a terminal → launch interactive installer.
// If stdin is NOT a TTY, an MCP client piped us → start the MCP server.
if (process.stdin.isTTY) {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const installer = join(__dirname, "..", "bin", "install.cjs");
  execFileSync(process.execPath, [installer], { stdio: "inherit" });
  process.exit(0);
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createInbox as createInboxProvider,
  listMessages,
  deleteAccount,
  extractConfirmationLinks,
  extractAllLinks,
  type Inbox,
  type MessageFull,
} from "./mail-tm.js";

// In-memory inbox store — keyed by address, with optional name alias
const inboxes = new Map<string, Inbox>();
const nameToAddress = new Map<string, string>();

function resolveInbox(addressOrName: string): Inbox | undefined {
  const address = nameToAddress.get(addressOrName) || addressOrName;
  return inboxes.get(address);
}

// Cleanup all inboxes on exit
async function cleanupAll() {
  for (const inbox of inboxes.values()) {
    try {
      await deleteAccount(inbox);
    } catch {
      // best-effort
    }
  }
}

process.on("SIGINT", async () => { await cleanupAll(); process.exit(0); });
process.on("SIGTERM", async () => { await cleanupAll(); process.exit(0); });
process.on("beforeExit", async () => { await cleanupAll(); });

const server = new McpServer({
  name: "agent-inbox",
  version: "2.0.0",
});

// --- Tool: create_inbox ---
server.tool(
  "create_inbox",
  "Create a temporary email inbox. Returns a real email address that can receive emails from any service (Supabase, Resend, etc). Uses mail.tm with automatic fallback to 1secmail if mail.tm is down.",
  {
    prefix: z
      .string()
      .optional()
      .describe("Optional prefix for the email address (e.g. 'signup-test'). A timestamp is appended for uniqueness."),
    name: z
      .string()
      .optional()
      .describe("Optional human-friendly name for this inbox (e.g. 'test-1'). Use this name in other tools instead of the full address."),
  },
  async ({ prefix, name }) => {
    const inbox = await createInboxProvider(prefix);

    if (name) {
      inbox.name = name;
      nameToAddress.set(name, inbox.address);
    }
    inboxes.set(inbox.address, inbox);

    return {
      content: [{
        type: "text",
        text: [
          `Inbox created successfully.`,
          ``,
          `Address: ${inbox.address}`,
          `Provider: ${inbox.provider}`,
          ...(name ? [`Name: ${name} (use this in other tools)`] : []),
          ``,
          `Use this address to sign up for services. Then call check_inbox or wait_for_email to retrieve messages.`,
        ].join("\n"),
      }],
    };
  }
);

// --- Tool: check_inbox ---
server.tool(
  "check_inbox",
  "Check a temporary inbox for new messages. Returns subjects, bodies, and auto-extracted confirmation links.",
  {
    address: z
      .string()
      .describe("The email address or inbox name to check"),
    wait_seconds: z
      .number()
      .min(0)
      .max(60)
      .default(5)
      .optional()
      .describe("Seconds to wait before checking (default 5). Gives email time to arrive."),
  },
  async ({ address, wait_seconds }) => {
    const inbox = resolveInbox(address);
    if (!inbox) {
      return {
        content: [{ type: "text", text: `Inbox not found: ${address}\n\nAvailable: ${[...inboxes.keys()].join(", ") || "(none)"}` }],
        isError: true,
      };
    }

    const waitMs = (wait_seconds ?? 5) * 1000;
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

    const messages = await listMessages(inbox);

    if (messages.length === 0) {
      return {
        content: [{ type: "text", text: `No messages yet in ${inbox.address}.\n\nTry again with a longer wait_seconds, or use wait_for_email for automatic polling.` }],
      };
    }

    return { content: [{ type: "text", text: formatMessages(inbox.address, messages) }] };
  }
);

// --- Tool: wait_for_email ---
server.tool(
  "wait_for_email",
  "Poll an inbox until a matching email arrives. Retries with backoff. Returns the matching message with extracted links. Much better than manually calling check_inbox in a loop.",
  {
    address: z
      .string()
      .describe("The email address or inbox name to poll"),
    from: z
      .string()
      .optional()
      .describe("Filter: only match emails from this sender address (substring match)"),
    subject_contains: z
      .string()
      .optional()
      .describe("Filter: only match emails whose subject contains this string (case-insensitive)"),
    timeout_seconds: z
      .number()
      .min(5)
      .max(120)
      .default(60)
      .optional()
      .describe("Max seconds to wait before giving up (default 60)"),
  },
  async ({ address, from, subject_contains, timeout_seconds }) => {
    const inbox = resolveInbox(address);
    if (!inbox) {
      return {
        content: [{ type: "text", text: `Inbox not found: ${address}` }],
        isError: true,
      };
    }

    const timeout = (timeout_seconds ?? 60) * 1000;
    const start = Date.now();
    const intervals = [3000, 5000, 5000, 10000, 10000, 15000]; // backoff schedule
    let attempt = 0;

    while (Date.now() - start < timeout) {
      const delay = intervals[Math.min(attempt, intervals.length - 1)]!;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;

      const messages = await listMessages(inbox);

      const matches = messages.filter((m) => {
        if (from && !m.from.address.toLowerCase().includes(from.toLowerCase())) return false;
        if (subject_contains && !m.subject.toLowerCase().includes(subject_contains.toLowerCase())) return false;
        return true;
      });

      if (matches.length > 0) {
        const confirmLinks = matches.flatMap(extractConfirmationLinks);
        return {
          content: [{
            type: "text",
            text: [
              `Found ${matches.length} matching email(s) after ${attempt} poll(s):`,
              ``,
              ...matches.map((m) => [
                `From: ${m.from.name} <${m.from.address}>`,
                `Subject: ${m.subject}`,
                `Date: ${m.createdAt}`,
                ``,
                confirmLinks.length > 0
                  ? `Confirmation Links:\n${confirmLinks.map((l) => `  → ${l}`).join("\n")}`
                  : `No confirmation links detected.`,
                ``,
                `Body:\n${m.text || "(empty)"}`,
              ].join("\n")),
            ].join("\n"),
          }],
        };
      }
    }

    return {
      content: [{
        type: "text",
        text: `Timed out after ${Math.round(timeout / 1000)}s — no matching email arrived in ${inbox.address}.${from ? ` (filter: from=${from})` : ""}${subject_contains ? ` (filter: subject contains "${subject_contains}")` : ""}`,
      }],
    };
  }
);

// --- Tool: verify_email ---
server.tool(
  "verify_email",
  "One-shot email verification: polls for a confirmation email, extracts the verification link, and visits it via HTTP GET. Combines wait_for_email + link extraction + click in one tool call. Returns the HTTP status of the verification URL.",
  {
    address: z
      .string()
      .describe("The email address or inbox name to poll"),
    from: z
      .string()
      .optional()
      .describe("Filter: only match emails from this sender (substring match)"),
    subject_contains: z
      .string()
      .optional()
      .describe("Filter: only match emails whose subject contains this string"),
    timeout_seconds: z
      .number()
      .min(5)
      .max(120)
      .default(60)
      .optional()
      .describe("Max seconds to wait for the email (default 60)"),
  },
  async ({ address, from, subject_contains, timeout_seconds }) => {
    const inbox = resolveInbox(address);
    if (!inbox) {
      return {
        content: [{ type: "text", text: `Inbox not found: ${address}` }],
        isError: true,
      };
    }

    const timeout = (timeout_seconds ?? 60) * 1000;
    const start = Date.now();
    const intervals = [3000, 5000, 5000, 10000, 10000, 15000];
    let attempt = 0;

    while (Date.now() - start < timeout) {
      const delay = intervals[Math.min(attempt, intervals.length - 1)]!;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;

      const messages = await listMessages(inbox);
      const matches = messages.filter((m) => {
        if (from && !m.from.address.toLowerCase().includes(from.toLowerCase())) return false;
        if (subject_contains && !m.subject.toLowerCase().includes(subject_contains.toLowerCase())) return false;
        return true;
      });

      if (matches.length === 0) continue;

      const confirmLinks = matches.flatMap(extractConfirmationLinks);
      if (confirmLinks.length === 0) {
        return {
          content: [{
            type: "text",
            text: `Found email but no confirmation links detected.\n\nSubject: ${matches[0]!.subject}\n\nAll links:\n${matches.flatMap(extractAllLinks).map((l) => `  - ${l}`).join("\n") || "(none)"}`,
          }],
        };
      }

      // Visit the first confirmation link
      const link = confirmLinks[0]!;
      try {
        const res = await fetch(link, { redirect: "follow" });
        return {
          content: [{
            type: "text",
            text: [
              `Email verified successfully!`,
              ``,
              `Email: ${matches[0]!.subject}`,
              `Verification URL: ${link}`,
              `HTTP Status: ${res.status}`,
              `Final URL: ${res.url}`,
            ].join("\n"),
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text",
            text: `Found confirmation link but HTTP request failed:\n\nURL: ${link}\nError: ${msg}\n\nThe agent may need to visit this URL in a browser instead.`,
          }],
        };
      }
    }

    return {
      content: [{
        type: "text",
        text: `Timed out after ${Math.round(timeout / 1000)}s — no confirmation email arrived.`,
      }],
    };
  }
);

// --- Tool: list_inboxes ---
server.tool(
  "list_inboxes",
  "List all active temporary inboxes created in this session.",
  {},
  async () => {
    if (inboxes.size === 0) {
      return { content: [{ type: "text", text: "No active inboxes. Use create_inbox to create one." }] };
    }

    const lines = [...inboxes.values()].map((inbox) => {
      const name = inbox.name ? ` (name: ${inbox.name})` : "";
      return `  - ${inbox.address}${name} [${inbox.provider}]`;
    });

    return { content: [{ type: "text", text: `Active inboxes:\n${lines.join("\n")}` }] };
  }
);

// --- Tool: delete_inbox ---
server.tool(
  "delete_inbox",
  "Delete a temporary inbox and its account. Use after you're done with email verification.",
  {
    address: z
      .string()
      .describe("The email address or inbox name to delete"),
  },
  async ({ address }) => {
    const inbox = resolveInbox(address);
    if (!inbox) {
      return {
        content: [{ type: "text", text: `Inbox not found: ${address}` }],
        isError: true,
      };
    }

    try {
      await deleteAccount(inbox);
    } catch {
      // best-effort
    }

    if (inbox.name) nameToAddress.delete(inbox.name);
    inboxes.delete(inbox.address);

    return { content: [{ type: "text", text: `Inbox ${inbox.address} deleted.` }] };
  }
);

// --- Helpers ---

function formatMessages(address: string, messages: MessageFull[]): string {
  const results: string[] = [];
  for (const msg of messages) {
    const confirmLinks = extractConfirmationLinks(msg);
    const allLinks = extractAllLinks(msg);

    results.push([
      `--- Message ---`,
      `From: ${msg.from.name} <${msg.from.address}>`,
      `Subject: ${msg.subject}`,
      `Date: ${msg.createdAt}`,
      ``,
      confirmLinks.length > 0
        ? `Confirmation/Verification Links:\n${confirmLinks.map((l) => `  → ${l}`).join("\n")}`
        : `No confirmation links detected.`,
      ``,
      allLinks.length > 0
        ? `All Links:\n${allLinks.map((l) => `  - ${l}`).join("\n")}`
        : `No links found.`,
      ``,
      `Plain Text Body:\n${msg.text || "(empty)"}`,
    ].join("\n"));
  }
  return [`Found ${messages.length} message(s) in ${address}:`, ``, ...results].join("\n");
}

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
