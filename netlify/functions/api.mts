import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";
import { createHash, randomBytes } from "node:crypto";

const PIN_HASH = "20f3765880a5c269b747e1e906054a4b4a3a991259f1e16b5dde4742cec2319a";
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

  return rows[0]?.member_slug ?? null;
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

  const totalCapital = memberRows.reduce((sum, m) => sum + Number(m.capital), 0);
  const openMove = liveFund - closedFund;

  const members = memberRows.map((m) => {
    const capital = Number(m.capital);
    const fallback = m.slug === "micky" ? 0.4 : 0.3;
    const share = totalCapital > 0 ? capital / totalCapital : fallback;
    return {
      slug: m.slug,
      name: m.display_name,
      ownershipPct: share * 100,
      value: capital + openMove * share,
    };
  });

  return {
    demo: true,
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

  if (!["micky", "doc", "hacky"].includes(member) || sha256(submittedPin) !== PIN_HASH) {
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

async function handleWithdraw(req: Request) {
  const me = await authenticate(req);
  if (!me) return response({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as { amount?: number };
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return response({ error: "Enter a valid amount" }, 400);
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const memberResult = await client.query(
      "SELECT capital FROM members WHERE slug = $1 FOR UPDATE",
      [me]
    );
    await client.query(
      "SELECT last_fund_balance FROM fund_state WHERE id = 1 FOR UPDATE"
    );

    const capital = Number(memberResult.rows[0]?.capital ?? 0);
    if (amount > capital + 1e-8) {
      await client.query("ROLLBACK");
      return response({ error: "Amount is more than your available balance" }, 400);
    }

    await client.query(
      "UPDATE members SET capital = capital - $1 WHERE slug = $2",
      [amount, me]
    );
    await client.query(
      `UPDATE fund_state
       SET withdrawal_offset = withdrawal_offset + $1,
           last_fund_balance = CASE
             WHEN last_fund_balance IS NULL THEN NULL
             ELSE last_fund_balance - $1
           END
       WHERE id = 1`,
      [amount]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

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
    const membersResult = await client.query(
      `SELECT slug, capital
       FROM members
       ORDER BY CASE slug WHEN 'micky' THEN 1 WHEN 'doc' THEN 2 ELSE 3 END
       FOR UPDATE`
    );

    const withdrawalOffset = Number(stateResult.rows[0]?.withdrawal_offset ?? 0);
    const previousFundBalance =
      stateResult.rows[0]?.last_fund_balance == null
        ? null
        : Number(stateResult.rows[0].last_fund_balance);

    const fundBalance = balance - withdrawalOffset;
    const capitals = new Map<string, number>(
      membersResult.rows.map((row: any) => [row.slug, Number(row.capital)])
    );
    const totalCapital = [...capitals.values()].reduce((a, b) => a + b, 0);

    if (previousFundBalance == null || totalCapital <= 0) {
      await client.query(
        `UPDATE members
         SET capital = CASE slug
           WHEN 'micky' THEN $1
           WHEN 'doc' THEN $2
           WHEN 'hacky' THEN $3
           ELSE capital
         END`,
        [fundBalance * 0.4, fundBalance * 0.3, fundBalance * 0.3]
      );
    } else {
      const delta = fundBalance - previousFundBalance;
      if (Math.abs(delta) > 1e-8) {
        for (const [slug, capital] of capitals.entries()) {
          const share = capital / totalCapital;
          await client.query(
            "UPDATE members SET capital = capital + $1 WHERE slug = $2",
            [delta * share, slug]
          );
        }
      }
    }

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
    if (path === "/api/withdraw" && req.method === "POST") return await handleWithdraw(req);
    if (path === "/api/report" && req.method === "POST") return await handleReport(req);
    return response({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return response({ error: "Server error" }, 500);
  }
};

export const config: Config = {
  path: ["/api/login", "/api/state", "/api/withdraw", "/api/report"],
};
