import { z } from "zod";

// Well-known Solana mints. Users can of course reference any mint by pubkey.
// jupUSD is resolved via `GET /tokens/v2/search?query=jupUSD` — it is the
// Jupiter-native USD stablecoin and the payout token for this bounty.
export const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  JUPUSD: "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
  JLUSDC: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", // jupiter lend USDC
} as const;

const MintPubkey = z.string().min(32).max(44);

// A single trigger condition the engine evaluates every tick.
const Condition = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("priceChange24hAbove"),
    mint: MintPubkey,
    bps: z.number().int(), // +500 = +5%
  }),
  z.object({
    type: z.literal("priceChange24hBelow"),
    mint: MintPubkey,
    bps: z.number().int(),
  }),
  z.object({
    type: z.literal("organicScoreAbove"),
    mint: MintPubkey,
    score: z.number().min(0).max(100),
  }),
  z.object({
    type: z.literal("holderCountAbove"),
    mint: MintPubkey,
    count: z.number().int().positive(),
  }),
]);

// Action the engine emits when conditions match.
const Action = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("adjustRecurring"),
    inputMint: MintPubkey,
    outputMint: MintPubkey,
    inAmountPerInterval: z.string(), // raw units
    numberOfOrders: z.number().int().positive(),
    intervalSeconds: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("createTriggerOrder"),
    inputMint: MintPubkey,
    outputMint: MintPubkey,
    makingAmountRaw: z.string(),
    triggerPriceUsd: z.number().positive(),
    slippageBps: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("notify"),
    message: z.string(),
  }),
]);

export const Rule = z.object({
  id: z.string().min(1),
  when: z.object({
    all: z.array(Condition).optional(),
    any: z.array(Condition).optional(),
  }),
  then: z.array(Action).min(1),
  cooldownSeconds: z.number().int().nonnegative().default(3600),
});

export const Policy = z.object({
  name: z.string(),
  wallet: MintPubkey.optional(), // needed for --live actions, not dry-run
  pollSeconds: z.number().int().positive().default(30),
  watchMints: z.array(MintPubkey).min(1),
  rules: z.array(Rule).min(1),
});

export type Policy = z.infer<typeof Policy>;
export type Rule = z.infer<typeof Rule>;
export type Condition = z.infer<typeof Condition>;
export type Action = z.infer<typeof Action>;

export function parsePolicy(input: unknown): Policy {
  return Policy.parse(input);
}
