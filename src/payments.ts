/**
 * Dual-rail x402 paywall — pay in USDC on **Base (EVM)** or **Solana**.
 * The client picks the rail; the 402 challenge advertises both.
 *
 * How it works
 * ------------
 * 1. No `X-PAYMENT` header  → 402 + `{ x402Version, accepts: [evmRail, solanaRail] }`.
 * 2. `X-PAYMENT` present    → decode the base64 payload, read its `network`,
 *                             pick the matching requirement, then verify+settle
 *                             through the x402 facilitator (it speaks both EVM
 *                             and SVM `exact`), and set `X-PAYMENT-RESPONSE`.
 * 3. A rail whose config is missing is simply omitted from `accepts` (logged
 *    once at boot) rather than crashing the server.
 *
 * Notes on the packages this builds on:
 *  - `x402/verify`'s `useFacilitator()` is the real verify/settle path for BOTH
 *    rails — that's what `x402-express` uses under the hood, we just need the
 *    two-requirement challenge that its single-rail middleware doesn't emit.
 *  - `@three-ws/x402-payment-modal/server` is the browser-side Solana helper
 *    (it builds + encodes the SPL transfer Phantom signs). It is mounted
 *    opt-in by `solanaCheckoutRouter()` below and needs the `@solana/web3.js`
 *    and `@solana/spl-token` peer deps; without them the EVM rail and the
 *    agent-side Solana rail still work.
 */
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { useFacilitator } from "x402/verify";
import { PaymentPayloadSchema, type PaymentPayload, type PaymentRequirements } from "x402/types";

// ---------------------------------------------------------------------------
// Suite defaults — public receive addresses, safe to commit.
// ---------------------------------------------------------------------------

export const DEFAULT_EVM_PAY_TO = "0x40252CFDF8B20Ed757D61ff157719F33Ec332402";
export const DEFAULT_SOLANA_PAY_TO = "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW";

/** The x402.org facilitator's Solana fee-payer (sponsors the SOL network fee). */
const DEFAULT_SOLANA_FEE_PAYER = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";

export type EvmNetwork = "base" | "base-sepolia";
export type SolanaNetwork = "solana" | "solana-devnet";

/** Canonical USDC contract / mint per network. */
const USDC_ASSET: Record<EvmNetwork | SolanaNetwork, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "solana-devnet": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

const USDC_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PaywallConfig {
  /** Human name of the service, used in challenge descriptions. */
  service: string;
  /** Absolute base URL used to build the `resource` field. */
  baseUrl?: string;
}

export interface RailInfo {
  rail: "evm" | "solana";
  network: string;
  asset: "USDC";
  payTo: string;
}

export interface RouteSpec {
  /** Price like `"$0.01"`. */
  price: string;
  /** Shown to the payer in the wallet / modal. */
  description: string;
  /** Optional JSON-schema-ish hint for what the 200 returns. */
  outputSchema?: Record<string, unknown>;
}

export type RoutePrices = Record<string, RouteSpec | string>;

const EVM_NETWORK = (process.env.NETWORK ?? "base-sepolia") as EvmNetwork;
const SOLANA_NETWORK: SolanaNetwork =
  (process.env.SOLANA_NETWORK ?? "mainnet-beta") === "devnet" ? "solana-devnet" : "solana";
const FACILITATOR_URL = (process.env.FACILITATOR_URL ??
  "https://x402.org/facilitator") as `${string}://${string}`;
export const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const EVM_PAY_TO = process.env.PAY_TO_ADDRESS?.trim() || DEFAULT_EVM_PAY_TO;
const SOLANA_PAY_TO = process.env.SOLANA_PAY_TO_ADDRESS?.trim() || DEFAULT_SOLANA_PAY_TO;
const SOLANA_FEE_PAYER = process.env.SOLANA_FEE_PAYER?.trim() || DEFAULT_SOLANA_FEE_PAYER;

const evmEnabled = /^0x[0-9a-fA-F]{40}$/.test(EVM_PAY_TO);
const solanaEnabled = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(SOLANA_PAY_TO) && !!SOLANA_FEE_PAYER;

const { verify: facilitatorVerify, settle: facilitatorSettle } = useFacilitator({
  url: FACILITATOR_URL,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `"$0.01"` → `"10000"` (USDC base units, 6 decimals). */
export function usdToBaseUnits(price: string): string {
  const usd = Number(String(price).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid price: ${price}`);
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS)).toString();
}

function normalizeSpec(spec: RouteSpec | string): RouteSpec {
  return typeof spec === "string" ? { price: spec, description: "" } : spec;
}

/**
 * Match `"POST /pools/:id/pay"` / `"POST /pools/*​/pay"` route keys against a
 * live `METHOD /path`. `*` and `:param` both match a single path segment;
 * a trailing `*` matches the rest.
 */
function routeMatches(pattern: string, method: string, path: string): boolean {
  const [patMethod, ...rest] = pattern.trim().split(/\s+/);
  const patPath = rest.join(" ") || "/";
  if (patMethod !== "*" && patMethod.toUpperCase() !== method.toUpperCase()) return false;
  const p = patPath.split("/").filter(Boolean);
  const a = path.split("/").filter(Boolean);
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg === "**") return true;
    if (i >= a.length) return false;
    if (seg === "*" || seg.startsWith(":")) continue;
    if (seg !== a[i]) return false;
  }
  return p.length === a.length;
}

function absoluteResource(req: Request, cfg: PaywallConfig): string {
  const base = (cfg.baseUrl ?? process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  if (base) return `${base}${req.path}`;
  return `${req.protocol}://${req.get("host") ?? "localhost"}${req.path}`;
}

// ---------------------------------------------------------------------------
// The dual-rail challenge
// ---------------------------------------------------------------------------

/** Build both payment requirements for one resource + price. */
export function buildAccepts(args: {
  resource: string;
  price: string;
  description: string;
  outputSchema?: Record<string, unknown>;
}): PaymentRequirements[] {
  const maxAmountRequired = usdToBaseUnits(args.price);
  const accepts: PaymentRequirements[] = [];

  if (evmEnabled) {
    accepts.push({
      scheme: "exact",
      network: EVM_NETWORK,
      maxAmountRequired,
      resource: args.resource as PaymentRequirements["resource"],
      description: args.description,
      mimeType: "application/json",
      payTo: EVM_PAY_TO,
      maxTimeoutSeconds: 120,
      asset: USDC_ASSET[EVM_NETWORK],
      outputSchema: args.outputSchema,
      extra: { name: "USDC", version: "2" },
    });
  }

  if (solanaEnabled) {
    accepts.push({
      scheme: "exact",
      network: SOLANA_NETWORK,
      maxAmountRequired,
      resource: args.resource as PaymentRequirements["resource"],
      description: args.description,
      mimeType: "application/json",
      payTo: SOLANA_PAY_TO,
      maxTimeoutSeconds: 120,
      asset: USDC_ASSET[SOLANA_NETWORK],
      outputSchema: args.outputSchema,
      // `feePayer` is the facilitator account that sponsors the SOL network fee,
      // so the payer only needs USDC — no SOL required.
      extra: { name: "USDC", decimals: USDC_DECIMALS, feePayer: SOLANA_FEE_PAYER },
    });
  }

  return accepts;
}

/** The rails this server currently accepts (for banners, manifests, docs). */
export function rails(): RailInfo[] {
  const out: RailInfo[] = [];
  if (evmEnabled) out.push({ rail: "evm", network: EVM_NETWORK, asset: "USDC", payTo: EVM_PAY_TO });
  if (solanaEnabled)
    out.push({ rail: "solana", network: SOLANA_NETWORK, asset: "USDC", payTo: SOLANA_PAY_TO });
  return out;
}

export function facilitatorUrl(): string {
  return FACILITATOR_URL;
}

/** True when the operator has not set their own receive addresses. */
export function usingSuiteDefaultPayTo(): boolean {
  return EVM_PAY_TO === DEFAULT_EVM_PAY_TO && SOLANA_PAY_TO === DEFAULT_SOLANA_PAY_TO;
}

// ---------------------------------------------------------------------------
// The middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware enforcing x402 payment on the given routes.
 * Routes not in the map are free and pass straight through.
 */
export function paywall(routePrices: RoutePrices, cfg: PaywallConfig): RequestHandler {
  if (!evmEnabled) console.warn("[x402] EVM rail disabled — PAY_TO_ADDRESS is not a valid 0x address");
  if (!solanaEnabled)
    console.warn("[x402] Solana rail disabled — SOLANA_PAY_TO_ADDRESS/SOLANA_FEE_PAYER missing or invalid");

  const entries = Object.entries(routePrices).map(([k, v]) => [k, normalizeSpec(v)] as const);

  return async function x402Paywall(req: Request, res: Response, next: NextFunction) {
    const match = entries.find(([pattern]) => routeMatches(pattern, req.method, req.path));
    if (!match) return next();

    const [pattern, spec] = match;
    const resource = absoluteResource(req, cfg);
    const description = spec.description || `${cfg.service}: ${pattern}`;
    const accepts = buildAccepts({
      resource,
      price: spec.price,
      description,
      outputSchema: spec.outputSchema,
    });

    if (accepts.length === 0) {
      res.status(503).json({ error: "no_payment_rail_configured" });
      return;
    }

    const challenge = (error: string) => ({
      x402Version: 1,
      error,
      accepts,
      payer: null,
      hint: "Pay in USDC on Base or Solana — your client picks the rail. See /.well-known/x402",
    });

    const header = req.header("x-payment");
    if (!header) {
      res.status(402).json(challenge("X-PAYMENT header is required"));
      return;
    }

    // ---- decode ----
    let payload: PaymentPayload;
    try {
      const raw = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
      payload = PaymentPayloadSchema.parse(raw);
    } catch {
      res.status(402).json(challenge("invalid X-PAYMENT header — expected base64 x402 payload"));
      return;
    }

    // ---- pick the rail the client chose ----
    const requirement = accepts.find((a) => a.network === payload.network);
    if (!requirement) {
      res
        .status(402)
        .json(challenge(`unsupported network "${payload.network}" — see accepts[] for the rails we take`));
      return;
    }

    // ---- verify + settle (same facilitator handles EVM and Solana) ----
    try {
      const verification = await facilitatorVerify(payload, requirement);
      if (!verification.isValid) {
        res.status(402).json(challenge(verification.invalidReason ?? "payment verification failed"));
        return;
      }

      const settlement = await facilitatorSettle(payload, requirement);
      if (!settlement.success) {
        res.status(402).json(challenge(settlement.errorReason ?? "settlement failed"));
        return;
      }

      const receipt = {
        success: true,
        rail: requirement.network.startsWith("solana") ? "solana" : "evm",
        network: settlement.network,
        transaction: settlement.transaction,
        payer: settlement.payer ?? verification.payer ?? null,
        amount: requirement.maxAmountRequired,
        asset: "USDC",
      };
      res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(receipt)).toString("base64"));
      res.locals.x402 = receipt;
      next();
    } catch (err) {
      res
        .status(402)
        .json(challenge(`facilitator error: ${err instanceof Error ? err.message : String(err)}`));
    }
  };
}

/** The settlement receipt for the current request, if any. */
export function paymentReceipt(res: Response): Record<string, unknown> | null {
  return (res.locals?.x402 as Record<string, unknown> | undefined) ?? null;
}

/**
 * Optional: mount the browser Solana checkout helper from the payment modal.
 * Needs `@solana/web3.js` + `@solana/spl-token`; returns null when absent so
 * the server still boots. Agent clients never need this — it exists for the
 * Phantom flow in the human checkout page.
 */
export async function solanaCheckoutRouter(): Promise<Router | null> {
  try {
    // Indirect specifier: the package is an optional dependency, so it must not
    // become a hard compile-time or load-time requirement.
    const specifier = "@three-ws/x402-payment-modal/server/express";
    const mod = (await import(specifier)) as {
      x402CheckoutRouter: (opts: { rpcUrl?: string }) => Router;
    };
    return mod.x402CheckoutRouter({ rpcUrl: SOLANA_RPC_URL });
  } catch {
    console.warn(
      "[x402] Solana browser checkout not mounted — install @three-ws/x402-payment-modal, @solana/web3.js and @solana/spl-token to enable Phantom checkout"
    );
    return null;
  }
}
