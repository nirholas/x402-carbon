# API reference — x402-carbon

Base URL: `http://localhost:4025` in development.
Machine-readable: [`openapi.json`](https://github.com/nirholas/x402-carbon/blob/main/openapi.json) (OpenAPI 3.1).

All paid routes return the purchased artifact in the **200 response body**.

## Payment

Every paid route answers an unpaid request with **402** and an `accepts` array
holding both rails:

| Rail | Network | Asset | payTo |
|------|---------|-------|-------|
| EVM | `base-sepolia` (`base` on mainnet) | USDC | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` |
| Solana | `solana` (`solana-devnet` on devnet) | USDC | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` |

Prices are quoted in USDC base units (6 decimals) as `maxAmountRequired`.
On success the response carries `X-PAYMENT-RESPONSE`: base64 JSON with
`{ success, rail, network, transaction, payer, amount, asset }`.

---

## `GET /now`

**$0.001** — Current GB grid carbon intensity and generation mix

### Parameters

| Param | In | Required | Type | Description |
|-------|----|----------|------|-------------|
| `postcode` | query | no | string | UK outward code — the part before the space, e.g. `SW1A`, `M1`, `EH1`, `RG10`. Omit for the national grid. |

### Example request

```bash
curl -s -H "X-PAYMENT: <base64 payload>" "http://localhost:4025/now?postcode=SW1A"
```

### Response `200 application/json`

`intensity.basis` is `actual` for the settled metered figure or `forecast` for the operator's estimate — regional data is always `forecast`, because ESO does not settle metered intensity per region. `lowCarbonPercent` includes nuclear and biomass; `renewablePercent` counts only wind, solar, and hydro. `weather` is context, never a failure mode: if Open-Meteo is unreachable its `status` says so and the carbon data still arrives.

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

### Errors

| HTTP | `error` | When |
|------|---------|------|
| 400 | `invalid_postcode` | Not a UK outward code. Nothing settled. |
| 400 | `unknown_postcode` | No GB grid region matches it. Nothing settled. |
| 502 | `upstream_error` | The UK Carbon Intensity API failed or timed out. Nothing settled. |
| 402 | — | No or invalid `X-PAYMENT`. Body carries `accepts` with both rails. |
| 502 | `upstream_error` | The upstream data source failed or timed out. |

---

## `POST /best-window`

**$0.002** — The lowest-carbon window to run a deferrable job in the next 48 hours

### Parameters

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

### Example request

```bash
curl -s -H "X-PAYMENT: <base64 payload>" -X POST "http://localhost:4025/best-window" \
  -H 'content-type: application/json' \
  -d '{"durationMinutes":120,"postcode":"SW1A"}'
```

### Response `200 application/json`

`recommendation` is the sentence to act on; `best.start` the timestamp to schedule against. When the grid is already near-zero the recommendation says so in absolute terms instead of quoting a percentage off a meaningless baseline. `runnersUp` never overlaps the winner, so each is a genuine fallback. `forecastCurve` is the complete half-hourly series the choice was made from — 73 slots covering 48 hours — so you can re-rank it against your own objective.

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

### Errors

| HTTP | `error` | When |
|------|---------|------|
| 400 | `invalid_duration` | `durationMinutes` outside 30…1440. Nothing settled. |
| 400 | `window_too_short` | The notBefore…notAfter span cannot hold the job. Nothing settled. |
| 400 | `no_window_available` | No window of that length fits in the 48-hour horizon. Nothing settled. |
| 400 | `unknown_postcode` | No GB grid region matches that outward code. Nothing settled. |
| 502 | `upstream_error` | The UK Carbon Intensity API failed or timed out. Nothing settled. |
| 402 | — | No or invalid `X-PAYMENT`. Body carries `accepts` with both rails. |
| 502 | `upstream_error` | The upstream data source failed or timed out. |


---

## Free routes

### `GET /`

Service metadata: description, live prices, active payment rails, data-source
status, and docs links.

### `GET /health`

```json
{ "status": "ok", "uptime": 12.5 }
```

### `GET /.well-known/x402`

The discovery manifest — every resource with its price, output schema, and both
accepted rails. See [agents.md](agents.md).
