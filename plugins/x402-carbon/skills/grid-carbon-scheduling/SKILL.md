---
name: grid-carbon-scheduling
description: Get current Great Britain grid carbon intensity and the lowest-carbon window for a job in the next 48 hours through a self-hosted x402-carbon server. Use when an agent schedules compute or energy use to cut emissions.
---

# x402-carbon

Wraps the keyless UK Carbon Intensity API. Coverage is Great Britain. Both
routes accept a UK postcode outward code (the part before the space, such as
`SW1A` or `M1`) for regional figures; omit it for the national grid.

## Run the server

It is a self-hosted Node server (Express, Node 18 or newer). Run it from a clone:

```bash
git clone https://github.com/nirholas/x402-carbon && cd x402-carbon
npm install
cp .env.example .env     # then adjust; see the comments in the file
npm run dev              # tsx src/server.ts, listens on PORT (default 4025)
```

`npm run build` then `npm start` runs the compiled server. `npm run client`
runs `examples/agent-client.ts`, a reference paying client. Set `PAY_TO_ADDRESS`
and `SOLANA_PAY_TO_ADDRESS` to your own wallets to be paid yourself.

## Routes

| Route | Price | Notes |
| --- | --- | --- |
| `GET /now` | $0.001 | optional `postcode`; returns gCO2/kWh, index band, generation mix, low-carbon, renewable and fossil shares |
| `POST /best-window` | $0.002 | JSON body, all optional: `durationMinutes` 30 to 1440 (default 60, rounded up to half hours), `postcode`, `notBefore` (ISO-8601, default now), `notAfter` (ISO-8601, default notBefore + 48h) |
| `GET /`, `GET /health`, `GET /.well-known/x402`, `GET /skill.md`, `GET /openapi.json` | free | |

`/best-window` returns the best window with mean intensity, the saving against
starting now, three non-overlapping fallbacks and the half-hourly forecast.

Errors: 400 `invalid_postcode`, `unknown_postcode`, `invalid_duration`,
`window_too_short`, `no_window_available`; 502 `upstream_error` (nothing
settles).

## Example

```bash
curl -i -X POST http://localhost:4025/best-window -H 'content-type: application/json' \
  -d '{"durationMinutes":120,"postcode":"SW1A"}'   # 402 first, then pay and retry
```

## Paying (x402)

Paid routes follow the x402 protocol. An unpaid call returns HTTP 402 with an
`accepts` array listing USDC on Base and USDC on Solana. Sign for one rail,
retry with the base64 payload in the `X-PAYMENT` header, and the 200 body
carries the result; the settlement receipt is in the `X-PAYMENT-RESPONSE`
header. Clients: `x402-fetch` (EVM), `@three-ws/x402-payment-modal` (browser,
both rails), or any x402 client. The rail networks are chosen by `NETWORK`
(EVM, `base-sepolia` by default) and `SOLANA_NETWORK` in `.env`; see
`.env.example`. Settlement moves real USDC on the chosen network: show the user
the recipient, amount and network and get an explicit yes before every paid call.
