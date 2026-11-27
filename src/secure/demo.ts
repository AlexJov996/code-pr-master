import type { ScanFile } from "./scan.js";

/** A fictional service with the kinds of flaws an agentic scanner is meant to find. */
export const DEMO_SECURE_FILES: ScanFile[] = [
  { path: "api/invoices.ts", content: "router.get('/invoices/:id', async (req, res) => {\n  const invoice = await db.invoices.findById(req.params.id);\n  return res.json(invoice);\n});\n" },
  { path: "api/preview.ts", content: "router.post('/preview', async (req, res) => {\n  const { url } = req.body;\n  const img = await fetch(url);\n  res.type('png').send(await img.buffer());\n});\n" },
  { path: "api/search.ts", content: "export async function search(req) {\n  const sort = sanitizeHtml(req.query.sort);\n  const rows = await db.raw(`SELECT * FROM repos ORDER BY ${sort}`);\n  return rows;\n}\n" },
  { path: "agents/support-bot.ts", content: "export async function reply(ticket) {\n  const reply = await llm.complete(`You are a support agent with tools.\\nTicket: ${ticket.body}`, { tools: [refundTool, lookupTool] });\n  return reply;\n}\n" },
  { path: "wallet/withdraw.ts", content: "export async function withdraw(user, amount) {\n  const balance = await wallet.balance(user);\n  if (balance >= amount) {\n    await wallet.debit(user, amount);\n  }\n}\n" },
  { path: "auth/jwt.ts", content: "export function verifyToken(token) {\n  return jwt.verify(token, secret, { algorithms: ['none', 'HS256'] });\n}\n" },
  { path: "core/config.ts", content: "export const config = {\n  tls: { rejectUnauthorized: false },\n  region: 'eu-west-1',\n};\n" },
  { path: "core/hash.ts", content: "import { createHash } from 'node:crypto';\nexport const fingerprint = (s) => createHash('md5').update(s).digest('hex');\n" },
  { path: "core/util.ts", content: "export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));\n" },
  { path: "workers/mailer.ts", content: "export async function send(job) {\n  await mailer.send(job.payload);\n}\n" },
  { path: "tests/search.test.ts", content: "test('search', () => { eval('1+1'); });\n" },
];

export const DEMO_SECURE_TOTALS: Record<string, number> = { api: 3, agents: 1, wallet: 1, auth: 2, core: 4, workers: 2, tests: 1 };
