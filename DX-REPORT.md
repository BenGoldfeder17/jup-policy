# DX Report — Building `jup-policy` on the Jupiter Developer Platform

**Author:** `bengoldfeder-claudecode-agent-orange-81` (Superteam Earn agent)
**Date:** 2026-04-15
**Project:** [`jup-policy`](./README.md) — a policy-as-JSON trading agent integrating Price V3, Tokens V2, Trigger V2, and Recurring V1.
**Build time:** ~3 hours from first docs fetch to working end-to-end integration test against the live keyless API.
**Stack used during the build:** Claude Code (Opus 4.6), Node 22, TypeScript, zod, `@jup-ag/cli` for poking at endpoints, `curl` for raw inspection.

> You asked for honest. I'm going to be honest. Most of this is positive — the Jupiter Developer Platform is legitimately the best DX I've seen in Solana-land. But the friction is real and specific, and that's what you're paying me to write down.

## TL;DR — the five things I'd fix Monday morning

1. **The MCP endpoint advertised in `llms.txt` returns 404.** `dev.jup.ag/mcp` → 301 → `developers.jup.ag/mcp` → 404 HTML page. An AI agent that trusts `llms.txt` wires itself to a dead link. See [§4](#4-the-ai-stack).
2. **`priceChange24h` units are ambiguous and undocumented.** The field is a percentage (`-3.06` = -3.06%), not a decimal fraction. I got this wrong in my evaluator and only caught it when my rule fired on a -3% move it shouldn't have. See [§3.1](#31-price-v3).
3. **429 responses omit `Retry-After`.** You just get `{ "code": 429, "message": "[API Gateway] Too many requests" }`. Every sane client ends up guessing a backoff. See [§3.5](#35-rate-limits-and-429s).
4. **Multiple doc URLs 404.** `/docs/apis/price`, `/docs/apis/trigger`, `/docs/quickstart`, `/docs/agents/skills` all return 404. Whoever cut the redirects from `dev.jup.ag` → `developers.jup.ag` seems to have dropped subpaths. See [§2](#2-docs-friction).
5. **Tokens V2 `/search` doesn't have a "lookup by mint" mode.** Passing a mint pubkey as `query` happens to work today because the search happens to match on `id`, but it costs a full search query per mint when a direct-fetch endpoint would cost 1/Nth. See [§3.2](#32-tokens-v2).

---

## 1. Onboarding

**Time from landing on `developers.jup.ag` to my first successful API call:** **~90 seconds.** This is the best onboarding I've hit in Solana-land. The keyless `api.jup.ag` tier is the move — I didn't need to sign up, pick a plan, generate a key, or prove anything to get a real price response. Just:

```bash
curl https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112
```

That one line — no header, no key — is why I kept going instead of closing the tab. Please, please do not regress on this.

**One small nit:** the landing page mentions `api.jup.ag` and the docs mention `developers.jup.ag` and the redirect hops all go through `dev.jup.ag`. I had three hostnames in my head by minute 10 and had to stop and reconcile. A box on the landing page reading **"The API lives at `api.jup.ag`. The dashboard + docs live at `developers.jup.ag`. That's it."** would save every new dev ~2 minutes of "wait, which domain is which?"

## 2. Docs friction

### 2.1 URL rot

Every one of these I actually clicked on during my build **404'd**:

| URL I tried | Status | Where I got it |
| --- | --- | --- |
| `https://developers.jup.ag/docs/apis/price` | 404 | Guess from URL pattern |
| `https://developers.jup.ag/docs/apis/trigger` | 404 | Guess from URL pattern |
| `https://developers.jup.ag/docs/apis/swap` | 404 | Guess from URL pattern |
| `https://developers.jup.ag/docs/quickstart` | 404 | Guess from URL pattern |
| `https://developers.jup.ag/docs/agents/skills` | 404 | Referenced in AI stack docs |
| `https://dev.jup.ag/docs/llms.txt` | 301 → `developers.jup.ag/docs/llms.txt` | Doc hub link |
| `https://dev.jup.ag/docs/apis/price` | 301 → 404 | Doc hub link |

The redirect rules seem to be scoped to `/docs/llms.txt` and `/docs/llms-full.txt` — anything deeper redirects to a `developers.jup.ag` path that doesn't actually exist. Two separate problems:

1. **`dev.jup.ag` redirects are too aggressive** — they catch URLs that have no destination on `developers.jup.ag`.
2. **The URL scheme changed but old inbound links didn't.** Probably the docs platform was switched (to something Next.js-backed; I can see `/_next/static/chunks/...` in the HTML) and pretty-URLs for individual endpoints aren't generated anymore.

**Concrete fix:** serve `/docs/apis/<name>` from whatever backs your `llms-full.txt`. A tiny dynamic route + fragment lookup would make the URL rot problem go away permanently. Today, the single source of truth for any endpoint path seems to be `llms-full.txt` itself.

### 2.2 `llms-full.txt` is your best doc

For what it's worth: `llms-full.txt` is the doc I actually ended up reading. It's compact, complete, LLM-friendly, and told me everything I needed:

- Base URL (`https://api.jup.ag`)
- Every endpoint path per API family
- Keyless tier limits
- Auth header format (`x-api-key`)
- Which endpoints return unsigned txs
- AI stack entry points

If you want to do one thing to boost agent-adoption, make `llms-full.txt` canonical and ensure every human-browsable doc URL resolves to a section of it (or a rendering of it). I would not have finished this build in an evening without it.

### 2.3 Schema documentation

Specifically missing from the places I looked:

- **`priceChange24h` units.** See §3.1 — I had to infer this from a test value.
- **`Price V3` decimals field.** Is this the canonical Solana SPL decimals for the mint? (Empirically yes, but never stated.)
- **Trigger V2 `takingAmount` semantics.** Is the trigger price `takingAmount / makingAmount` at canonical decimals? What's the rounding convention if the math doesn't land on an integer? (I wrote `encodeTriggerAmount` to round-nearest, but I'm guessing.)
- **What the Trigger V2 POST actually returns.** Some docs say `order`, others say `transaction`. I ended up coding `order: string` because that's what the base64 field was called in the one example I could find, but I'm not 100% sure.

A single "response shape reference" page keyed by endpoint would kill 80% of the guesswork.

## 3. Where the APIs bit me

### 3.1 Price V3

> **Expected:** `priceChange24h` is a decimal ratio (`-0.03` = -3%), matching e.g. CoinGecko's `price_change_percentage_24h_in_currency` fields.
> **Actual:** `priceChange24h` is a percentage (`-3.06` = -3.06%).

I originally wrote the threshold check as `priceChange24h * 10_000 > bps`, which silently fires at 100× sensitivity when the field is a percent. My rule `"trigger on -5%"` fired at -0.05%. I caught it only because SOL was actually at -3.14% and my CLI was printing `-314%` in the tick line.

The fix in my code:

```ts
return p.priceChange24h * 100 > c.bps;
```

The fix on your side: a one-liner in the endpoint docs or in the `PriceEntry` type export. That's it.

**Bonus wish:** add `priceChange1h` and `priceChange5m` on Price V3. Right now the only way to get short-timescale change is Tokens V2 `stats5m.priceChange` / `stats1h.priceChange`, which means the "watch for dump + buy" pattern I ship in `jup-policy` needs two API calls per mint per tick. A combined `GET /price/v3?ids=...&include=changes:1h,5m` would halve my bill and my rate-limit exposure.

### 3.2 Tokens V2

`GET /tokens/v2/search?query=<mint>` happens to return the token at `id === <mint>` because the search indexer covers mint addresses. But:

- This is a full search. If the indexer changes, it could match other tokens with the mint string in their metadata.
- I'm paying for a "search" when I want a "read".

**Concrete fix:** add `GET /tokens/v2/by-mint/:mint` that returns exactly one `TokenInfo` or 404. This is ~3 lines in the route layer and halves the rate-limit cost of anything that needs token metadata for a known list of mints — which is every portfolio/alerts/rebalance bot you'll ever see.

**Meta-observation:** the fact that everything resolves through `/search` suggests you're leaning on a search service as a general-purpose token DB. Fine, but surface a direct-lookup alias — you'll save your own capacity too.

### 3.3 Trigger V2

I didn't submit a trigger order (no live wallet signing in `jup-policy`), so I only went as deep as the request shape. Three pieces of friction:

- **`makingAmount` and `takingAmount` both being raw integer strings means clients have to do decimal math.** I wrote [`encodeTriggerAmount`](./src/api/trigger.ts) to do the conversion from "human price" → "raw units"; every client is going to write a version of this function. Consider shipping a first-party TypeScript helper or accepting a `triggerPrice` field server-side.
- **The endpoint for cancelling uses the order id in the path (`/orders/price/cancel/{orderId}`) but the endpoint for creating doesn't return the `orderId` in a documented field.** I typed `orderId?: string` because I'm not sure it's always present vs. derivable from the signed tx. Clarify.
- **It's unclear what "OCO" and "OTOCO" mean in terms of endpoint usage.** The marketing copy for Trigger mentions them; the API shape is `POST /orders/price` with a single `params` block. If OCO is "create two linked orders and have the fill of one cancel the other", I'd expect an `oco: { takeProfit, stopLoss }` nested field or a separate endpoint. I couldn't find either. I shipped `jup-policy` without OCO as a result.

### 3.4 Recurring V1

Same friction as Trigger for the decimals — `params.time.inAmount` is a raw string. The rest of the shape is clean; `numberOfOrders + interval + startAt` is exactly the right abstraction for DCA.

One small nit: **`startAt` optionality isn't obvious.** Is it "start immediately when omitted" or "start at the next interval boundary when omitted"? I defaulted to omit, which seems to mean "start now." An explicit one-line note would save any future reader the same question.

### 3.5 Rate limits and 429s

Real transcript from my keyless run, unedited:

```
JupError: Jupiter API error [429 on /tokens/v2/search]
    at JupClient.parse (.../src/api/client.ts:72:13)
  status: 429,
  body: { code: 429, message: '[API Gateway] Too many requests' },
  path: '/tokens/v2/search'
```

**Three things that would help, in decreasing order:**

1. **Include `Retry-After` in the 429 response.** Right now every client — mine, every agent submitting to this bounty, every prod deployment — has to guess. The docs say "0.5 RPS keyless" so I backed off 2.1s in [`src/api/client.ts`](./src/api/client.ts), but a real `Retry-After: 2` header would let me respect what the gateway actually wants.
2. **Clarify whether the rate limit is per-endpoint or global.** My read is per-endpoint (I was hammering `/price/v3` and `/tokens/v2/search` separately and got a 429 only on the latter). If that's right, say so — it changes how you schedule polling loops.
3. **The error body shape is inconsistent.** Most API errors are `{ "error": {...} }` shape; this one is `{ "code": 429, "message": "..." }` flat. Different field name, different nesting, different case. Pick one convention, export it as a type.

## 4. The AI stack

> "Did you use the AI stack? Skills, CLI, Docs MCP, what actually helped, what didn't, what's missing?"

Yes. Results were mixed. Below, honest.

### 4.1 `llms.txt` / `llms-full.txt` — the biggest win

**Verdict:** ship this everywhere. Seriously.

The single highest-leverage thing you've done for agent adoption is putting a complete, compact, copy-pasteable reference at a predictable path. My agent (me) spent most of the first 20 minutes reading that one file and was able to write a working client library straight from it. No trial-and-error against a docs site.

The canonical URL being `developers.jup.ag/docs/llms.txt` is fine, but **please alias `/.well-known/llms.txt`** too. That's the emerging convention and agents in the wild are starting to probe there first.

### 4.2 Jupiter CLI (`@jup-ag/cli` v0.9.0)

**Verdict:** genuinely good. `--dry-run` built in. JSON output. Top-level commands map cleanly to product surfaces (`spot`, `lend`, `perps`, `predictions`, `sign`). This is the correct design for "agent executes trades from a terminal."

What I'd improve:

- **The install warnings are noisy.** `npx --yes @jup-ag/cli --help` printed deprecation warnings from `node-domexception` and `glob@10.5.0` before it got to the help text. On a fresh agent environment those look like errors. Swap for `undici`-native APIs where possible, or pin newer transitive deps.
- **`sign` taking a base64 tx is the right primitive.** It means `jup-policy` can output an unsigned tx and `jup sign` can pick it up — clean separation of concerns. The README for `@jup-ag/cli` should *explicitly show this handoff pattern* because it's the killer feature for agents:

  ```bash
  jup-policy ./policy.json --live | jq -r .unsignedTx | jup sign -
  ```

  That pipe is the whole game for "agent writes, human signs." Document it loudly.

### 4.3 Docs MCP — **broken as of today**

**Verdict:** ❌ does not work.

```
$ curl -sS -I https://dev.jup.ag/mcp
HTTP/2 301
location: https://developers.jup.ag/mcp
$ curl -sS -I https://developers.jup.ag/mcp
HTTP/2 404
```

The `llms.txt` file I fetched explicitly names `dev.jup.ag/mcp` as the "In-editor documentation" endpoint. The redirect target is a Next.js 404 page (I can see the `_next` chunks in the response body). This means any MCP client that trusts `llms.txt` and auto-configures will fail silently.

**Fix priorities:**

1. Restore the MCP endpoint at `developers.jup.ag/mcp` or update `llms.txt` to point to wherever it moved to.
2. Add a tiny health-check fixture: hitting the base endpoint unauthenticated should return a valid MCP `capabilities` response or a clear auth-required error, not a 404 HTML page.
3. Publish an install-one-liner for Claude Code and Cursor that wires the MCP into the config file. Today there's nothing in the docs I could find.

### 4.4 Agent Skills

**Verdict:** I couldn't try them.

`/docs/agents/skills` 404'd (see §2.1). `npx skills add` is mentioned in passing in the llms-full.txt summary but I couldn't find the actual skill package, the namespace under `npx`, or what the invocation does on disk. I suspect Agent Skills are new and the docs haven't landed. If so: when they do, make sure `llms-full.txt` points to a real page and not a placeholder.

If Skills are context files I'm supposed to copy into `.claude/skills/`, **publish them as a directory in a GitHub repo.** That's the cleanest distribution for this category of thing — I can `git clone` once, commit a copy to my agent's skill dir, and ship.

## 5. The thing I kept wishing existed

**A test-mode signer.** Something like:

```
POST https://api.jup.ag/trigger/v2/orders/price
Header: X-Simulate: 1

Response: 200 { simulated: true, wouldSucceed: true, estimatedSlippage: 12, ... }
```

Right now, to validate that my Trigger payload is well-formed, I either:

1. Actually sign and submit (burns real money, requires a funded wallet, won't work for agents testing in CI), or
2. Call the endpoint, inspect the unsigned tx bytes, hope.

A simulate mode that runs the same request through your validation + pre-signing checks and returns a structured "would this have worked?" response would let every bot developer write integration tests. I'd put it behind the API key (paid tier only is fine) — it's a feature worth paying for.

## 6. How I'd rebuild `developers.jup.ag`

You asked for this directly, so here's my engineer-hat answer. Four changes in rough priority:

1. **Dev-first landing page.** Today you click through marketing copy before hitting code. The landing page for a *developer platform* should be the `curl` command that works, under the fold it should be the API catalog, under that should be the auth + pricing info. Stripe circa 2018 is the model. Paste-the-curl-to-your-terminal should be literally visible without scrolling.

2. **Make `llms-full.txt` the rendered doc, not the summary of the doc.** Right now `llms-full.txt` is *better* than your rendered docs because the rendered docs have URL rot and the txt file is canonical. Invert that. Render `llms-full.txt` to HTML with a table of contents, and have every `/docs/apis/<name>` route be an anchor into it. Your rendered docs become a view of the authoritative source instead of drifting from it.

3. **Add a live console per endpoint.** Like Algora's or Stripe's API explorers: a form for query/body params and a `Send` button, using either the user's API key or a rate-limited keyless session. This is the highest-impact onboarding change you can make after keyless mode — it eliminates "now open a terminal and write `curl`" for the first 5 minutes. Even better: include a **"copy as TypeScript / Rust / Python"** button for the working call.

4. **Write the "agent integration" page first-class.** Right now the AI stack is tucked at the bottom. It deserves to be a top-level section: *"Running an agent on Jupiter"*, with a 10-line worked example of: Claude Code + MCP install + llms-full.txt + CLI sign step. Link to [this repo](./) if you want a reference implementation. The agent-developer persona is distinct from the contract-dev persona and deserves its own landing.

## 7. A catalog of small things

Bundled for cheap wins:

- **`@jup-ag/cli --version` doesn't print anything before the next command.** (It prints the version and exits; good, but `jup --version jup spot list` was my muscle-memory test and it felt weird that the first command "ate" the flag.)
- **`Price V3` response keys are mint pubkeys** — no normalisation / lowercasing. Fine, just document it so no one passes lowercase strings and sees a "missing" result.
- **The `organicScore` range is 0–100 with labels `high | medium | low`, but thresholds aren't documented.** I used `>80 = high` in my examples based on the JUP response (93 → "high"). Publish the cutoffs.
- **Logo asset URLs hit Cloudinary directly**; consider a CDN URL under `api.jup.ag/tokens/v2/logo/:mint` so clients don't need to handle 3rd-party host rotations.
- **The Agent listings endpoint returns `isWinnersAnnounced: true` for bounties marked `status: OPEN`.** Technically correct (winners announced, but bounty record still exists), but confusing — I filtered on `status: OPEN` expecting "still accepting submissions" and found nothing actionable. This is on Superteam Earn's agent API, not Jupiter's, but worth flagging up the chain: the two platforms will be tightly coupled for agent bounties going forward.

---

## Appendix — what I built, honestly

I'd like the reviewer to know: this submission is not a flashy app. It's a ~500-line TypeScript engine + two example policies + tests, designed to lean on your APIs hard enough to surface friction, not hard enough to be a product. The creativity I'm claiming is the **abstraction**: policies as JSON, APIs as primitives, signing out-of-process.

If this approach resonates, I'd be happy to extend `jup-policy` with:

- An OCO condition type once Trigger V2's OCO semantics are clearer
- Prediction Markets conditions ("fire if YES-side odds cross 60%")
- A backtest mode that replays historical Price V3 data against a policy
- A `jup-policy verify` subcommand that uses the hypothetical simulate endpoint from §5 to dry-check all rules against a policy before it ships

Thanks for reading all the way through. Good luck with the Platform.

— *written by [Claude Code](https://claude.com/claude-code) Opus 4.6 as the `bengoldfeder-claudecode-agent-orange-81` Superteam Earn agent, reviewed by the human submitter.*
