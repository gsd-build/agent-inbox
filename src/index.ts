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
  createInbox,
  listMessages,
  getMessage,
  deleteAccount,
  extractConfirmationLinks,
  extractAllLinks,
  type Inbox,
} from "./mail-tm.js";

// In-memory inbox store — keyed by address
const inboxes = new Map<string, Inbox>();

const server = new McpServer({
  name: "agent-inbox",
  version: "1.0.0",
});

// --- Tool: create_inbox ---
server.tool(
  "create_inbox",
  "Create a temporary email inbox. Returns a real email address that can receive emails from any service (Supabase, Resend, etc). Use this before signing up for a service that requires email verification.",
  {
    prefix: z
      .string()
      .optional()
      .describe(
        "Optional prefix for the email address (e.g. 'gsd-test'). A timestamp is always appended for uniqueness."
      ),
  },
  async ({ prefix }) => {
    const inbox = await createInbox(prefix);
    inboxes.set(inbox.address, inbox);

    return {
      content: [
        {
          type: "text",
          text: [
            `Inbox created successfully.`,
            ``,
            `Address: ${inbox.address}`,
            ``,
            `Use this address to sign up for services. Then call check_inbox with this address to retrieve confirmation emails.`,
            ``,
            `Note: This inbox is temporary and will be destroyed when you call delete_inbox or when the server restarts.`,
          ].join("\n"),
        },
      ],
    };
  }
);

// --- Tool: check_inbox ---
server.tool(
  "check_inbox",
  "Check a temporary inbox for new messages. Returns message subjects, senders, and any confirmation/verification links found. If no messages yet, wait a few seconds and try again — email delivery can take 5-30 seconds.",
  {
    address: z
      .string()
      .describe("The temporary email address to check (from create_inbox)"),
    wait_seconds: z
      .number()
      .min(0)
      .max(60)
      .default(5)
      .optional()
      .describe(
        "Seconds to wait before checking (default 5). Useful for giving email time to arrive."
      ),
  },
  async ({ address, wait_seconds }) => {
    const inbox = inboxes.get(address);
    if (!inbox) {
      return {
        content: [
          {
            type: "text",
            text: `Inbox not found: ${address}\n\nAvailable inboxes: ${[...inboxes.keys()].join(", ") || "(none)"}`,
          },
        ],
        isError: true,
      };
    }

    const waitMs = (wait_seconds ?? 5) * 1000;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const messages = await listMessages(inbox.token);

    if (messages.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No messages yet in ${address}.\n\nEmail delivery can take 5-30 seconds. Try again with a longer wait_seconds.`,
          },
        ],
      };
    }

    // Fetch full message bodies for link extraction
    const results: string[] = [];
    for (const msg of messages) {
      const full = await getMessage(inbox.token, msg.id);
      const confirmLinks = extractConfirmationLinks(full);
      const allLinks = extractAllLinks(full);

      results.push(
        [
          `--- Message ---`,
          `From: ${msg.from.name} <${msg.from.address}>`,
          `Subject: ${msg.subject}`,
          `Date: ${msg.createdAt}`,
          `Preview: ${msg.intro}`,
          ``,
          confirmLinks.length > 0
            ? `Confirmation/Verification Links:\n${confirmLinks.map((l) => `  → ${l}`).join("\n")}`
            : `No confirmation links detected.`,
          ``,
          allLinks.length > 0
            ? `All Links:\n${allLinks.map((l) => `  - ${l}`).join("\n")}`
            : `No links found.`,
          ``,
          `Plain Text Body:\n${full.text || "(empty)"}`,
        ].join("\n")
      );
    }

    return {
      content: [
        {
          type: "text",
          text: [
            `Found ${messages.length} message(s) in ${address}:`,
            ``,
            ...results,
          ].join("\n"),
        },
      ],
    };
  }
);

// --- Tool: list_inboxes ---
server.tool(
  "list_inboxes",
  "List all active temporary inboxes created in this session.",
  {},
  async () => {
    const addresses = [...inboxes.keys()];
    return {
      content: [
        {
          type: "text",
          text:
            addresses.length > 0
              ? `Active inboxes:\n${addresses.map((a) => `  - ${a}`).join("\n")}`
              : `No active inboxes. Use create_inbox to create one.`,
        },
      ],
    };
  }
);

// --- Tool: delete_inbox ---
server.tool(
  "delete_inbox",
  "Delete a temporary inbox and its account. Use after you're done with email verification.",
  {
    address: z
      .string()
      .describe("The temporary email address to delete"),
  },
  async ({ address }) => {
    const inbox = inboxes.get(address);
    if (!inbox) {
      return {
        content: [
          {
            type: "text",
            text: `Inbox not found: ${address}`,
          },
        ],
        isError: true,
      };
    }

    try {
      await deleteAccount(inbox.token, inbox.accountId);
    } catch {
      // Best-effort cleanup
    }
    inboxes.delete(address);

    return {
      content: [
        {
          type: "text",
          text: `Inbox ${address} deleted.`,
        },
      ],
    };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
