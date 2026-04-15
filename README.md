# jup-policy

Policy-as-JSON trading agent for the [Jupiter Developer Platform](https://developers.jup.ag/).

You write a policy in JSON. The engine polls **Price V3** + **Tokens V2**, evaluates your rules, and emits actions against **Trigger V2** and **Recurring V1** (DCA). By default it runs in dry-run mode and never signs or submits a transaction — it returns the unsigned tx payload and stops.

Built as a submission to Jupiter's [Not Your Regular Bounty](https://superteam.fun/earn/listing/not-your-regular-bounty). The goal was to combine APIs in a way the team didn't specifically design for: treating the APIs as **policy primitives** rather than point integrations.

## Why

Most trading bots hardcode a strategy into code. That makes every new rule a code change, every backtest a git branch, every portfolio split a separate fork.

`jup-policy` inverts that. A strategy is a JSON file. The engine is generic:

- **Price V3** gives you `priceChange24h` per mint — condition primitives.
- **Tokens V2** gives you `organicScore`, `holderCount`, `isVerified`, `stats24h` — health primitives.
- **Trigger V2** takes a price+amount and hands back an unsigned tx — action primitive.
- **Recurring V1** takes interval+count+amount and hands back an unsigned tx — action primitive.

Compose those into `when` + `then` rules. Ship the JSON. Done.

## Install

```bash
git clone <your-fork>
cd jup-policy
npm install
```

Node 22+ is required (the CLI uses `--experimental-strip-types`).

## Usage

```bash
# Dry-run, one tick, exits when done:
npm start examples/volatility-dca.json -- --once

# Continuous polling (Ctrl-C to stop):
npm start examples/volatility-dca.json

# Live mode — hits Trigger/Recurring create endpoints, returns unsigned txs.
# (You sign + submit them yourself. jup-policy never holds your keys.)
JUP_API_KEY=sk_... npm start examples/volatility-dca.json -- --live
```

Set `JUP_API_KEY` for the paid tier. Without it, the engine uses the keyless 0.5 RPS tier — fine for prototyping, not for tight polling on many mints.

## Policy schema

```jsonc
{
  "name": "Volatility-triggered DCA into SOL",
  "pollSeconds": 30,
  "watchMints": ["So11111111111111111111111111111111111111112"],
  "rules": [
    {
      "id": "sol-dump-buy",
      "when": {
        "all": [
          { "type": "priceChange24hBelow", "mint": "So1...112", "bps": -500 }
        ]
      },
      "then": [
        { "type": "notify", "message": "SOL down >5% — firing DCA" },
        {
          "type": "adjustRecurring",
          "inputMint": "EPj...Dt1v",
          "outputMint": "So1...112",
          "inAmountPerInterval": "10000000",
          "numberOfOrders": 6,
          "intervalSeconds": 3600
        }
      ],
      "cooldownSeconds": 86400
    }
  ]
}
```

### Conditions

| Type                    | Source        | Fires when                                    |
| ----------------------- | ------------- | --------------------------------------------- |
| `priceChange24hAbove`   | Price V3      | `priceChange24h * 10_000 > bps`               |
| `priceChange24hBelow`   | Price V3      | `priceChange24h * 10_000 < bps`               |
| `organicScoreAbove`     | Tokens V2     | Jupiter's organic score exceeds threshold     |
| `holderCountAbove`      | Tokens V2     | Holder count exceeds threshold                |

Rules use `when.all` (AND) and/or `when.any` (OR). Combine them for e.g. "*price crashed AND organic score is still high* → buy the dip."

### Actions

| Type                 | Calls                                  |
| -------------------- | -------------------------------------- |
| `notify`             | Logs to stdout                         |
| `adjustRecurring`    | `POST /recurring/v1/createOrder`       |
| `createTriggerOrder` | `POST /trigger/v2/orders/price`        |

Each action returns an **unsigned base64 tx** in live mode. You're responsible for signing and submitting. This is by design — a policy engine should never hold your keys.

### Cooldowns

Every rule has a `cooldownSeconds`. The in-memory `CooldownTracker` prevents the same rule from firing twice within that window even if conditions still match. Without this, a sustained price move would spam order creation every poll.

## Project layout

```
src/
  api/
    client.ts       # HTTP client, keyless-aware, x-api-key header
    price.ts        # GET /price/v3
    tokens.ts       # GET /tokens/v2/search
    trigger.ts      # POST /trigger/v2/orders/price (+ encodeTriggerAmount helper)
    recurring.ts    # POST /recurring/v1/createOrder
  policy/
    schema.ts       # zod schema for policies — the contract
    evaluator.ts    # rule evaluation + cooldown tracking
  engine/
    actions.ts      # dispatch actions (dry-run vs live)
    loop.ts         # snapshot → eval → execute tick
bin/
  jup-policy.ts     # CLI entry
tests/
  policy.test.ts    # unit — condition + cooldown + amount encoding
  live-api.test.ts  # integration — hits the real Jupiter API keyless
examples/
  volatility-dca.json
  organic-score-rebalance.json
```

## Tests

```bash
npm test           # unit tests (no network)
npm run test:live  # hits live Jupiter API via the keyless tier
npm run typecheck  # tsc --noEmit, strict + exact optional properties
```

## Honest notes

See [`DX-REPORT.md`](./DX-REPORT.md) for the full developer-experience report — onboarding time, docs friction, AI-stack feedback, and a concrete list of things I'd change on `developers.jup.ag`.

## License

MIT
