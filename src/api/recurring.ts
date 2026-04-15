import type { JupClient } from "./client.ts";

// Recurring V1 DCA / time-based orders. Same pattern as Trigger: returns an
// unsigned tx payload; jup-policy stops there.
export interface CreateRecurringOrderRequest {
  inputMint: string;
  outputMint: string;
  user: string; // wallet pubkey
  params: {
    time: {
      inAmount: string; // raw units per interval
      numberOfOrders: number; // total intervals
      interval: number; // seconds between orders
      startAt?: number; // unix seconds
    };
  };
}

export interface CreateRecurringOrderResponse {
  transaction: string; // base64 unsigned tx
  requestId: string;
}

export async function createRecurringOrder(
  client: JupClient,
  req: CreateRecurringOrderRequest,
): Promise<CreateRecurringOrderResponse> {
  return client.post<CreateRecurringOrderResponse>("/recurring/v1/createOrder", req);
}

export interface CancelRecurringOrderRequest {
  user: string;
  order: string; // order pubkey from list/history
}

export async function cancelRecurringOrder(
  client: JupClient,
  req: CancelRecurringOrderRequest,
): Promise<unknown> {
  return client.post<unknown>("/recurring/v1/cancelOrder", req);
}
