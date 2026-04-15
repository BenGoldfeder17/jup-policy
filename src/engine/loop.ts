import { JupClient } from "../api/client.ts";
import { getPrices } from "../api/price.ts";
import { searchTokens, type TokenInfo } from "../api/tokens.ts";
import { CooldownTracker, evalRule, type MarketSnapshot } from "../policy/evaluator.ts";
import type { Policy } from "../policy/schema.ts";
import { executeAction, type ExecutionResult } from "./actions.ts";

export interface EngineOptions {
  client: JupClient;
  policy: Policy;
  live: boolean;
  onTick?: (snap: MarketSnapshot, results: ExecutionResult[]) => void;
}

export async function snapshot(client: JupClient, mints: string[]): Promise<MarketSnapshot> {
  const prices = await getPrices(client, mints);
  const tokens = new Map<string, TokenInfo>();
  // Tokens V2 /search is keyed by query string, not by mint. We look up each
  // watched mint so the policy engine can read organicScore/holderCount/etc.
  // In a larger deployment you'd cache these — they don't change every tick.
  for (const mint of mints) {
    const results = await searchTokens(client, mint, 1);
    const match = results.find((t) => t.id === mint);
    if (match) tokens.set(mint, match);
  }
  return { prices, tokens, takenAtMs: Date.now() };
}

export async function runOnce(opts: EngineOptions, cd?: CooldownTracker): Promise<ExecutionResult[]> {
  const tracker = cd ?? new CooldownTracker();
  const snap = await snapshot(opts.client, opts.policy.watchMints);
  const results: ExecutionResult[] = [];
  for (const rule of opts.policy.rules) {
    if (!tracker.canFire(rule.id, rule.cooldownSeconds)) continue;
    const match = evalRule(rule, snap);
    if (!match) continue;
    tracker.markFired(rule.id);
    for (const action of match.actions) {
      const result = await executeAction(action, {
        client: opts.client,
        prices: snap.prices,
        wallet: opts.policy.wallet,
        live: opts.live,
      });
      results.push(result);
    }
  }
  opts.onTick?.(snap, results);
  return results;
}

export async function runForever(opts: EngineOptions): Promise<void> {
  const cd = new CooldownTracker();
  const intervalMs = opts.policy.pollSeconds * 1000;
  while (true) {
    try {
      await runOnce(opts, cd);
    } catch (err) {
      console.error(`[jup-policy] tick failed:`, err);
    }
    await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
