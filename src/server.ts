/**
 * x402-carbon — Express server with the dual-rail x402 paywall.
 *
 * Paid routes return the purchased artifact directly in the 200 response body.
 * Buyers pay in USDC on Base (EVM) or on Solana; the 402 challenge advertises
 * both rails and the client picks.
 */
import "dotenv/config";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  facilitatorUrl,
  paywall,
  rails,
  solanaCheckoutRouter,
  usingSuiteDefaultPayTo,
  type RoutePrices,
} from "./payments.js";
import {
  BadRequestError,
  bestWindow,
  now,
  PERIOD_MINUTES,
  UPSTREAMS,
  UpstreamError,
} from "./service.js";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const publicDir = join(root, "public");

/** Paid routes. Anything not listed here is free. */
const ROUTES: RoutePrices = {
  "GET /now": {
    price: "$0.001",
    description:
      "Current GB grid carbon intensity (gCO2/kWh) and generation mix, national or by postcode region, with the wind and solar conditions behind it.",
    outputSchema: {
      type: "object",
      properties: {
        intensity: { type: "object" },
        generationMix: { type: "array", items: { type: "object" } },
        lowCarbonPercent: { type: "number" },
      },
    },
  },
  "POST /best-window": {
    price: "$0.002",
    description:
      "The lowest-carbon window of a given length in the next 48 hours, with the saving against running now, non-overlapping runners-up, and the full half-hourly forecast curve.",
    outputSchema: {
      type: "object",
      properties: {
        best: { type: "object" },
        recommendation: { type: "string" },
        forecastCurve: { type: "array", items: { type: "object" } },
      },
    },
  },
};

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

// Dual-rail x402 paywall: USDC on Base or Solana.
app.use(paywall(ROUTES, { service: "x402-carbon" }));

// Optional: browser (Phantom) Solana checkout helper. No-op when the modal
// package is not installed — agent clients never need it.
const checkoutRouter = await solanaCheckoutRouter();
if (checkoutRouter) app.use("/api/x402-checkout", checkoutRouter);

// Discovery manifest — registered before express.static so it keeps an explicit
// application/json content type (the file has no extension).
app.get("/.well-known/x402", (_req, res) => {
  res.type("application/json").sendFile(join(publicDir, ".well-known", "x402"));
});

// Agent-facing contract and machine spec, served from the repo root.
app.get("/skill.md", (_req, res) => {
  res.type("text/markdown").sendFile(join(root, "skill.md"));
});
app.get("/openapi.json", (_req, res) => {
  res.type("application/json").sendFile(join(root, "openapi.json"));
});

// Static site.
app.use(express.static(publicDir));

// Free: service info.
app.get("/", (_req, res) => {
  res.json({
    name: "x402-carbon",
    description:
      "Grid carbon intensity now and best-window scheduling — keyless live data for green agents",
    payment: {
      protocol: "x402",
      note: "Pay in USDC on Base or Solana — your client picks the rail.",
      facilitator: facilitatorUrl(),
      rails: rails(),
    },
    backend: {
      live: true,
      keyless: true,
      upstreams: UPSTREAMS,
      coverage:
        "Great Britain (National Grid ESO). Regional detail by postcode outward code; national otherwise.",
      note: "Carbon data from the UK Carbon Intensity API; wind and solar context from Open-Meteo so a curve can be explained, not just read.",
    },
    routes: {
      "GET /now": {
        price: "$0.001",
        params: "postcode (optional UK outward code, e.g. SW1A — omit for national)",
        returns: "current gCO2/kWh, index, generation mix, low-carbon/renewable/fossil shares",
      },
      "POST /best-window": {
        price: "$0.002",
        params: "JSON body { durationMinutes?, postcode?, notBefore?, notAfter? }",
        returns: "lowest-carbon window in the next 48h, saving vs now, runners-up, forecast curve",
      },
      "GET /health": { price: "free" },
      "GET /.well-known/x402": { price: "free" },
      "GET /skill.md": { price: "free" },
      "GET /openapi.json": { price: "free" },
    },
    docs: "https://nirholas.github.io/x402-carbon/",
    skill: "https://github.com/nirholas/x402-carbon/blob/main/skill.md",
  });
});

// Free: health check.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/** Map a service error onto an honest HTTP status. Nothing settles on 4xx/5xx. */
function sendError(res: express.Response, err: unknown): void {
  if (err instanceof BadRequestError) {
    res.status(400).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof UpstreamError) {
    res.status(502).json({ error: "upstream_error", message: err.message });
    return;
  }
  res.status(502).json({
    error: "upstream_error",
    message: err instanceof Error ? err.message : "Upstream request failed",
  });
}

// Paid: $0.001 — current intensity + mix. Artifact returned in this response body.
app.get("/now", async (req, res) => {
  const postcode = req.query.postcode ? String(req.query.postcode) : undefined;
  try {
    res.json(await now(postcode));
  } catch (err) {
    sendError(res, err);
  }
});

// Paid: $0.002 — best execution window. Artifact returned in this response body.
app.post("/best-window", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const durationMinutes =
    body.durationMinutes != null ? Number(body.durationMinutes) : undefined;
  if (durationMinutes != null && !Number.isFinite(durationMinutes)) {
    res.status(400).json({
      error: "invalid_duration",
      message: `'durationMinutes' must be a number between ${PERIOD_MINUTES} and 1440.`,
    });
    return;
  }
  try {
    res.json(
      await bestWindow({
        durationMinutes,
        postcode: body.postcode ? String(body.postcode) : undefined,
        notBefore: body.notBefore ? String(body.notBefore) : undefined,
        notAfter: body.notAfter ? String(body.notAfter) : undefined,
      }),
    );
  } catch (err) {
    sendError(res, err);
  }
});

// Unknown route.
app.use((_req, res) => {
  res.status(404).json({ error: "not_found", docs: "https://nirholas.github.io/x402-carbon/" });
});

const port = Number(process.env.PORT ?? 4025);
app.listen(port, () => {
  const pkg = require("../package.json") as { version: string };
  console.log(`x402-carbon v${pkg.version} listening on :${port}`);
  console.log("  payment rails:");
  for (const rail of rails()) {
    console.log(
      `    ${rail.rail === "evm" ? "EVM   " : "Solana"}  ${rail.network.padEnd(14)} ${rail.asset} → ${rail.payTo}`,
    );
  }
  console.log(`  facilitator: ${facilitatorUrl()}`);
  if (usingSuiteDefaultPayTo()) {
    console.log(
      "  note:        using suite default payTo — set PAY_TO_ADDRESS/SOLANA_PAY_TO_ADDRESS to receive funds yourself",
    );
  }
  console.log(`  backend:     ${UPSTREAMS.join(", ")} (keyless, live)`);
  console.log("  coverage:    Great Britain — national, or regional by postcode outward code");
  console.log("  paid routes:");
  for (const [route, spec] of Object.entries(ROUTES)) {
    console.log(`    ${route.padEnd(28)} ${typeof spec === "string" ? spec : spec.price}`);
  }
  console.log("  free routes: GET /, GET /health, GET /.well-known/x402, GET /skill.md");
});
