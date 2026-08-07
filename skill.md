# x402-carbon — agent skill

Find out how dirty the electricity is right now, and when it will be cleanest.
`/now` returns the current GB grid carbon intensity in gCO2/kWh, its index band,
and the full generation mix — with low-carbon, renewable, and fossil shares
computed for you. `/best-window` takes a job length and returns the
lowest-carbon window to run it in the next 48 hours: mean intensity, the saving
against starting now, three non-overlapping fallbacks, and the whole half-hourly
forecast curve it was chosen from. Both routes accept a UK postcode outward code
for regional numbers, and both attach the wind and solar conditions driving the
curve. Coverage is Great Britain.

**Base URL:** `{BASE_URL}` (local default `http://localhost:4025`)

Every paid call returns the purchased artifact **in the 200 response body**.
There is nothing to poll and nothing to collect later.

## Payment

This service speaks **x402** (HTTP 402 Payment Required, <https://x402.org>).

**Pay in USDC on Base or Solana — your client picks the rail.**

| Rail | Network | Asset | payTo |
|------|---------|-------|-------|
| EVM | `base-sepolia` (`base` on mainnet) | USDC | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` |
| Solana | `solana` (`solana-devnet` on devnet) | USDC | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` |

Facilitator: `https://x402.org/facilitator` (verifies and settles both rails).

Flow:

1. Call the endpoint with no `X-PAYMENT` header. You get **402** with an
   `accepts` array holding **both** rails.
2. Pick a rail, sign the payment, and put the base64 payload in `X-PAYMENT`.
3. Repeat the request. You get **200** with the artifact, and a settlement
   receipt in the `X-PAYMENT-RESPONSE` header (base64 JSON:
   `{ success, rail, network, transaction, payer, amount, asset }`).

Use `x402-fetch` (EVM), a Solana x402 client, or any x402-aware HTTP client —
the wire format is the standard one.

```ts
import { wrapFetchWithPayment, createSigner } from "x402-fetch";
const signer = await createSigner("base-sepolia", process.env.PRIVATE_KEY!);
const pay = wrapFetchWithPayment(fetch, signer);
const res = await pay("{BASE_URL}/now?postcode=SW1A");
const artifact = await res.json();
```

## Endpoints

### `GET /now` — $0.001

Current GB grid carbon intensity and generation mix

| Param | In | Required | Type | Description |
|-------|----|----------|------|-------------|
| `postcode` | query | no | string | UK outward code — the part before the space, e.g. `SW1A`, `M1`, `EH1`, `RG10`. Omit for the national grid. |

**Returns** (`200 application/json`) — Current gCO2/kWh with its index band, the full generation mix, low-carbon / renewable / fossil shares, and the wind and solar conditions behind them

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

---

### `POST /best-window` — $0.002

The lowest-carbon window to run a deferrable job in the next 48 hours

| Param | In | Required | Type | Description |
|-------|----|----------|------|-------------|
| `durationMinutes` | body | no | integer | How long the job runs, 30–1440. Rounded up to whole half-hour settlement periods. Default 60. |
| `postcode` | body | no | string | UK outward code for regional figures, e.g. `SW1A`. Omit for the national grid. |
| `notBefore` | body | no | string | Earliest acceptable start, ISO-8601. Default: now. |
| `notAfter` | body | no | string | Latest acceptable finish, ISO-8601. Default: 48 hours after `notBefore`. |

**Request body** (`application/json`)

```json
{
  "durationMinutes": 120,
  "postcode": "SW1A"
}
```

**Returns** (`200 application/json`) — The best start time with mean intensity and the saving against running now, three non-overlapping runners-up, the worst window for contrast, and the full half-hourly forecast curve

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
  "request": {
    "durationMinutes": 120,
    "notBefore": "2026-08-07T03:12:00.000Z",
    "notAfter": "2026-08-09T03:12:00.000Z"
  },
  "currentIntensity": 185,
  "best": {
    "start": "2026-08-08T12:30Z",
    "end": "2026-08-08T14:30Z",
    "durationMinutes": 120,
    "meanIntensity": 56,
    "peakIntensity": 63,
    "index": "low",
    "savingVsNowPct": 69.7,
    "savingVsWorstPct": 74.5,
    "gCO2SavedPerKwhVsNow": 129
  },
  "runnersUp": [
    {
      "start": "2026-08-07T13:00Z",
      "end": "2026-08-07T15:00Z",
      "durationMinutes": 120,
      "meanIntensity": 74,
      "peakIntensity": 81,
      "index": "low",
      "savingVsNowPct": 60,
      "savingVsWorstPct": 66.4,
      "gCO2SavedPerKwhVsNow": 111
    },
    {
      "start": "2026-08-08T02:00Z",
      "end": "2026-08-08T04:00Z",
      "durationMinutes": 120,
      "meanIntensity": 98,
      "peakIntensity": 106,
      "index": "low",
      "savingVsNowPct": 47,
      "savingVsWorstPct": 55.5,
      "gCO2SavedPerKwhVsNow": 87
    }
  ],
  "worstWindow": {
    "start": "2026-08-07T18:00Z",
    "end": "2026-08-07T20:00Z",
    "durationMinutes": 120,
    "meanIntensity": 220,
    "peakIntensity": 238,
    "index": "high",
    "savingVsNowPct": -18.9,
    "savingVsWorstPct": 0,
    "gCO2SavedPerKwhVsNow": -35
  },
  "recommendation": "Start at 2026-08-08T12:30Z on London (SW1A): 56 gCO2/kWh mean, 69.7% below running it now (185 gCO2/kWh). Deferring saves roughly 129 gCO2 for every kWh consumed.",
  "forecastCurve": [
    {
      "from": "2026-08-07T03:00Z",
      "to": "2026-08-07T03:30Z",
      "gCO2PerKwh": 183,
      "index": "high"
    },
    {
      "from": "2026-08-07T03:30Z",
      "to": "2026-08-07T04:00Z",
      "gCO2PerKwh": 179,
      "index": "moderate"
    },
    {
      "from": "2026-08-07T04:00Z",
      "to": "2026-08-07T04:30Z",
      "gCO2PerKwh": 172,
      "index": "moderate"
    }
  ],
  "weather": {
    "latitude": 51.51,
    "longitude": -0.13,
    "status": "ok",
    "hourly": [
      {
        "time": "2026-08-07T03:00:00.000Z",
        "windKph": 8.8,
        "solarWm2": 0,
        "cloudCoverPct": 58
      },
      {
        "time": "2026-08-08T12:00:00.000Z",
        "windKph": 27.4,
        "solarWm2": 611,
        "cloudCoverPct": 12
      }
    ]
  },
  "retrievedAt": "2026-08-07T03:12:19.447Z"
}
```


## Free endpoints

- `GET /` — Service metadata, live prices, active payment rails, coverage note
- `GET /health` — Liveness probe
- `GET /.well-known/x402` — Machine-readable discovery manifest
- `GET /skill.md` — This agent skill card
- `GET /openapi.json` — OpenAPI 3.1 spec

## Error codes

| HTTP | `error` | Meaning |
|------|---------|---------|
| 400 | `invalid_postcode` | `postcode` is not a UK outward code (the part before the space). |
| 400 | `unknown_postcode` | No GB grid region matches that outward code. |
| 400 | `invalid_duration` | `durationMinutes` outside 30…1440. |
| 400 | `window_too_short` | The `notBefore`…`notAfter` span is shorter than `durationMinutes`. |
| 400 | `no_window_available` | No window of that length fits inside the 48-hour forecast horizon. |
| 502 | `upstream_error` | The UK Carbon Intensity API failed or timed out. Nothing settled. |
| 402 | — | Payment required or rejected. Body carries `accepts` (both rails) and an `error` reason. |
| 500 | `no_payment_rail_configured` | Server has neither a valid EVM nor Solana payTo. |

## Data source

Two live, keyless upstreams:

- **[UK Carbon Intensity API](https://carbonintensity.org.uk)** (National Grid ESO) — half-hourly gCO2/kWh, index band, generation mix, and a 48-hour forward forecast, nationally and per GB distribution region. No key.
- **[Open-Meteo](https://open-meteo.com)** — wind speed, shortwave solar radiation, and cloud cover at the region's centroid. No key.

The carbon data is the product; the weather is the explanation. GB grid
intensity swings by an order of magnitude between a still, cloudy evening and a
windy afternoon, so every curve comes back next to the conditions producing it.
An Open-Meteo failure never fails the request — `weather.status` carries the
reason and the carbon data is still delivered.

**Coverage is Great Britain** (National Grid ESO's territory). That is a real
limit, stated in every response's `coverage` field rather than hidden. There are
no fixtures in this repo.

## Discovery

Machine-readable manifest: **`GET /.well-known/x402`**
(also at <https://github.com/nirholas/x402-carbon/blob/main/public/.well-known/x402>).
Indexed by [x402scan.com](https://x402scan.com), the x402 Bazaar, and
[agentic.market](https://agentic.market).

OpenAPI 3.1: [`openapi.json`](https://github.com/nirholas/x402-carbon/blob/main/openapi.json)

## Contact

nichxbt@gmail.com · <https://github.com/nirholas/x402-carbon>
