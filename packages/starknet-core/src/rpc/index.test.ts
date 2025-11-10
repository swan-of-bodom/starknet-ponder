import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { simulateBlock } from "@/_test/simulate.js";
import { getChain } from "@/_test/utils.js";
import { wait } from "@/utils/wait.js";
import { beforeEach, expect, test, vi } from "vitest";
import { createRpc } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("createRpc()", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await rpc.request({ method: "starknet_blockNumber" });
});

test("createRpc() handles rate limiting", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Too Many Requests" }), {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Content-Type": "application/json" },
    }),
  );

  await rpc.request({ method: "starknet_blockNumber" });
});

test("createRpc() retry BlockNotFoundError", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await simulateBlock();

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ jsonrpc: "2.0", result: null, id: 1 })),
  );

  const block = await rpc.request(
    { method: "starknet_getBlockWithTxs", params: { block_id: { block_number: 1 } } },
    {
      retryNullBlockRequest: true,
    },
  );

  expect(block).not.toBeNull();
});

// NOTE: Reduced iterations, starknetdevnet not as fast as anvil ?
test("https://github.com/ponder-sh/ponder/pull/2143", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 5; j++) {
      await rpc.request({ method: "starknet_blockNumber" });
    }
    await wait(200);
  }

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Too Many Requests" }), {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Content-Type": "application/json" },
    }),
  );

  await rpc.request({ method: "starknet_blockNumber" });
}, 15_000);
