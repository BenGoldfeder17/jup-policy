#!/usr/bin/env -S node --experimental-strip-types --no-warnings

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JupClient } from "../src/api/client.ts";
import { runForever, runOnce, snapshot } from "../src/engine/loop.ts";
import { parsePolicy } from "../src/policy/schema.ts";
import type { ExecutionResult } from "../src/engine/actions.ts";

interface Args {
  policyPath: string;
  live: boolean;
  once: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { policyPath: "", live: false, once: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--once") args.once = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a && !a.startsWith("-")) args.policyPath = a;
  }
  return args;
}

const HELP = `jup-policy — policy-as-JSON trading agent for Jupiter

Usage:
  jup-policy <policy.json> [--live] [--once]

Flags:
  --live    Hit Jupiter Trigger / Recurring endpoints and return unsigned txs.
            Requires \`wallet\` in policy JSON. Without --live, all actions are
            simulated and no POSTs are sent to order-creation endpoints.
  --once    Run a single evaluation tick and exit.
  -h,--help Print this message.

Env:
  JUP_API_KEY   Optional. Unset uses the keyless 0.5 RPS tier.

Examples:
  jup-policy examples/volatility-dca.json --once
  JUP_API_KEY=sk_... jup-policy examples/organic-score-rebalance.json
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.policyPath) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }
  const raw = await readFile(resolve(args.policyPath), "utf8");
  const policy = parsePolicy(JSON.parse(raw));
  const client = new JupClient();
  console.log(`[jup-policy] "${policy.name}" | keyless=${client.isKeyless} | live=${args.live}`);
  console.log(`[jup-policy] watching ${policy.watchMints.length} mints, ${policy.rules.length} rules`);

  const onTick = (snap: Awaited<ReturnType<typeof snapshot>>, results: ExecutionResult[]) => {
    const t = new Date(snap.takenAtMs).toISOString();
    for (const [mint, p] of Object.entries(snap.prices)) {
      console.log(`[${t}] ${mint.slice(0, 8)}… $${p.usdPrice.toFixed(4)} 24h=${p.priceChange24h.toFixed(2)}%`);
    }
    for (const r of results) {
      console.log(`  → [${r.status}] ${r.action.type}: ${r.detail}`);
    }
    if (results.length === 0) console.log(`  → no rules fired`);
  };

  if (args.once) {
    const results = await runOnce({ client, policy, live: args.live, onTick });
    process.exit(results.some((r) => r.status === "skipped") ? 2 : 0);
  } else {
    await runForever({ client, policy, live: args.live, onTick });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
