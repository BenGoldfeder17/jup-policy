import type { JupClient } from "./client.ts";

// The Trigger V2 /orders/price endpoint returns an unsigned transaction the
// caller is expected to sign and submit. jup-policy stops at the "unsigned
// tx returned" step — signing/submission is out of scope for this agent.
export interface CreatePriceTriggerOrderRequest {
  inputMint: string;
  outputMint: string;
  maker: string; // wallet pubkey
  payer: string; // wallet pubkey, usually same as maker
  params: {
    makingAmount: string; // smallest units of inputMint
    takingAmount: string; // smallest units of outputMint — trigger price encoded here
    expiredAt?: string; // unix seconds
    slippageBps?: number;
  };
}

export interface CreatePriceTriggerOrderResponse {
  order: string; // the unsigned, base64-encoded tx
  orderId?: string;
  requestId: string;
}

export async function createPriceOrder(
  client: JupClient,
  req: CreatePriceTriggerOrderRequest,
): Promise<CreatePriceTriggerOrderResponse> {
  return client.post<CreatePriceTriggerOrderResponse>("/trigger/v2/orders/price", req);
}

export interface CancelPriceTriggerOrderRequest {
  maker: string;
}

export async function cancelPriceOrder(
  client: JupClient,
  orderId: string,
  req: CancelPriceTriggerOrderRequest,
): Promise<unknown> {
  return client.post<unknown>(`/trigger/v2/orders/price/cancel/${orderId}`, req);
}

export async function getOrderHistory(
  client: JupClient,
  maker: string,
): Promise<unknown> {
  return client.get<unknown>("/trigger/v2/orders/history", { maker });
}

// Compute the `takingAmount` for a price-trigger order given a human-readable
// trigger price and decimals. Returns a string of raw units.
// Example: triggerPrice 95 USDC per SOL, making 1 SOL → takingAmount = 95e6
export function encodeTriggerAmount(
  triggerPriceUsd: number,
  makingAmountRawUnits: bigint,
  inputDecimals: number,
  outputDecimals: number,
): string {
  const makingFloat = Number(makingAmountRawUnits) / 10 ** inputDecimals;
  const takingFloat = makingFloat * triggerPriceUsd;
  const takingRaw = BigInt(Math.round(takingFloat * 10 ** outputDecimals));
  return takingRaw.toString();
}
