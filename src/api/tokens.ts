import type { JupClient } from "./client.ts";

export interface TokenInfo {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  usdPrice: number;
  liquidity: number;
  holderCount?: number;
  mcap?: number;
  fdv?: number;
  organicScore?: number;
  organicScoreLabel?: "high" | "medium" | "low";
  isVerified?: boolean;
  tags?: string[];
  stats1h?: {
    priceChange: number;
    buyVolume: number;
    sellVolume: number;
    numTraders: number;
  };
  stats24h?: {
    priceChange: number;
    buyVolume: number;
    sellVolume: number;
    numTraders: number;
  };
}

// GET /tokens/v2/search?query=...&limit=N
export async function searchTokens(
  client: JupClient,
  query: string,
  limit = 5,
): Promise<TokenInfo[]> {
  return client.get<TokenInfo[]>("/tokens/v2/search", { query, limit });
}

// Small helper — pick the top verified match with non-negligible liquidity.
export function pickBest(results: TokenInfo[], minLiquidity = 10_000): TokenInfo | null {
  const verified = results.filter((t) => t.isVerified && t.liquidity >= minLiquidity);
  return verified[0] ?? null;
}
