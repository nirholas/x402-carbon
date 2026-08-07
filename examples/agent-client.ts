/**
 * x402-carbon — agent client example.
 *
 * Full x402 flow on the EVM rail: request → 402 → sign → settle → 200 artifact.
 * The Solana rail is shown in the commented section at the bottom.
 *
 *   PRIVATE_KEY=0xYourTestKey npm run client
 *
 * Fund the key with Base Sepolia USDC first: https://faucet.circle.com
 */
import { createSigner, wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4025";
const NETWORK = process.env.NETWORK ?? "base-sepolia";

async function main(): Promise<void> {
  // ---- 1. Look at the raw 402 first, so you can see both rails on offer ----
  const unpaid = await fetch(`${BASE_URL}/now?postcode=SW1A`);
  if (unpaid.status === 402) {
    const challenge = (await unpaid.json()) as {
      accepts: { network: string; asset: string; payTo: string; maxAmountRequired: string }[];
    };
    console.log("402 Payment Required — accepted rails:");
    for (const a of challenge.accepts) {
      console.log(
        `  ${a.network.padEnd(14)} ${a.maxAmountRequired} USDC base units → ${a.payTo}`,
      );
    }
    console.log();
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Set PRIVATE_KEY to a funded Base Sepolia key to complete the purchase.");
    process.exit(1);
  }

  // ---- 2. Pay and get the artifact ----
  const signer = await createSigner(NETWORK, privateKey);
  const payFetch = wrapFetchWithPayment(fetch, signer);

  {
    const res = await payFetch(`${BASE_URL}/now?postcode=SW1A`);
    if (!res.ok) {
      console.error(`GET /now failed: ${res.status}`, await res.text());
      process.exit(1);
    }
    console.log("=== GET /now ($0.001) ===");
    console.log(JSON.stringify(await res.json(), null, 2));

    const receipt = res.headers.get("X-PAYMENT-RESPONSE");
    if (receipt) console.log("receipt:", decodeXPaymentResponse(receipt));
    console.log();
  }

  {
    const res = await payFetch(`${BASE_URL}/best-window`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({"durationMinutes":120,"postcode":"SW1A"}),
    });
    if (!res.ok) {
      console.error(`POST /best-window failed: ${res.status}`, await res.text());
      process.exit(1);
    }
    console.log("=== POST /best-window ($0.002) ===");
    console.log(JSON.stringify(await res.json(), null, 2));

    const receipt = res.headers.get("X-PAYMENT-RESPONSE");
    if (receipt) console.log("receipt:", decodeXPaymentResponse(receipt));
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Paying on the Solana rail instead
// ---------------------------------------------------------------------------
//
// The same 402 challenge also carries a `solana` entry:
//
//   {
//     "scheme": "exact",
//     "network": "solana",
//     "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",   // USDC mint
//     "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
//     "maxAmountRequired": "1000",
//     "extra": { "feePayer": "<facilitator sponsor — pays the SOL fee>" }
//   }
//
// A Solana client builds an SPL `transferChecked` to `payTo` for
// `maxAmountRequired`, has the buyer sign it, base64-encodes
// `{ x402Version: 1, scheme: "exact", network, payload: { transaction } }`
// into `X-PAYMENT`, and repeats the request. Because `extra.feePayer` is the
// facilitator's sponsor account, the buyer needs USDC only — no SOL for gas.
//
// In the browser, @three-ws/x402-payment-modal does all of this for Phantom
// automatically; server-side, its `/server` export builds and encodes the
// transaction:
//
//   import { prepareSolanaCheckout, encodeX402Payment }
//     from "@three-ws/x402-payment-modal/server";
//
//   const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer, rpcUrl });
//   const signedTxBase64 = await wallet.signTransaction(tx_base64);
//   const { x_payment } = encodeX402Payment({ accept, signedTxBase64, resourceUrl });
//   await fetch(url, { headers: { "X-PAYMENT": x_payment } });
