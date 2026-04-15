import { test } from "node:test";
import assert from "node:assert/strict";
import { JupClient } from "../src/api/client.ts";
import { getPrices } from "../src/api/price.ts";
import { searchTokens, pickBest } from "../src/api/tokens.ts";

// These tests hit the live Jupiter API against the keyless tier.
// Run with: npm run test:live
// They'll be slow-ish and will fail if Jupiter is down or you're offline.

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test("Price V3 returns USD prices for SOL + USDC", async () => {
  const client = new JupClient();
  const prices = await getPrices(client, [SOL, USDC]);
  assert.ok(prices[SOL], "SOL price missing");
  assert.ok(prices[USDC], "USDC price missing");
  assert.ok(prices[SOL]!.usdPrice > 1, "SOL should be > $1");
  assert.ok(Math.abs(prices[USDC]!.usdPrice - 1) < 0.05, "USDC should be ~$1");
});

test("Tokens V2 search returns at least one verified JUP result", async () => {
  const client = new JupClient();
  const results = await searchTokens(client, "JUP", 5);
  assert.ok(results.length > 0);
  const best = pickBest(results, 1_000_000);
  assert.ok(best);
  assert.ok(best.isVerified);
});
