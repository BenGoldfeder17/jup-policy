import type { JupClient } from "./client.ts";

export interface PriceEntry {
  usdPrice: number;
  decimals: number;
  liquidity: number;
  // Percentage, NOT decimal fraction. SOL down 3.06% → priceChange24h = -3.06.
  // (Confirmed empirically; not explicit in the API docs as of April 2026.)
  priceChange24h: number;
  blockId: number;
  createdAt: string;
}

export type PriceMap = Record<string, PriceEntry>;

// GET /price/v3?ids=mint1,mint2  (max 50 per request)
// Keyless returns same shape; empty response for unknown mints.
export async function getPrices(client: JupClient, mints: string[]): Promise<PriceMap> {
  if (mints.length === 0) return {};
  if (mints.length > 50) {
    throw new Error(`Price API caps at 50 mints per call, got ${mints.length}`);
  }
  return client.get<PriceMap>("/price/v3", { ids: mints.join(",") });
}
