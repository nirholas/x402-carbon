# For AI agents — x402-carbon

`x402-carbon` turns "when should this run?" into a single paid HTTP call that
answers with a start time, not a dataset. No account, no API key, no ESG
platform — an agent pays $0.002 in USDC and gets a scheduling decision with the
evidence attached.

## 1. Discover

Two machine-readable descriptions, both free to fetch:

| Where | What it is |
|-------|-----------|
| `GET /.well-known/x402` | The x402 discovery manifest: every resource, its price, its output schema, and both accepted payment rails. |
| [`skill.md`](https://github.com/nirholas/x402-carbon/blob/main/skill.md) | The agent-facing skill file: prose an LLM can read directly to learn the endpoints, parameters, and payment flow. |
| [`openapi.json`](https://github.com/nirholas/x402-carbon/blob/main/openapi.json) | OpenAPI 3.1, including the 402 `PaymentRequirements` schema. |

```bash
curl -s http://localhost:4025/.well-known/x402 | jq '.resources[] | {resource, price, networks}'
```

```json
{
  "resource": "GET /now",
  "price": "$0.001",
  "networks": ["base-sepolia", "solana"]
}
```

## 2. Pay — on either rail

**Pay in USDC on Base or Solana; your client picks the rail.** An unpaid request
returns 402 with an `accepts` array containing one entry per rail:

```jsonc
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",          // "base" on mainnet
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",   // USDC
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxAmountRequired": "1000",             // 6 decimals
      "extra": { "name": "USDC", "version": "2" }   // EIP-712 domain
    },
    {
      "scheme": "exact",
      "network": "solana",                 // "solana-devnet" on devnet
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  // USDC mint
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxAmountRequired": "1000",
      "extra": { "feePayer": "<facilitator sponsor>" }  // pays the SOL fee
    }
  ]
}
```

**EVM path.** Sign an EIP-3009 `transferWithAuthorization`. Entirely
client-side; no gas from the payer. `x402-fetch` does it in two lines:

```ts
import { createSigner, wrapFetchWithPayment } from "x402-fetch";
const payFetch = wrapFetchWithPayment(fetch, await createSigner("base-sepolia", KEY));
const artifact = await (await payFetch("${BASE}/now?postcode=SW1A")).json();
```

**Solana path.** Build an SPL `transferChecked` to `payTo` for
`maxAmountRequired`, using `extra.feePayer` as the transaction fee payer, and
sign it. The buyer needs USDC only — the facilitator sponsors the SOL fee.
Base64-encode `{ x402Version: 1, scheme: "exact", network, payload: { transaction } }`
into `X-PAYMENT`.

Either way the server verifies and settles through the facilitator at
`https://x402.org/facilitator` and returns the artifact.

## 3. Read the receipt

Successful responses carry `X-PAYMENT-RESPONSE` — base64 JSON:

```json
{ "success": true, "rail": "solana", "network": "solana",
  "transaction": "<signature>", "payer": "<buyer>",
  "amount": "1000", "asset": "USDC" }
```

Log it: it is your proof of spend, on whichever chain you used.

## 4. What you get back

- `GET /now` (**$0.001**) — Current gCO2/kWh with its index band, the full generation mix, low-carbon / renewable / fossil shares, and the wind and solar conditions behind them
- `POST /best-window` (**$0.002**) — The best start time with mean intensity and the saving against running now, three non-overlapping runners-up, the worst window for contrast, and the full half-hourly forecast curve

Nothing is deferred. The artifact is in the body of the 200 you paid for.

## 5. MCP integration

[`examples/mcp-tool.md`](https://github.com/nirholas/x402-carbon/blob/main/examples/mcp-tool.md)
has a complete MCP server that exposes these routes as Claude tools, including a
spend cap so a runaway loop cannot drain the wallet.

## 6. Listing an instance

Deployed your own? Make it discoverable:

- **[x402scan.com](https://x402scan.com)** — crawls `/.well-known/x402`. Submit
  your base URL; keep the manifest at that exact path.
- **x402 Bazaar** — the facilitator's resource directory. Resources are listed
  from the `discoverable` flag in the 402 `outputSchema.input` (set by default
  here).
- **[agentic.market](https://agentic.market)** — agent-facing service catalog;
  submit the base URL plus a link to `skill.md`.

Keep `/.well-known/x402`, `skill.md`, and `openapi.json` consistent when you
change prices — indexers read all three.

## Questions

nichxbt@gmail.com · <https://github.com/nirholas/x402-carbon>
