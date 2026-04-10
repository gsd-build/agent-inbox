/**
 * Email provider abstraction with mail.tm as primary and 1secmail as fallback.
 */

// --- Shared types ---

export interface Inbox {
  address: string;
  password: string;
  token: string;
  accountId: string;
  provider: "mail.tm" | "1secmail";
  name?: string;
}

export interface MessageFull {
  id: string;
  from: { address: string; name: string };
  subject: string;
  intro: string;
  createdAt: string;
  text: string;
  html: string[];
}

// --- mail.tm provider ---

const MAILTM_URL = "https://api.mail.tm";

interface MailTmDomain {
  id: string;
  domain: string;
  isActive: boolean;
}

interface MailTmMessageSummary {
  id: string;
  from: { address: string; name: string };
  subject: string;
  intro: string;
  createdAt: string;
}

interface MailTmMessageFull extends MailTmMessageSummary {
  text: string;
  html: string[];
}

async function mailtmRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${MAILTM_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`mail.tm ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

function mailtmAuth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function mailtmCreateInbox(prefix?: string): Promise<Inbox> {
  const domains = await mailtmRequest<{ "hydra:member": MailTmDomain[] }>("/domains");
  const active = domains["hydra:member"].find((d) => d.isActive);
  if (!active) throw new Error("No active mail.tm domains");

  const localPart = prefix
    ? `${prefix}-${Date.now()}`
    : `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const address = `${localPart}@${active.domain}`;
  const password = generatePassword();

  await mailtmRequest("/accounts", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });

  const tokenRes = await mailtmRequest<{ token: string; id: string }>("/token", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });

  return { address, password, token: tokenRes.token, accountId: tokenRes.id, provider: "mail.tm" };
}

async function mailtmListMessages(token: string): Promise<MailTmMessageSummary[]> {
  const res = await mailtmRequest<{ "hydra:member": MailTmMessageSummary[] }>("/messages", {
    headers: mailtmAuth(token),
  });
  return res["hydra:member"];
}

async function mailtmGetMessage(token: string, messageId: string): Promise<MessageFull> {
  const msg = await mailtmRequest<MailTmMessageFull>(`/messages/${messageId}`, {
    headers: mailtmAuth(token),
  });
  return { id: msg.id, from: msg.from, subject: msg.subject, intro: msg.intro, createdAt: msg.createdAt, text: msg.text, html: msg.html };
}

async function mailtmDelete(token: string, accountId: string): Promise<void> {
  await fetch(`${MAILTM_URL}/accounts/${accountId}`, {
    method: "DELETE",
    headers: mailtmAuth(token),
  });
}

// --- 1secmail fallback provider ---

const SECMAIL_URL = "https://www.1secmail.com/api/v1";

interface SecMailMessage {
  id: number;
  from: string;
  subject: string;
  date: string;
}

interface SecMailMessageFull extends SecMailMessage {
  body: string;
  textBody: string;
  htmlBody: string;
}

async function secmailCreateInbox(prefix?: string): Promise<Inbox> {
  const localPart = prefix
    ? `${prefix}-${Date.now()}`
    : `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 1secmail uses predefined domains — pick one
  const domains = ["1secmail.com", "1secmail.org", "1secmail.net"];
  const domain = domains[Math.floor(Math.random() * domains.length)]!;
  const address = `${localPart}@${domain}`;

  // 1secmail doesn't require account creation — just start polling
  return { address, password: "", token: "", accountId: "", provider: "1secmail" };
}

async function secmailListMessages(address: string): Promise<SecMailMessage[]> {
  const [login, domain] = address.split("@") as [string, string];
  const res = await fetch(`${SECMAIL_URL}/?action=getMessages&login=${login}&domain=${domain}`);
  if (!res.ok) throw new Error(`1secmail ${res.status}`);
  return res.json() as Promise<SecMailMessage[]>;
}

async function secmailGetMessage(address: string, id: number): Promise<MessageFull> {
  const [login, domain] = address.split("@") as [string, string];
  const res = await fetch(`${SECMAIL_URL}/?action=readMessage&login=${login}&domain=${domain}&id=${id}`);
  if (!res.ok) throw new Error(`1secmail ${res.status}`);
  const msg = (await res.json()) as SecMailMessageFull;
  return {
    id: String(msg.id),
    from: { address: msg.from, name: msg.from },
    subject: msg.subject,
    intro: msg.textBody?.slice(0, 200) || "",
    createdAt: msg.date,
    text: msg.textBody || msg.body || "",
    html: msg.htmlBody ? [msg.htmlBody] : [],
  };
}

// --- Unified API ---

export async function createInbox(prefix?: string): Promise<Inbox> {
  // Try mail.tm first, fall back to 1secmail
  try {
    return await mailtmCreateInbox(prefix);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`mail.tm failed (${msg}), falling back to 1secmail`);
    return await secmailCreateInbox(prefix);
  }
}

export async function listMessages(inbox: Inbox): Promise<MessageFull[]> {
  if (inbox.provider === "1secmail") {
    const summaries = await secmailListMessages(inbox.address);
    const full: MessageFull[] = [];
    for (const s of summaries) {
      full.push(await secmailGetMessage(inbox.address, s.id));
    }
    return full;
  }

  // mail.tm
  const summaries = await mailtmListMessages(inbox.token);
  const full: MessageFull[] = [];
  for (const s of summaries) {
    full.push(await mailtmGetMessage(inbox.token, s.id));
  }
  return full;
}

export async function deleteAccount(inbox: Inbox): Promise<void> {
  if (inbox.provider === "mail.tm") {
    await mailtmDelete(inbox.token, inbox.accountId);
  }
  // 1secmail has no delete API — inboxes expire automatically
}

// --- Link extraction ---

const urlRegex = /https?:\/\/[^\s"'<>\])}]+/g;

const confirmKeywords = [
  "confirm", "verify", "activate", "validate",
  "token", "magic", "auth", "callback",
  "signup", "sign-up", "register",
  "click", "link", "action",
  "redirect", "return",
];

function cleanUrl(url: string): string {
  return url.replace(/[.,;:!?)}\]]+$/, "");
}

function isConfirmationLink(url: string): boolean {
  const lower = url.toLowerCase();
  return confirmKeywords.some((kw) => lower.includes(kw));
}

export function extractConfirmationLinks(message: MessageFull): string[] {
  const links = new Set<string>();

  for (const html of message.html) {
    for (const url of html.match(urlRegex) || []) {
      if (isConfirmationLink(url)) links.add(cleanUrl(url));
    }
  }
  if (message.text) {
    for (const url of message.text.match(urlRegex) || []) {
      if (isConfirmationLink(url)) links.add(cleanUrl(url));
    }
  }
  return [...links];
}

export function extractAllLinks(message: MessageFull): string[] {
  const links = new Set<string>();
  for (const html of message.html) {
    for (const match of html.match(urlRegex) || []) links.add(cleanUrl(match));
  }
  if (message.text) {
    for (const match of message.text.match(urlRegex) || []) links.add(cleanUrl(match));
  }
  return [...links];
}

// --- Util ---

function generatePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let pw = "";
  for (let i = 0; i < 16; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)];
  }
  return pw;
}
