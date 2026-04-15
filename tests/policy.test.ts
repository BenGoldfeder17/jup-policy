import { test } from "node:test";
import assert from "node:assert/strict";
import { CooldownTracker, evalRule, type MarketSnapshot } from "../src/policy/evaluator.ts";
import { parsePolicy } from "../src/policy/schema.ts";
import { encodeTriggerAmount } from "../src/api/trigger.ts";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function fakeSnap(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    prices: {
      [SOL]: {
        usdPrice: 80,
        decimals: 9,
        liquidity: 100_000_000,
        priceChange24h: -8, // -8% (API returns percentages, not decimal fractions)
        blockId: 1,
        createdAt: "2024-01-01T00:00:00Z",
      },
      [USDC]: {
        usdPrice: 1,
        decimals: 6,
        liquidity: 500_000_000,
        priceChange24h: 0,
        blockId: 1,
        createdAt: "2024-01-01T00:00:00Z",
      },
    },
    tokens: new Map(),
    takenAtMs: Date.now(),
    ...overrides,
  };
}

test("parsePolicy accepts the volatility-dca example", async () => {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(
    new URL("../examples/volatility-dca.json", import.meta.url),
    "utf8",
  );
  const policy = parsePolicy(JSON.parse(raw));
  assert.equal(policy.rules.length, 2);
  assert.equal(policy.rules[0]!.id, "sol-dump-buy");
});

test("parsePolicy rejects a policy with no rules", () => {
  assert.throws(() =>
    parsePolicy({
      name: "bad",
      watchMints: [SOL],
      rules: [],
    }),
  );
});

test("priceChange24hBelow fires on a dump", () => {
  const rule = {
    id: "r1",
    when: { all: [{ type: "priceChange24hBelow" as const, mint: SOL, bps: -500 }] },
    then: [{ type: "notify" as const, message: "dump" }],
    cooldownSeconds: 0,
  };
  assert.ok(evalRule(rule, fakeSnap()));
});

test("priceChange24hBelow does NOT fire when price is flat", () => {
  const rule = {
    id: "r1",
    when: { all: [{ type: "priceChange24hBelow" as const, mint: SOL, bps: -500 }] },
    then: [{ type: "notify" as const, message: "dump" }],
    cooldownSeconds: 0,
  };
  const snap = fakeSnap();
  snap.prices[SOL]!.priceChange24h = -0.1; // -0.1%, well above the -5% threshold
  assert.equal(evalRule(rule, snap), null);
});

test("CooldownTracker prevents rapid re-firing", () => {
  const cd = new CooldownTracker();
  const now = 1_000_000;
  assert.equal(cd.canFire("r", 60, now), true);
  cd.markFired("r", now);
  assert.equal(cd.canFire("r", 60, now + 10_000), false);
  assert.equal(cd.canFire("r", 60, now + 61_000), true);
});

test("encodeTriggerAmount: 1 SOL @ $95 → 95_000_000 USDC raw units", () => {
  const takingAmount = encodeTriggerAmount(95, 1_000_000_000n, 9, 6);
  assert.equal(takingAmount, "95000000");
});

test("encodeTriggerAmount: 0.5 SOL @ $200 → 100_000_000 USDC raw units", () => {
  const takingAmount = encodeTriggerAmount(200, 500_000_000n, 9, 6);
  assert.equal(takingAmount, "100000000");
});
