# Raw HTTP walkthrough — 402 → pay → 200

Everything below is plain `curl`. No SDK required.

## 0. Start the server

```bash
npm install
npm run dev      # http://localhost:4025
```

## 1. Free routes need no payment

```bash
curl -s http://localhost:4025/health
curl -s http://localhost:4025/ | jq
curl -s http://localhost:4025/.well-known/x402 | jq
```

## 2. Call a paid route with no payment → 402, both rails

```bash
curl -s -i "http://localhost:4025/now?postcode=SW1A"
```

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
```

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "hint": "Pay in USDC on Base or Solana — your client picks the rail. See /.well-known/x402",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "1000",
      "resource": "http://localhost:4025/now",
      "description": "Current GB grid carbon intensity and generation mix",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 120,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "1000",
      "resource": "http://localhost:4025/now",
      "description": "Current GB grid carbon intensity and generation mix",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 120,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USDC", "decimals": 6, "feePayer": "<facilitator sponsor>" }
    }
  ]
}
```

`maxAmountRequired` is in USDC base units (6 decimals): `1000` = $0.001.

## 3. Build the payment

Pick **one** entry from `accepts`.

**EVM (Base):** sign an EIP-3009 `transferWithAuthorization` for
`maxAmountRequired` USDC to `payTo`. No gas needed from you — the facilitator
submits it.

**Solana:** build an SPL `transferChecked` of `maxAmountRequired` USDC to
`payTo`, with `extra.feePayer` as the transaction fee payer, and sign it. You
need USDC only — the facilitator sponsors the SOL fee.

Either way, base64-encode the x402 payload:

```json
{ "x402Version": 1, "scheme": "exact", "network": "<the rail you picked>", "payload": { … } }
```

In practice, let a library do it:

```bash
PRIVATE_KEY=0xYourTestKey npm run client
```

## 4. Repeat the request with the header → 200 + artifact

```bash
curl -s -i -H "X-PAYMENT: <base64 payload>" "http://localhost:4025/now?postcode=SW1A"
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJyYWlsIjoiZXZtIiwi…
```

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

Decode the receipt:

```bash
echo '<X-PAYMENT-RESPONSE value>' | base64 -d | jq
# { "success": true, "rail": "evm", "network": "base-sepolia",
#   "transaction": "0x…", "payer": "0x…", "amount": "1000", "asset": "USDC" }
```

The artifact is in the body of that same 200. There is nothing else to fetch.

## All paid routes

### `GET /now` — $0.001

```bash
curl -s -H "X-PAYMENT: <payload>" "http://localhost:4025/now?postcode=SW1A"
```

### `POST /best-window` — $0.002

```bash
curl -s -H "X-PAYMENT: <payload>" -X POST "http://localhost:4025/best-window" \
  -H 'content-type: application/json' \
  -d '{"durationMinutes":120,"postcode":"SW1A"}'
```
