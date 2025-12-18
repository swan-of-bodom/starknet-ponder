import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import { setupCommon } from "@/_test/setup.js";
import {
  getAccountsIndexingBuild,
  getBlocksIndexingBuild,
  getErc20IndexingBuild,
} from "@/_test/utils.js";
import type {
  BlockEvent,
  ContractSource,
  Event,
  LogEvent,
  RawEvent,
  TraceEvent,
  TransferEvent,
} from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { computeEventSelector } from "@/utils/event-selector.js";
import { toHex64 } from "@/utils/hex.js";
import { toHex, zeroAddress } from "@/utils/hex.js";
import { parseEther } from "@/utils/units.js";
import { encodeFunctionData, encodeFunctionResult } from "viem/utils";
import { beforeEach, expect, test } from "vitest";
import { decodeEvents, splitEvents } from "./events.js";

beforeEach(setupCommon);

test("splitEvents()", async () => {
  const events = [
    {
      chainId: 1,
      checkpoint: "0",
      event: {
        block: {
          hash: "0x1",
          timestamp: 1,
          number: 1n,
        },
      },
    },
    {
      chainId: 1,
      checkpoint: "0",
      event: {
        block: {
          hash: "0x2",
          timestamp: 2,
          number: 2n,
        },
      },
    },
  ] as unknown as Event[];

  const result = splitEvents(events);

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "chainId": 1,
        "checkpoint": "0000000001000000000000000000010000000000000001999999999999999999999999999999999",
        "events": [
          {
            "chainId": 1,
            "checkpoint": "0",
            "event": {
              "block": {
                "hash": "0x1",
                "number": 1n,
                "timestamp": 1,
              },
            },
          },
        ],
      },
      {
        "chainId": 1,
        "checkpoint": "0000000002000000000000000000010000000000000002999999999999999999999999999999999",
        "events": [
          {
            "chainId": 1,
            "checkpoint": "0",
            "event": {
              "block": {
                "hash": "0x2",
                "number": 2n,
                "timestamp": 2,
              },
            },
          },
        ],
      },
    ]
  `);
});

test("decodeEvents() log", async (context) => {
  const { common } = context;

  const { sources } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  // Compute Transfer event selector using starknet.js (same as getErc20IndexingBuild)
  const transferSelector = computeEventSelector(
    "src::strk::erc20_lockable::ERC20Lockable::Transfer",
  );

  // Starknet log keys: [selector, ...indexed_args]
  // Transfer event has no indexed args in our ABI, so just the selector
  const keys = [transferSelector];

  // Data contains non-indexed event args: from, to, value (u256 = low, high)
  // Starknet data is array of felt252 values
  const data = [
    zeroAddress, // from
    ALICE, // to
    toHex(parseEther("1")), // value.low
    "0x0", // value.high
  ];

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, keys }, // Starknet log format
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [LogEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toMatchObject({
    from: toHex64(zeroAddress), // Starknet uses 64-char hex (felt252)
    to: ALICE.toLowerCase(),
    value: parseEther("1"),
  });
});

test("decodeEvents() log error - unknown selector", async (context) => {
  const { common } = context;

  const { sources } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  // Use an unknown event selector that isn't in the ABI
  const unknownSelector =
    "0x0000000000000000000000000000000000000000000000000000000000000123";
  const keys = [unknownSelector];

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: {
      data: [zeroAddress, ALICE, toHex(parseEther("1")), "0x0"],
      keys,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [LogEvent];

  // Should return 0 events because the selector doesn't match any known event
  expect(events).toHaveLength(0);
});

test("decodeEvents() block", async (context) => {
  const { common } = context;

  const { sources } = getBlocksIndexingBuild({
    interval: 1,
  });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {
      number: 1n,
    } as RawEvent["block"],
    transaction: undefined,
    log: undefined,
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [BlockEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.block).toMatchObject({
    number: 1n,
  });
});

test("decodeEvents() transfer", async (context) => {
  const { common } = context;

  const { sources } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 3,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      gas: 0n,
      gasUsed: 0n,
      input: "0x0",
      output: "0x0",
      value: parseEther("1"),
      traceIndex: 0,
      subcalls: 0,
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [TransferEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.transfer).toMatchObject({
    from: ALICE,
    to: BOB,
    value: parseEther("1"),
  });
  expect(events[0].name).toBe("Accounts:transfer:from");
});

test("decodeEvents() transaction", async (context) => {
  const { common } = context;

  const { sources } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: undefined,
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [TransferEvent];

  expect(events).toHaveLength(1);

  expect(events[0].name).toBe("Accounts:transaction:to");
});

// TODO: Skip - trace decoding uses EVM-style selector extraction and viem's decodeFunctionData
// Needs proper Starknet implementation to handle Cairo function calls
test.skip("decodeEvents() trace", async (context) => {
  const { common } = context;

  const { sources } = getErc20IndexingBuild({
    address: zeroAddress,
    includeCallTraces: true,
  });

  // Compute transfer function selector (same as in getErc20IndexingBuild)
  const transferSelector = computeEventSelector("transfer");

  // Starknet calldata format: [selector, ...args]
  // transfer(recipient, amount) where amount is u256 (low, high)
  const input = transferSelector; // First element is selector
  const calldata = [
    BOB, // recipient
    toHex(parseEther("1")), // amount.low
    "0x0", // amount.high
  ];

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      input, // Function selector
      calldata, // Function arguments
      output: "0x1", // true in felt
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceIndex: 0,
      subcalls: 0,
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [TraceEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toStrictEqual([BOB, parseEther("1")]);
  expect(events[0].event.result).toBe(true);
  expect(events[0].name).toBe("Erc20.transfer()");
});

// TODO: Skip - uses EVM-style encodeFunctionData, Cairo functions have different encoding
test.skip("decodeEvents() trace w/o output", async (context) => {
  const { common } = context;

  const { sources } = getErc20IndexingBuild({
    address: zeroAddress,
    includeCallTraces: true,
  });

  // Remove output from the trace abi
  // @ts-ignore
  (sources[1] as ContractSource).abiFunctions.bySafeName["transfer()"]!.item.outputs = [];

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      input: encodeFunctionData({
        abi: erc20ABI,
        functionName: "transfer",
        args: [BOB, parseEther("1")],
      }),
      output: undefined,
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceIndex: 0,
      subcalls: 0,
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [TraceEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toStrictEqual([BOB, parseEther("1")]);
  expect(events[0].event.result).toBe(undefined);
  expect(events[0].name).toBe("Erc20.transfer()");
});

// TODO: Skip - uses EVM-style encodeFunctionResult, Cairo functions have different encoding
test.skip("decodeEvents() trace error", async (context) => {
  const { common } = context;

  const { sources } = getErc20IndexingBuild({
    address: zeroAddress,
    includeCallTraces: true,
  });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      input: "0x",
      output: encodeFunctionResult({
        abi: erc20ABI,
        functionName: "transfer",
        result: true,
      }),
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceIndex: 0,
      subcalls: 0,
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [TraceEvent];

  expect(events).toHaveLength(0);
});
