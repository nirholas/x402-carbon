# Tutorial — x402-carbon

From a clean checkout to a paid API call, on either payment rail.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-carbon
cd x402-carbon
npm install
```

Node 18 or newer.

## 2. Configure (optional)

```bash
cp .env.example .env
```

Nothing is required. Out of the box the server:

- listens on port `4025`,
- accepts USDC on **Base Sepolia** and on **Solana**, paying out to the suite's
  public receive addresses,
- queries the UK Carbon Intensity API and Open-Meteo live — no keys needed, nothing to configure.

To be paid yourself, change these two lines:

```bash
PAY_TO_ADDRESS=0xYourEvmAddress
SOLANA_PAY_TO_ADDRESS=YourSolanaAddress
```

Nothing here requires a key, and there is nothing to configure. Both upstreams
are open and free.

The one thing worth knowing is the coverage boundary: the carbon data is
**Great Britain only**, because it comes from National Grid ESO. Pass a UK
postcode outward code (`SW1A`, `M1`, `EH1`, `RG10`) for regional figures, or
omit it for the national grid. Every response repeats this in its `coverage`
field so an agent never has to assume.

## 3. Run the server

```bash
npm run dev
```

```
x402-carbon v0.1.0 listening on :4025
  payment rails:
    EVM     base-sepolia  USDC → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402
    Solana  solana         USDC → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW
  facilitator: https://x402.org/facilitator
  paid routes:
    GET /now                     $0.001
    POST /best-window            $0.002
  free routes: GET /, GET /health, GET /.well-known/x402
```

Check it is alive:

```bash
curl -s http://localhost:4025/health
# {"status":"ok","uptime":1.2}
```

## 4. Your first 402

```bash
curl -s "http://localhost:4025/now?postcode=SW1A" | jq
```

You get HTTP **402** and a challenge listing **both** rails:

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "1000",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "1000",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }
  ]
}
```

That is the whole price negotiation: no key, no signup, no account. The price
is `1000` USDC base units (6 decimals) = **$0.001**.

## 5. Pay for real

Get a Base Sepolia test wallet and fund it with test USDC from
<https://faucet.circle.com>. Then:

```bash
PRIVATE_KEY=0xYourTestKey npm run client
```

[`examples/agent-client.ts`](../examples/agent-client.ts) does the full flow:

1. Calls the route unpaid and prints both rails from the 402.
2. Signs an EIP-3009 USDC authorization for exactly $0.001.
3. Retries with the `X-PAYMENT` header.
4. Prints the artifact and decodes the `X-PAYMENT-RESPONSE` receipt.

Prefer Solana? The bottom of that file shows the equivalent flow — the server
needs no changes, since the same 402 already advertises the `solana` rail.

## 6. Read the artifact

The 200 body **is** the purchase:

```json
{
  "source": {
    "carbon": "uk-carbon-intensity",
    "weather": "open-meteo"
  },
  "coverage": "Great Britain (National Grid ESO). Regional detail by postcode outward code.",
  "scope": "regional",
  "region": {
    "id": 13,
    "name": "London",
    "dno": "UKPN London",
    "postcode": "SW1A"
  },
  "period": {
    "from": "2026-08-07T02:30Z",
    "to": "2026-08-07T03:00Z",
    "forecast": 185,
    "actual": null,
    "index": "high"
  },
  "intensity": {
    "gCO2PerKwh": 185,
    "basis": "forecast",
    "index": "high",
    "indexScale": [
      "very low",
      "low",
      "moderate",
      "high",
      "very high"
    ]
  },
  "generationMix": [
    {
      "fuel": "biomass",
      "percent": 0
    },
    {
      "fuel": "coal",
      "percent": 0
    },
    {
      "fuel": "imports",
      "percent": 42.7
    },
    {
      "fuel": "gas",
      "percent": 41.3
    },
    {
      "fuel": "nuclear",
      "percent": 0
    },
    {
      "fuel": "other",
      "percent": 0
    },
    {
      "fuel": "hydro",
      "percent": 0
    },
    {
      "fuel": "solar",
      "percent": 0
    },
    {
      "fuel": "wind",
      "percent": 16
    }
  ],
  "lowCarbonPercent": 16,
  "renewablePercent": 16,
  "fossilPercent": 41.3,
  "weather": {
    "latitude": 51.51,
    "longitude": -0.13,
    "status": "ok",
    "hourly": [
      {
        "time": "2026-08-07T02:00:00.000Z",
        "windKph": 9.2,
        "solarWm2": 0,
        "cloudCoverPct": 63
      },
      {
        "time": "2026-08-07T03:00:00.000Z",
        "windKph": 8.8,
        "solarWm2": 0,
        "cloudCoverPct": 58
      }
    ]
  },
  "retrievedAt": "2026-08-07T03:11:04.882Z"
}
```

For `/now`, `intensity.basis` matters: `actual` means the settled metered figure,
`forecast` means the grid operator's estimate. Regional data is always
`forecast` — ESO does not settle metered intensity per region. `lowCarbonPercent`
counts nuclear and biomass alongside wind, solar, and hydro; `renewablePercent`
counts only the last three, so use whichever definition your reporting needs.

For `/best-window`, `recommendation` is the sentence to act on and
`best.start` the timestamp to schedule against. When the grid is already
essentially clean the recommendation says so in absolute terms rather than
quoting a meaningless percentage off a near-zero baseline. `runnersUp` never
overlaps the winner, so each is a genuine fallback, and `forecastCurve` is the
complete half-hourly series the choice was made from — plot it, or re-rank it
yourself.

Full field-by-field reference: [api.md](api.md).

## 7. Going to mainnet

```bash
# EVM: Base mainnet
NETWORK=base
PAY_TO_ADDRESS=0xYourRealAddress

# Solana: mainnet (this is already the default)
SOLANA_NETWORK=mainnet-beta
SOLANA_PAY_TO_ADDRESS=YourRealSolanaAddress
SOLANA_RPC_URL=https://your-dedicated-rpc.example.com

# A facilitator that settles on the networks you accept
FACILITATOR_URL=https://x402.org/facilitator
```

Then run `npm run build && npm start`. Nothing else changes: the same routes,
the same prices, real USDC.

> Use a dedicated Solana RPC in production. The public endpoint is heavily
> rate-limited.

## Where to go next

- [api.md](api.md) — every endpoint, parameter, and error
- [agents.md](agents.md) — discovery, MCP, and listing your instance
- [../skill.md](https://github.com/nirholas/x402-carbon/blob/main/skill.md) — the agent-facing skill file
- [../examples/curl.md](https://github.com/nirholas/x402-carbon/blob/main/examples/curl.md) — the same flow in raw curl
