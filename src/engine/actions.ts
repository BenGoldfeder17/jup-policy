import { JupClient } from "../api/client.ts";
import { createRecurringOrder } from "../api/recurring.ts";
import { createPriceOrder, encodeTriggerAmount } from "../api/trigger.ts";
import type { PriceMap } from "../api/price.ts";
import type { Action } from "../policy/schema.ts";

export interface ExecutionContext {
  client: JupClient;
  prices: PriceMap;
  wallet: string | undefined; // required for --live, optional for --dry-run
  live: boolean;
}

export interface ExecutionResult {
  action: Action;
  status: "executed" | "simulated" | "skipped";
  detail: string;
  unsignedTx?: string | undefined; // base64-encoded unsigned tx when returned
}

export async function executeAction(
  action: Action,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  switch (action.type) {
    case "notify":
      return { action, status: "executed", detail: action.message };

    case "adjustRecurring": {
      if (!ctx.wallet) {
        return {
          action,
          status: "simulated",
          detail: `would create DCA: ${action.inAmountPerInterval} ${short(action.inputMint)} → ${short(action.outputMint)} every ${action.intervalSeconds}s x ${action.numberOfOrders} (no wallet, skipping API call)`,
        };
      }
      if (!ctx.live) {
        return {
          action,
          status: "simulated",
          detail: `would create DCA via /recurring/v1/createOrder for maker ${short(ctx.wallet)} (dry-run)`,
        };
      }
      const res = await createRecurringOrder(ctx.client, {
        inputMint: action.inputMint,
        outputMint: action.outputMint,
        user: ctx.wallet,
        params: {
          time: {
            inAmount: action.inAmountPerInterval,
            numberOfOrders: action.numberOfOrders,
            interval: action.intervalSeconds,
          },
        },
      });
      return {
        action,
        status: "executed",
        detail: `recurring order request ${res.requestId}; sign & submit the returned tx to activate`,
        unsignedTx: res.transaction,
      };
    }

    case "createTriggerOrder": {
      const inputPrice = ctx.prices[action.inputMint];
      const outputPrice = ctx.prices[action.outputMint];
      if (!inputPrice || !outputPrice) {
        return {
          action,
          status: "skipped",
          detail: `missing price for ${!inputPrice ? short(action.inputMint) : short(action.outputMint)}`,
        };
      }
      const takingAmount = encodeTriggerAmount(
        action.triggerPriceUsd,
        BigInt(action.makingAmountRaw),
        inputPrice.decimals,
        outputPrice.decimals,
      );
      if (!ctx.wallet) {
        return {
          action,
          status: "simulated",
          detail: `would create trigger order: making ${action.makingAmountRaw} ${short(action.inputMint)} @ trigger $${action.triggerPriceUsd}/${short(action.outputMint)} → takingAmount=${takingAmount} (no wallet)`,
        };
      }
      if (!ctx.live) {
        return {
          action,
          status: "simulated",
          detail: `would POST /trigger/v2/orders/price maker=${short(ctx.wallet)} taking=${takingAmount} (dry-run)`,
        };
      }
      const res = await createPriceOrder(ctx.client, {
        inputMint: action.inputMint,
        outputMint: action.outputMint,
        maker: ctx.wallet,
        payer: ctx.wallet,
        params: {
          makingAmount: action.makingAmountRaw,
          takingAmount,
          ...(action.slippageBps !== undefined ? { slippageBps: action.slippageBps } : {}),
        },
      });
      return {
        action,
        status: "executed",
        detail: `trigger order request ${res.requestId}; sign & submit the returned tx to activate`,
        unsignedTx: res.order,
      };
    }
  }
}

function short(pubkey: string): string {
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}
