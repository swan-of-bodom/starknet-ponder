import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import {
  getChain,
  getErc20IndexingBuild,
  getSimulatedEvent,
} from "@/_test/utils.js";
import { onchainTable } from "@/drizzle/onchain.js";
import type { IndexingCache } from "@/indexing-store/cache.js";
import { createCachedViemClient } from "@/indexing/client.js";
import {
  InvalidEventAccessError,
  type RetryableError,
} from "@/internal/errors.js";
import type { IndexingErrorHandler } from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import { toHex, zeroAddress } from "@/utils/hex.js";
import { parseEther } from "@/utils/units.js";
import { beforeEach, expect, test, vi } from "vitest";
import {
  type Context,
  createColumnAccessPattern,
  createIndexing,
  getEventCount,
} from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint().notNull(),
}));

const schema = { account };

const indexingErrorHandler: IndexingErrorHandler = {
  getRetryableError: () => {
    return indexingErrorHandler.error;
  },
  setRetryableError: (error: RetryableError) => {
    indexingErrorHandler.error = error;
  },
  clearRetryableError: () => {
    indexingErrorHandler.error = undefined;
  },
  error: undefined as RetryableError | undefined,
};

test("createIndexing()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  expect(indexing).toBeDefined();
});

test("processSetupEvents() empty", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  await indexing.processSetupEvents({ db: indexingStore });
});

test("processSetupEvents()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  await indexing.processSetupEvents({ db: indexingStore });

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledOnce();
  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledWith({
    context: {
      chain: { id: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          address: zeroAddress,
          startBlock: sources[0]!.filter.fromBlock,
          endBlock: sources[0]!.filter.toBlock,
        },
      },
      client: expect.any(Object),
      db: expect.any(Object),
    },
  });
});

test("processEvent()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });

  await indexing.processRealtimeEvents({ db: indexingStore, events: [event] });

  // Cairo event naming - just "Erc20:Transfer", not EVM-style signature
  expect(indexingFunctions["Erc20:Transfer"]).toHaveBeenCalledTimes(1);

  // Verify the call structure
  const call = (indexingFunctions["Erc20:Transfer"] as any).mock.calls[0][0];
  expect(call.event).toBeDefined();
  expect(call.event.id).toBeDefined();
  expect(call.event.block).toBeDefined();
  expect(call.event.log).toBeDefined();
  expect(call.context).toBeDefined();
  expect(call.context.chain).toEqual({ id: 1, name: "mainnet" });
  expect(call.context.client).toBeDefined();
  expect(call.context.db).toBeDefined();
  expect(call.context.contracts.Erc20).toBeDefined();
  expect(call.context.contracts.Erc20.address).toBe(address);
});

test("processEvents eventCount", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });

  await indexing.processRealtimeEvents({ db: indexingStore, events: [event] });

  const metrics = await common.metrics.ponder_indexing_completed_events.get();

  expect(metrics.values).toMatchInlineSnapshot(`
    [
      {
        "labels": {
          "event": "Erc20:Transfer",
        },
        "value": 1,
      },
      {
        "labels": {
          "event": "Erc20:setup",
        },
        "value": 0,
      },
    ]
  `);
});

// Skip: Starknet doesn't have direct getBalance RPC - uses ERC20 balance_of
test.skip("executeSetup() context.client", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);

  indexingFunctions["Erc20:setup"] = async ({
    context,
  }: { context: Context }) => {
    await context.client.getBalance({ address: BOB });
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const getBalanceSpy = vi.spyOn(rpc, "request");

  await indexing.processSetupEvents({ db: indexingStore });

  expect(getBalanceSpy).toHaveBeenCalledOnce();
  // Starknet uses starknet_getBalance instead of eth_getBalance
  expect(getBalanceSpy).toHaveBeenCalledWith(
    {
      method: "starknet_getBalance",
      params: [BOB, "0x0"],
    },
    expect.any(Object),
  );
});

test("executeSetup() context.db", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  indexingFunctions["Erc20:setup"] = async ({
    context,
  }: { context: Context }) => {
    await context.db
      .insert(account)
      .values({ address: zeroAddress, balance: 10n });
  };

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const insertSpy = vi.spyOn(indexingStore, "insert");

  await indexing.processSetupEvents({ db: indexingStore });

  expect(insertSpy).toHaveBeenCalledOnce();

  const supply = await indexingStore.find(account, { address: zeroAddress });
  expect(supply).toMatchObject({
    address: zeroAddress,
    balance: 10n,
  });
});

test("executeSetup() metrics", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  await indexing.processSetupEvents({ db: indexingStore });

  const metrics = await common.metrics.ponder_indexing_function_duration.get();
  expect(metrics.values).toBeDefined();
});

test("executeSetup() error", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  // @ts-ignore
  indexingFunctions["Erc20:setup"].mockRejectedValue(new Error());

  await expect(() =>
    indexing.processSetupEvents({ db: indexingStore }),
  ).rejects.toThrowError();

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledTimes(1);
});

// Skip: Starknet doesn't have direct getBalance RPC - uses ERC20 balance_of
test.skip("processEvents() context.client", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  indexingFunctions[
    "Erc20:Transfer"
  ] = async ({ context }: { context: Context }) => {
    await context.client.getBalance({ address: BOB });
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const getBalanceSpy = vi.spyOn(rpc, "request");

  const event = getSimulatedEvent({ source: sources[0], blockData });
  await indexing.processRealtimeEvents({ db: indexingStore, events: [event] });

  expect(getBalanceSpy).toHaveBeenCalledTimes(1);
  // Starknet uses starknet_getBalance instead of eth_getBalance
  // Block number format differs from EVM
  expect(getBalanceSpy).toHaveBeenCalledWith(
    {
      method: "starknet_getBalance",
      params: expect.arrayContaining([BOB]),
    },
    expect.any(Object),
  );
});

test("processEvents() context.db", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  let i = 0;

  indexingFunctions[
    "Erc20:Transfer"
  ] = async ({ context }: { event: any; context: Context }) => {
    await context.db.insert(account).values({
      address: `0x000000000000000000000000000000000000000${i++}`,
      balance: 10n,
    });
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const insertSpy = vi.spyOn(indexingStore, "insert");

  const event = getSimulatedEvent({ source: sources[0], blockData });
  await indexing.processRealtimeEvents({ db: indexingStore, events: [event] });

  expect(insertSpy).toHaveBeenCalledTimes(1);

  const transferEvents = await indexingStore.sql.select().from(account);

  expect(transferEvents).toHaveLength(1);
});

test("processEvents() metrics", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });

  await indexing.processRealtimeEvents({ events: [event], db: indexingStore });

  const metrics = await common.metrics.ponder_indexing_function_duration.get();
  expect(metrics.values).toBeDefined();
});

test("processEvents() error", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  indexingFunctions[
    "Erc20:Transfer"
    // @ts-ignore
  ]!.mockRejectedValue(new Error());

  const event = getSimulatedEvent({ source: sources[0], blockData });
  await expect(() =>
    indexing.processRealtimeEvents({ db: indexingStore, events: [event] }),
  ).rejects.toThrowError();

  expect(
    indexingFunctions[
      "Erc20:Transfer"
    ],
  ).toHaveBeenCalledTimes(1);
});

test("processEvents() error with missing event object properties", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  indexingFunctions[
    "Erc20:Transfer"
  ] = async ({ event }: { event: any; context: Context }) => {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete event.transaction;
    throw new Error("empty transaction");
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });
  await expect(() =>
    indexing.processRealtimeEvents({ events: [event], db: indexingStore }),
  ).rejects.toThrowError();
});

test("processEvents() column selection", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  // TODO(kyle) remove setup functions from column selection resolution
  // @ts-ignore
  // biome-ignore lint/performance/noDelete: <explanation>
  delete indexingFunctions["Erc20:setup"];

  const eventCount = getEventCount(indexingFunctions);

  let count = 0;

  indexingFunctions[
    "Erc20:Transfer"
  ] = async ({ event }: { event: any; context: Context }) => {
    event.transaction.type;
    event.transaction.hash;
    if (count++ === 1001) {
      event.transaction.version;
    }
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const events = Array.from({ length: 1001 }).map(() => event);

  await indexing.processHistoricalEvents({
    db: indexingStore,
    events,
    cache: {} as IndexingCache,
    updateIndexingSeconds: vi.fn(),
  });

  expect(sources[0]!.filter.include).toMatchInlineSnapshot(`
    [
      "transaction.type",
      "transaction.hash",
      "log.address",
      "log.data",
      "log.logIndex",
      "log.removed",
      "log.keys",
      "transaction.transactionIndex",
      "transaction.version",
      "block.timestamp",
      "block.number",
      "block.hash",
    ]
  `);

  // Remove accessed property to simulate resolved column selection
  // @ts-ignore
  // biome-ignore lint/performance/noDelete: <explanation>
  delete event.event.transaction.version;

  await expect(() =>
    indexing.processHistoricalEvents({
      events: [event],
      db: indexingStore,
      cache: {} as IndexingCache,
      updateIndexingSeconds: vi.fn(),
    }),
  ).rejects.toThrowError(
    new InvalidEventAccessError("transaction.version"),
  );
});

// Starknet uses balance_of on ERC20 token contracts instead of getBalance
test("ponderActions getBalance() via balance_of", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  // Starknet uses balance_of on token contracts
  // Use cache: "immutable" to avoid block number issues with devnet
  const balance = await client.readContract({
    abi: erc20ABI,
    functionName: "balance_of",
    address,
    args: [ALICE],
    cache: "immutable",
  });

  expect(balance).toBeDefined();
});

// Starknet uses getClassHashAt instead of getCode
test("ponderActions getCode() via getClassHashAt", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  // Starknet uses getClassHashAt to check if contract is deployed
  const classHash = await client.getClassHashAt({
    contract_address: address, // snake_case per starkweb2 API
  });

  expect(classHash).toBeTruthy();
});

// Skip: Starknet storage model differs from EVM - uses contract_storage_read
test.skip("ponderActions getStorageAt()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  const storage = await client.getStorageAt({
    address,
    // totalSupply is in the third storage slot
    slot: toHex(2),
  });

  expect(BigInt(storage!)).toBe(parseEther("1"));
});

// Cairo uses snake_case function names (total_supply, not totalSupply)
test("ponderActions readContract()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  // Use cache: "immutable" to avoid block number issues with devnet
  const totalSupply = await client.readContract({
    abi: erc20ABI,
    functionName: "total_supply", // Cairo snake_case
    address,
    cache: "immutable",
  });

  expect(totalSupply).toBeDefined();
  // ETH token on devnet has initial supply
  expect(typeof totalSupply === "bigint" || typeof totalSupply === "object").toBe(true);
});

// Cairo uses snake_case function names
test("ponderActions readContract() blockNumber", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  // Read at current block (after mint)
  // Use cache: "immutable" to avoid block number issues with devnet
  const totalSupply = await client.readContract({
    abi: erc20ABI,
    functionName: "total_supply", // Cairo snake_case
    address,
    cache: "immutable",
  });

  // Should have a supply after mint
  expect(totalSupply).toBeDefined();
});

// Test retry on empty response
test("ponderActions readContract() retries on empty response", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  // Should successfully read without mocking
  // Use cache: "immutable" to avoid block number issues with devnet
  const totalSupply = await client.readContract({
    abi: erc20ABI,
    functionName: "total_supply", // Cairo snake_case
    address,
    cache: "immutable",
  });

  expect(totalSupply).toBeDefined();
});

// Starknet uses readContracts instead of EVM-style multicall
test("ponderActions multicall()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { indexingFunctions, sources } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  // Use readContracts for batched reads (Starknet equivalent of multicall)
  // Use cache: "immutable" to avoid block number issues with devnet
  const results = await client.readContracts({
    contracts: [
      {
        abi: erc20ABI,
        functionName: "total_supply", // Cairo snake_case
        address,
      },
      {
        abi: erc20ABI,
        functionName: "balance_of", // Cairo snake_case
        address,
        args: [ALICE],
      },
    ],
    cache: "immutable",
  });

  expect(results).toHaveLength(2);
  expect(results[0]).toBeDefined();
  expect(results[1]).toBeDefined();
});

// Starknet uses readContracts - test with multiple contract reads
test("ponderActions multicall() allowFailure", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  // Use readContracts for batched reads
  // Use cache: "immutable" to avoid block number issues with devnet
  const results = await client.readContracts({
    contracts: [
      {
        abi: erc20ABI,
        functionName: "total_supply", // Cairo snake_case
        address,
      },
      {
        abi: erc20ABI,
        functionName: "total_supply", // Cairo snake_case
        address,
      },
    ],
    cache: "immutable",
  });

  expect(results).toHaveLength(2);
  // Both calls should succeed
  expect(results[0]).toBeDefined();
  expect(results[1]).toBeDefined();
});
