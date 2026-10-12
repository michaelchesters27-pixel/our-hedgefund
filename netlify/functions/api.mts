import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";
import { createHash, randomBytes } from "node:crypto";

const PIN_HASH = "20f3765880a5c269b747e1e906054a4b4a3a991259f1e16b5dde4742cec2319a";
const ACTIVE_MEMBERS = new Set(["micky", "doc"]);
const REPORTER_KEY_HASH = "74142b030fa08e1a813f9a3339991087367a24c49cc021651488aeda4ebcbde4";

const db = getDatabase();

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function response(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function authenticate(req: Request) {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const tokenHash = sha256(token);

  const rows = await db.sql<{ member_slug: string }>`
    SELECT member_slug
    FROM sessions
    WHERE token_hash = ${tokenHash}
      AND expires_at > NOW()
    LIMIT 1
  `;

  const member = rows[0]?.member_slug ?? null;
  return member && ACTIVE_MEMBERS.has(member) ? member : null;
}

async function snapshot(me: string) {
  const stateRows = await db.sql<{
    broker_balance: string | null;
    broker_equity: string | null;
    currency: string;
    withdrawal_offset: string;
    last_fund_balance: string | null;
    updated_at: string | null;
  }>`
    SELECT broker_balance, broker_equity, currency, withdrawal_offset, last_fund_balance, updated_at
    FROM fund_state
    WHERE id = 1
  `;
  const memberRows = await db.sql<{ slug: string; display_name: string; capital: string }>`
    SELECT slug, display_name, capital
    FROM members
    ORDER BY CASE slug WHEN 'micky' THEN 1 WHEN 'doc' THEN 2 ELSE 3 END
  `;

  const s = stateRows[0];
  const withdrawalOffset = Number(s?.withdrawal_offset ?? 0);
  const brokerEquity = s?.broker_equity == null ? null : Number(s.broker_equity);
  const closedFund = s?.last_fund_balance == null ? 0 : Number(s.last_fund_balance);
  const liveFund = brokerEquity == null ? closedFund : brokerEquity - withdrawalOffset;

  const openMove = liveFund - closedFund;
  const members = memberRows.filter((m) => ACTIVE_MEMBERS.has(m.slug)).map((m) => ({
    slug: m.slug,
    name: m.display_name,
    ownershipPct: 50,
    value: (closedFund + openMove) / 2,
  }));

  return {
    demo: false,
    me,
    currency: s?.currency ?? "USD",
    livePot: liveFund,
    updatedAt: s?.updated_at ?? null,
    members,
  };
}

async function handleLogin(req: Request) {
  const body = await req.json().catch(() => ({})) as { name?: string; pin?: string };
  const member = String(body.name ?? "").toLowerCase();
  const submittedPin = String(body.pin ?? "");

  if (!ACTIVE_MEMBERS.has(member) || sha256(submittedPin) !== PIN_HASH) {
    return response({ error: "Wrong name or PIN" }, 401);
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);

  await db.sql`DELETE FROM sessions WHERE expires_at <= NOW()`;
  await db.sql`
    INSERT INTO sessions (token_hash, member_slug, expires_at)
    VALUES (${tokenHash}, ${member}, NOW() + INTERVAL '12 hours')
  `;

  return response({ token, user: member });
}

async function handleState(req: Request) {
  const me = await authenticate(req);
  if (!me) return response({ error: "Unauthorized" }, 401);
  return response(await snapshot(me));
}

async function handleReport(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || sha256(token) !== REPORTER_KEY_HASH) {
    return response({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null) as
    | { balance?: number; equity?: number; currency?: string }
    | null;

  const balance = Number(body?.balance);
  const equity = Number(body?.equity);
  if (!Number.isFinite(balance) || !Number.isFinite(equity) || balance < 0 || equity < 0) {
    return response({ error: "Invalid balance/equity" }, 400);
  }

  const currency = String(body?.currency ?? "USD").slice(0, 8);

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const stateResult = await client.query(
      `SELECT withdrawal_offset, last_fund_balance
       FROM fund_state
       WHERE id = 1
       FOR UPDATE`
    );
    const withdrawalOffset = Number(stateResult.rows[0]?.withdrawal_offset ?? 0);
    const fundBalance = balance - withdrawalOffset;

    // Equal partnership: never allocate any capital to a removed third member.
    await client.query(
      `UPDATE members SET capital = $1 WHERE slug IN ('micky', 'doc')`,
      [fundBalance / 2]
    );

    await client.query(
      `UPDATE fund_state
       SET broker_balance = $1,
           broker_equity = $2,
           currency = $3,
           last_fund_balance = $4,
           updated_at = NOW()
       WHERE id = 1`,
      [balance, equity, currency, fundBalance]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return response({ ok: true });
}

export default async (req: Request) => {
  const path = new URL(req.url).pathname;

  try {
    if (path === "/api/login" && req.method === "POST") return await handleLogin(req);
    if (path === "/api/state" && req.method === "GET") return await handleState(req);
    if (path === "/api/report" && req.method === "POST") return await handleReport(req);
    return response({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return response({ error: "Server error" }, 500);
  }
};

export const config: Config = {
  path: ["/api/login", "/api/state", "/api/report"],
};
