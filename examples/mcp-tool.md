# Exposing x402-carbon as an MCP tool

[MCP](https://modelcontextprotocol.io) lets Claude (and other MCP clients) call
this service directly. The wrapper below holds the wallet, pays the x402
invoice, and hands the artifact straight back to the model.

## Minimal server

```ts
// mcp-x402-carbon.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSigner, wrapFetchWithPayment } from "x402-fetch";
import { z } from "zod";

const BASE_URL = process.env.CARBON_URL ?? "http://localhost:4025";

const signer = await createSigner("base-sepolia", process.env.PRIVATE_KEY!);
const payFetch = wrapFetchWithPayment(fetch, signer);

const server = new McpServer({ name: "x402-carbon", version: "0.1.0" });

server.tool(
  "carbon_now",
  "Current GB grid carbon intensity and generation mix",
  {
    postcode: z.string().optional().describe("UK outward code — the part before the space, e.g. `SW1A`, `M1`, `EH1`, `RG10`. Omit for the national grid."),
  },
  async (args) => {
    const url = new URL(`${BASE_URL}/now`);
    if (args.postcode) url.searchParams.set("postcode", args.postcode);
    const res = await payFetch(url);
    if (!res.ok) throw new Error(`GET /now → ${res.status}`);
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

server.tool(
  "carbon_best_window",
  "The lowest-carbon window to run a deferrable job in the next 48 hours",
  {
    durationMinutes: z.number().optional().describe("How long the job runs, 30–1440. Rounded up to whole half-hour settlement periods. Default 60."),
    postcode: z.string().optional().describe("UK outward code for regional figures, e.g. `SW1A`. Omit for the national grid."),
    notBefore: z.string().optional().describe("Earliest acceptable start, ISO-8601. Default: now."),
    notAfter: z.string().optional().describe("Latest acceptable finish, ISO-8601. Default: 48 hours after `notBefore`."),
  },
  async (args) => {
    const url = `${BASE_URL}/best-window`;
    const res = await payFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`POST /best-window → ${res.status}`);
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
```

## Wire it into Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-carbon": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-x402-carbon.ts"],
      "env": {
        "PRIVATE_KEY": "0xYourFundedTestKey",
        "CARBON_URL": "http://localhost:4025"
      }
    }
  }
}
```

## Spending caps

Each GET /now call costs $0.001. Wrap `payFetch` with a
budget so a runaway loop cannot drain the wallet:

```ts
let spentMicros = 0;
const CAP_MICROS = 1_000_000; // $1.00

const cappedFetch: typeof fetch = async (input, init) => {
  if (spentMicros >= CAP_MICROS) throw new Error("x402 spend cap reached");
  const res = await payFetch(input, init);
  const receipt = res.headers.get("X-PAYMENT-RESPONSE");
  if (receipt) {
    const { amount } = JSON.parse(Buffer.from(receipt, "base64").toString());
    spentMicros += Number(amount ?? 0);
  }
  return res;
};
```

## Notes

- The tool descriptions above come from [`skill.md`](../skill.md) — keep them in
  sync so the model knows exactly what it is buying.
- Paying on Solana instead? Swap `x402-fetch` for a Solana x402 client; the 402
  challenge already advertises the `solana` rail, so nothing on this
  server changes.
- Discovery for autonomous agents: [`/.well-known/x402`](../public/.well-known/x402).
