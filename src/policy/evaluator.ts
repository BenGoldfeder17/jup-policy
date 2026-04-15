import type { PriceMap } from "../api/price.ts";
import type { TokenInfo } from "../api/tokens.ts";
import type { Action, Condition, Rule } from "./schema.ts";

export interface MarketSnapshot {
  prices: PriceMap;
  tokens: Map<string, TokenInfo>;
  takenAtMs: number;
}

export interface RuleMatch {
  ruleId: string;
  actions: Action[];
  matchedConditions: Condition[];
}

function evalCondition(c: Condition, snap: MarketSnapshot): boolean {
  switch (c.type) {
    case "priceChange24hAbove": {
      const p = snap.prices[c.mint];
      if (!p) return false;
      // priceChange24h is expressed as a percent (e.g., -3.06 for -3.06%).
      // 1% = 100 bps, so multiplying by 100 converts to bps.
      return p.priceChange24h * 100 > c.bps;
    }
    case "priceChange24hBelow": {
      const p = snap.prices[c.mint];
      if (!p) return false;
      return p.priceChange24h * 100 < c.bps;
    }
    case "organicScoreAbove": {
      const t = snap.tokens.get(c.mint);
      if (!t || t.organicScore === undefined) return false;
      return t.organicScore > c.score;
    }
    case "holderCountAbove": {
      const t = snap.tokens.get(c.mint);
      if (!t || t.holderCount === undefined) return false;
      return t.holderCount > c.count;
    }
  }
}

export function evalRule(rule: Rule, snap: MarketSnapshot): RuleMatch | null {
  const all = rule.when.all ?? [];
  const any = rule.when.any ?? [];
  const allMatch = all.length === 0 || all.every((c) => evalCondition(c, snap));
  const anyMatch = any.length === 0 || any.some((c) => evalCondition(c, snap));
  if (!(allMatch && anyMatch)) return null;
  const matched = [...all.filter((c) => evalCondition(c, snap)), ...any.filter((c) => evalCondition(c, snap))];
  return { ruleId: rule.id, actions: rule.then, matchedConditions: matched };
}

// Cooldown tracker — prevents a rule from firing repeatedly on every tick.
export class CooldownTracker {
  private readonly lastFiredMs = new Map<string, number>();

  canFire(ruleId: string, cooldownSeconds: number, nowMs = Date.now()): boolean {
    const last = this.lastFiredMs.get(ruleId);
    if (last === undefined) return true;
    return nowMs - last >= cooldownSeconds * 1000;
  }

  markFired(ruleId: string, nowMs = Date.now()): void {
    this.lastFiredMs.set(ruleId, nowMs);
  }
}
