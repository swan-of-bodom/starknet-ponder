import { test, expectTypeOf } from "vitest";
import type {
  SafeStarknetEventNames,
  StarknetFilterArgs,
  GetStarknetEventFilter,
  FindStarknetEvent,
  StarknetIndexedParams,
} from "../config/utilityTypes.js";

// ============================================================================
// Test ABIs
// ============================================================================

// Cairo 1 ABI (modern) - has `members` with `kind: "key" | "data"` markers
const cairo1Abi = [
  {
    type: "event",
    name: "openzeppelin::token::erc20::ERC20::Transfer",
    kind: "struct",
    members: [
      { name: "from", type: "core::starknet::contract_address::ContractAddress", kind: "key" },
      { name: "to", type: "core::starknet::contract_address::ContractAddress", kind: "key" },
      { name: "value", type: "core::integer::u256", kind: "data" },
    ],
  },
  {
    type: "event",
    name: "openzeppelin::token::erc20::ERC20::Approval",
    kind: "struct",
    members: [
      { name: "owner", type: "core::starknet::contract_address::ContractAddress", kind: "key" },
      { name: "spender", type: "core::starknet::contract_address::ContractAddress", kind: "key" },
      { name: "value", type: "core::integer::u256", kind: "data" },
    ],
  },
] as const;

// Cairo 0 ABI (legacy) - has `inputs` array without indexed markers
// At runtime: keys[0] = selector only, data[...] = ALL parameters
const cairo0Abi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "core::starknet::contract_address::ContractAddress" },
      { name: "to", type: "core::starknet::contract_address::ContractAddress" },
      { name: "value", type: "core::integer::u256" },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "core::starknet::contract_address::ContractAddress" },
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "value", type: "core::integer::u256" },
    ],
  },
] as const;

// ============================================================================
// Cairo 1 Tests - Full filter support with typed args
// ============================================================================

test("SafeStarknetEventNames extracts Cairo 1 event names", () => {
  type EventNames = SafeStarknetEventNames<typeof cairo1Abi>;
  expectTypeOf<EventNames>().toEqualTypeOf<"Transfer" | "Approval">();
});

test("FindStarknetEvent finds Cairo 1 event by simple name", () => {
  type TransferEvent = FindStarknetEvent<typeof cairo1Abi, "Transfer">;
  expectTypeOf<TransferEvent>().toMatchTypeOf<{
    type: "event";
    name: "openzeppelin::token::erc20::ERC20::Transfer";
    kind: "struct";
  }>();
});

test("StarknetIndexedParams extracts Cairo 1 indexed params (kind: key)", () => {
  type TransferEvent = FindStarknetEvent<typeof cairo1Abi, "Transfer">;
  type IndexedParams = StarknetIndexedParams<TransferEvent>;
  expectTypeOf<IndexedParams>().toEqualTypeOf<"from" | "to">();
});

test("StarknetFilterArgs provides typed args for Cairo 1 events", () => {
  type Args = StarknetFilterArgs<typeof cairo1Abi, "Transfer">;
  expectTypeOf<Args>().toMatchTypeOf<{
    from?: `0x${string}` | readonly `0x${string}`[] | null | undefined;
    to?: `0x${string}` | readonly `0x${string}`[] | null | undefined;
  }>();
});

test("GetStarknetEventFilter provides full filter type for Cairo 1", () => {
  type Filter = GetStarknetEventFilter<typeof cairo1Abi>;
  expectTypeOf<Filter>().toMatchTypeOf<{
    filter?: {
      event: "Transfer" | "Approval";
      args?: object;
    } | {
      event: "Transfer" | "Approval";
      args?: object;
    }[];
  }>();
});

// ============================================================================
// Cairo 0 Tests - Event name autocomplete only, NO filter args (no indexed params)
// ============================================================================

test("SafeStarknetEventNames extracts Cairo 0 event names", () => {
  type EventNames = SafeStarknetEventNames<typeof cairo0Abi>;
  expectTypeOf<EventNames>().toEqualTypeOf<"Transfer" | "Approval">();
});

test("FindStarknetEvent finds Cairo 0 event by name", () => {
  type TransferEvent = FindStarknetEvent<typeof cairo0Abi, "Transfer">;
  expectTypeOf<TransferEvent>().toMatchTypeOf<{
    type: "event";
    name: "Transfer";
    inputs: readonly any[];
  }>();
});

test("StarknetIndexedParams returns never for Cairo 0 (no indexed params)", () => {
  type TransferEvent = FindStarknetEvent<typeof cairo0Abi, "Transfer">;
  type IndexedParams = StarknetIndexedParams<TransferEvent>;
  expectTypeOf<IndexedParams>().toEqualTypeOf<never>();
});

test("StarknetFilterArgs returns empty object for Cairo 0 events", () => {
  type Args = StarknetFilterArgs<typeof cairo0Abi, "Transfer">;
  expectTypeOf<Args>().toEqualTypeOf<Record<string, never>>();
});

test("GetStarknetEventFilter provides filter type for Cairo 0 (event only, no args)", () => {
  type Filter = GetStarknetEventFilter<typeof cairo0Abi>;
  expectTypeOf<Filter>().toMatchTypeOf<{
    filter?: {
      event: "Transfer" | "Approval";
      args?: object;
    } | {
      event: "Transfer" | "Approval";
      args?: object;
    }[];
  }>();
});
