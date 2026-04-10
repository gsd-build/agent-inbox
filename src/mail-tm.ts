/**
 * mail.tm API client — creates temporary inboxes and reads messages.
 * API docs: https://docs.mail.tm/
 */

const BASE_URL = "https://api.mail.tm";

interface Domain {
  id: string;
  domain: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Account {
  id: string;
  address: string;
  quota: number;
  used: number;
  isDisabled: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MessageSummary {
  id: string;
  accountId: string;
  msgid: string;
  from: { address: string; name: string };
  to: { address: string; name: string }[];
  subject: string;
  intro: string;
  seen: boolean;
  isDeleted: boolean;
  hasAttachments: boolean;
  size: number;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface MessageFull extends MessageSummary {
  cc: { address: string; name: string }[];
  bcc: { address: string; name: string }[];
  flagged: boolean;
  verifications: string[];
  retention: boolean;
  retentionDate: string;
  text: string;
  html: string[];
}

export interface Inbox {
  address: string;
  password: string;
  token: string;
  accountId: string;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`mail.tm ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function generatePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let pw = "";
  for (let i = 0; i < 16; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)];
  }
  return pw;
}

export async function getAvailableDomains(): Promise<Domain[]> {
  const result = await request<{ "hydra:member": Domain[] }>("/domains");
  return result["hydra:member"];
}

export async function createInbox(prefix?: string): Promise<Inbox> {
  const domains = await getAvailableDomains();
  const activeDomain = domains.find((d) => d.isActive);
  if (!activeDomain) {
    throw new Error("No active domains available on mail.tm");
  }

  const localPart = prefix
    ? `${prefix}-${Date.now()}`
    : `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const address = `${localPart}@${activeDomain.domain}`;
  const password = generatePassword();

  await request<Account>("/accounts", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });

  const tokenResponse = await request<{ token: string; id: string }>(
    "/token",
    {
      method: "POST",
      body: JSON.stringify({ address, password }),
    }
  );

  return {
    address,
    password,
    token: tokenResponse.token,
    accountId: tokenResponse.id,
  };
}

export async function listMessages(
  token: string
): Promise<MessageSummary[]> {
  const result = await request<{ "hydra:member": MessageSummary[] }>(
    "/messages",
    { headers: authHeaders(token) }
  );
  return result["hydra:member"];
}

export async function getMessage(
  token: string,
  messageId: string
): Promise<MessageFull> {
  return request<MessageFull>(`/messages/${messageId}`, {
    headers: authHeaders(token),
  });
}

export async function deleteAccount(token: string, accountId: string): Promise<void> {
  await fetch(`${BASE_URL}/accounts/${accountId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

/** Extract URLs that look like confirmation/verification links from email HTML/text */
export function extractConfirmationLinks(message: MessageFull): string[] {
  const links: Set<string> = new Set();
  const urlRegex = /https?:\/\/[^\s"'<>\])}]+/g;

  // Search HTML bodies
  for (const html of message.html) {
    const matches = html.match(urlRegex) || [];
    for (const url of matches) {
      if (isConfirmationLink(url)) {
        links.add(cleanUrl(url));
      }
    }
  }

  // Search plain text
  if (message.text) {
    const matches = message.text.match(urlRegex) || [];
    for (const url of matches) {
      if (isConfirmationLink(url)) {
        links.add(cleanUrl(url));
      }
    }
  }

  return [...links];
}

function isConfirmationLink(url: string): boolean {
  const lower = url.toLowerCase();
  const keywords = [
    "confirm", "verify", "activate", "validate",
    "token", "magic", "auth", "callback",
    "signup", "sign-up", "register",
    "click", "link", "action",
    "redirect", "return",
  ];
  // Include any link that has auth-related keywords, or just return all links
  // if none match the keywords (the user can decide)
  return keywords.some((kw) => lower.includes(kw));
}

function cleanUrl(url: string): string {
  // Strip trailing punctuation that might have been captured
  return url.replace(/[.,;:!?)}\]]+$/, "");
}

/** Get ALL links from a message, not just confirmation ones */
export function extractAllLinks(message: MessageFull): string[] {
  const links: Set<string> = new Set();
  const urlRegex = /https?:\/\/[^\s"'<>\])}]+/g;

  for (const html of message.html) {
    for (const match of html.match(urlRegex) || []) {
      links.add(cleanUrl(match));
    }
  }
  if (message.text) {
    for (const match of message.text.match(urlRegex) || []) {
      links.add(cleanUrl(match));
    }
  }
  return [...links];
}
