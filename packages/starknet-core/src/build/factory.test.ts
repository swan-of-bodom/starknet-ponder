import { expect, test } from "vitest";
import { buildLogFactory } from "./factory.js";
import { parseStarknetAbiItem } from "@/index.js";
import { computeEventSelector } from "@/utils/event-selector.js";

const llamaFactoryEventAbiItem = parseStarknetAbiItem(
  "event LlamaInstanceCreated(ContractAddress indexed deployer, ByteArray indexed name, ContractAddress llamaCore, ContractAddress llamaExecutor, ContractAddress llamaPolicy, u256 chainId)",
);

test("buildLogFactory throws if provided parameter not found in inputs", () => {
  expect(() =>
    buildLogFactory({
      address: "0xa",
      event: llamaFactoryEventAbiItem,
      parameter: "fakeParameter",
      chainId: 1,
      fromBlock: undefined,
      toBlock: undefined,
    }),
  ).toThrowError(
    "Factory event parameter not found in factory event signature. Got 'fakeParameter', expected one of ['deployer', 'name', 'llamaCore', 'llamaExecutor', 'llamaPolicy', 'chainId'].",
  );
});

test("buildLogFactory handles LlamaInstanceCreated llamaCore", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaCore",
    chainId: 1,
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address:
      "0x000000000000000000000000000000000000000000000000000000000000000a",
    eventSelector: computeEventSelector("LlamaInstanceCreated"),
    childAddressLocation: "offset0",
  });
});

test("buildLogFactory handles LlamaInstanceCreated llamaPolicy", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
    chainId: 1,
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address:
      "0x000000000000000000000000000000000000000000000000000000000000000a",
    eventSelector: computeEventSelector("LlamaInstanceCreated"),
    childAddressLocation: "offset64",
  });
});

// TODO: starknetAbiItem ?
const morphoFactoryEvent = {
  type: "event" as const,
  name: "CreateMarket",
  inputs: [
    { name: "id", type: "felt252", indexed: true },
    {
      name: "marketParams",
      type: "tuple",
      indexed: false,
      components: [
        { name: "loanToken", type: "address" },
        { name: "collateralToken", type: "address" },
        { name: "oracle", type: "address" },
        { name: "irm", type: "address" },
        { name: "lltv", type: "uint256" },
      ],
    },
  ],
};

test("buildLogFactory handles CreateMarket struct parameter", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: morphoFactoryEvent,
    parameter: "marketParams.oracle",
    chainId: 1,
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address:
      "0x000000000000000000000000000000000000000000000000000000000000000a",
    eventSelector: computeEventSelector("CreateMarket"),
    childAddressLocation: "offset64",
  });
});

// TODO: starknetAbiItem ?
const poolFactoryEvent = {
  type: "event" as const,
  name: "PoolCreated",
  inputs: [
    { name: "caller", type: "address", indexed: true },
    { name: "recipient", type: "address", indexed: true },
    { name: "currency", type: "address", indexed: false },
    {
      name: "poolKey",
      type: "tuple",
      indexed: false,
      components: [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint32" },
        { name: "tickSpacing", type: "int32" },
        { name: "hooks", type: "address" },
      ],
    },
  ],
};

test("buildLogFactory handles PoolCreated struct parameter", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: poolFactoryEvent,
    parameter: "poolKey.hooks",
    chainId: 1,
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address:
      "0x000000000000000000000000000000000000000000000000000000000000000a",
    eventSelector: computeEventSelector("PoolCreated"),
    // 32 + 128
    childAddressLocation: "offset160",
  });
});
