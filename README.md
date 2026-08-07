# x402-carbon

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![x402](https://img.shields.io/badge/payments-x402-0052ff.svg)](https://x402.org)
[![USDC on Base](https://img.shields.io/badge/USDC-Base-0052ff.svg)](https://base.org)
[![USDC on Solana](https://img.shields.io/badge/USDC-Solana-14f195.svg)](https://solana.com)

**Grid carbon intensity now and best-window scheduling — keyless live data for
green agents.** One HTTP call, USDC on Base *or* Solana, and the answer comes
back in the response body: current gCO2/kWh with the generation mix behind it,
or the cleanest window in the next 48 hours to run a deferrable job.

Docs site: **https://nirholas.github.io/x402-carbon/**

## Why x402 for this

Carbon-aware scheduling only works if asking is cheap. An agent deciding whether
to start a training run now or at 3am should be able to check in a single call,
a hundred times a day, without an account, a key, or a procurement conversation
— and stop the moment it no longer needs to. x402 makes that the natural shape:
$0.001 to read the grid, $0.002 for a scheduling decision, in USDC on whichever
chain the agent holds funds on. Both upstreams are free and keyless, so the price
buys the window search, the saving arithmetic, and the weather context, not a
resold feed.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-carbon
cd x402-carbon
npm install
npm run dev            # http://localhost:4025 — no configuration needed
```

See the price with no wallet at all:

```bash
curl -s "http://localhost:4025/now?postcode=SW1A" | jq
# 402 + accepts: [ USDC on Base, USDC on Solana ]
```

Then buy it, from an agent (wallet funded with Base Sepolia USDC —
https://faucet.circle.com):

```bash
PRIVATE_KEY=0xYourTestKey npm run client
```

## API

| Route | Price | What you get back |
|-------|-------|-------------------|
| `GET /now` | **$0.001** | Current gCO2/kWh with its index band, the full generation mix, low-carbon / renewable / fossil shares, and the wind and solar conditions behind them |
| `POST /best-window` | **$0.002** | The best start time with mean intensity and the saving against running now, three non-overlapping runners-up, the worst window for contrast, and the full half-hourly forecast curve |
| `GET /` | free | Service metadata, live prices, active payment rails, coverage note |
| `GET /health` | free | Liveness probe |
| `GET /.well-known/x402` | free | Machine-readable discovery manifest |
| `GET /skill.md` | free | This agent skill card |
| `GET /openapi.json` | free | OpenAPI 3.1 spec |

Full reference: [docs/api.md](docs/api.md) · [openapi.json](openapi.json)

## How x402 works

**Pay in USDC on Base or Solana — your client picks the rail.**

1. **402** — the route, called without payment, replies HTTP 402 with an
   `accepts` array holding **both** rails: exact price
   ($0.001 → `1000` USDC base units), asset, and `payTo`.
2. **Sign** — on Base, the client signs an EIP-3009 USDC authorization (no gas
   from the payer). On Solana, it signs an SPL `transferChecked` whose fee payer
   is the facilitator's sponsor account (so the buyer needs USDC only, no SOL).
3. **Settle** — the server hands the payload to the facilitator
   (`https://x402.org/facilitator`), which verifies and settles on the chosen chain.
4. **200** — the same request returns the artifact in the body, with the
   settlement receipt in the `X-PAYMENT-RESPONSE` header.

| Rail | Network | Asset | payTo |
|------|---------|-------|-------|
| EVM | `base-sepolia` (`base` on mainnet) | USDC | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` |
| Solana | `solana` (`solana-devnet` on devnet) | USDC | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` |

Those are the suite's public receive addresses and the server's defaults. Set
`PAY_TO_ADDRESS` / `SOLANA_PAY_TO_ADDRESS` to be paid yourself.

Walkthroughs: [examples/curl.md](examples/curl.md) ·
[examples/agent-client.ts](examples/agent-client.ts) ·
[docs/tutorial.md](docs/tutorial.md)

## Real backend / API keys

| Env | Effect |
|-----|--------|
| *(nothing)* | Both upstreams are keyless and called live out of the box. `npm install && npm run dev` returns the real GB grid position. |

All variables: [.env.example](.env.example)

## For AI agents

- **[skill.md](skill.md)** — agent-facing skill file: endpoints, prices,
  schemas, both payment rails. Point your agent at it.
- **`GET /.well-known/x402`** — discovery manifest listing every resource with
  both networks. Indexable by [x402scan.com](https://x402scan.com), the x402
  Bazaar, and [agentic.market](https://agentic.market).
- **MCP** — [examples/mcp-tool.md](examples/mcp-tool.md) exposes these routes as
  Claude MCP tools, with per-wallet spend caps and a
  `claude_desktop_config.json` example.
- More: [docs/agents.md](docs/agents.md)

## Docs

- Landing: https://nirholas.github.io/x402-carbon/
- [Tutorial](docs/tutorial.md) · [API reference](docs/api.md) · [For AI agents](docs/agents.md)

## Support

Questions, bugs, or a listing request: **nichxbt@gmail.com** ·
[open an issue](https://github.com/nirholas/x402-carbon/issues)

## License

Apache-2.0. Part of the [x402 Suite](https://github.com/nirholas/x402-suite).
