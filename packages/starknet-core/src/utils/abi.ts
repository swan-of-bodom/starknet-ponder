/**
 * Starknet ABI Utilities
 *
 * Provides utilities for building event/function metadata from Starknet ABIs.
 */

import { computeEventSelector } from "./event-selector.js";
import { getDuplicateElements } from "./duplicates.js";
import type { Hex } from "./hex.js";
import type {
  StarknetAbi,
  StarknetAbiEvent,
  StarknetAbiFunction,
} from "@/types/starknetAbi.js";
import type { Config } from "../config/index.js";

/**
 * Fix issue with Array.isArray not checking readonly arrays
 * {@link https://github.com/microsoft/TypeScript/issues/17002}
 */
declare global {
  interface ArrayConstructor {
    isArray(arg: ReadonlyArray<any> | any): arg is ReadonlyArray<any>;
  }
}

// ============================================================================
// Event Metadata Types
// ============================================================================

type AbiEventMeta = {
  // Event name (if no overloads) or full event name (if name is overloaded).
  safeName: string;
  // Event signature (for Starknet, this is just the event name)
  signature: string;
  // Starknet keccak hash of the event name
  selector: Hex;
  // ABI item used for decoding event data
  item: StarknetAbiEvent;
};

export type AbiEvents = {
  bySafeName: { [key: string]: AbiEventMeta | undefined };
  bySelector: { [key: string]: AbiEventMeta | undefined };
};

// ============================================================================
// Function Metadata Types
// ============================================================================

type AbiFunctionMeta = {
  // Function name (if no overloads) or full function name (if name is overloaded).
  safeName: string;
  // Function signature (for Starknet, this is just the function name)
  signature: string;
  // Starknet keccak hash of the function name
  selector: string;
  // ABI item used for decoding function data
  item: StarknetAbiFunction;
};

export type AbiFunctions = {
  bySafeName: { [key: string]: AbiFunctionMeta | undefined };
  bySelector: { [key: string]: AbiFunctionMeta | undefined };
};

// ============================================================================
// Build ABI Events
// ============================================================================

/**
 * Build event metadata from a Starknet ABI
 * Returns event metadata in a structured format
 *
 * Note: Only struct events (kind: "struct") are included because they emit with their own selectors.
 * Enum events (kind: "enum") are containers for event variants and don't emit their own events.
 * - Nested variants in enums emit with selector from the variant name
 * - Flat variants in enums emit with the inner event's selector
 */
export function buildAbiEvents({ abi }: { abi: StarknetAbi }): AbiEvents {
  // Filter for struct events only - enum events are containers, not actual emittable events
  // Enum events have kind: "enum" and contain variants (nested or flat)
  // Struct events have kind: "struct" and contain members (key or data)
  const events = abi.filter((item): item is StarknetAbiEvent => {
    if (item.type !== "event") return false;
    // Skip enum events - they're containers, not actual events
    // Enum events have "kind": "enum" and "variants" array
    const abiItem = item as any;
    if (abiItem.kind === "enum" || abiItem.variants !== undefined) {
      return false;
    }
    return true;
  });

  const overloadedEventNames = getDuplicateElements(
    events.map((item) => item.name),
  );

  return events.reduce<AbiEvents>(
    (acc, item) => {
      // For Starknet, the signature is just the event name
      // Extract simple name (last part after ::)
      const simpleName = item.name.split("::").pop() || item.name;
      const signature = simpleName;

      const safeName = overloadedEventNames.has(simpleName)
        ? item.name // Use full name if there are overloads
        : simpleName;

      const selector = computeEventSelector(item.name);

      const abiEventMeta = { safeName, signature, selector, item };

      acc.bySafeName[safeName] = abiEventMeta;
      acc.bySelector[selector] = abiEventMeta;

      return acc;
    },
    { bySafeName: {}, bySelector: {} },
  );
}

// ============================================================================
// Build ABI Functions
// ============================================================================

/**
 * Build function metadata from a Starknet ABI
 * Returns function metadata in a structured format
 */
export function buildAbiFunctions({
  abi,
}: {
  abi: StarknetAbi;
}): AbiFunctions {
  const functions = abi.filter(
    (item): item is StarknetAbiFunction =>
      item.type === "function" ||
      item.type === "l1_handler" ||
      item.type === "constructor",
  );

  const overloadedFunctionNames = getDuplicateElements(
    functions.map((item) => item.name),
  );

  return functions.reduce<AbiFunctions>(
    (acc, item) => {
      // For Starknet, the signature is just the function name
      // Extract simple name (last part after ::)
      const simpleName = item.name.split("::").pop() || item.name;
      const signature = simpleName;

      const safeName = overloadedFunctionNames.has(simpleName)
        ? item.name // Use full name if there are overloads
        : `${simpleName}()`;

      const selector = computeEventSelector(item.name); // Uses same selector computation as events

      const abiFunctionMeta = { safeName, signature, selector, item };

      acc.bySafeName[safeName] = abiFunctionMeta;
      acc.bySelector[selector] = abiFunctionMeta;

      return acc;
    },
    { bySafeName: {}, bySelector: {} },
  );
}

// ============================================================================
// Build Topics (for event filtering)
// ============================================================================

/**
 * Finds a Cairo event by name in the ABI.
 */
const findCairoEvent = (
  abi: StarknetAbi,
  eventName: string,
): StarknetAbiEvent | undefined => {
  return abi.find(
    (item): item is StarknetAbiEvent =>
      item.type === "event" && item.name === eventName,
  );
};

/**
 * Gets the key (indexed) members from a Cairo event.
 * - Cairo 1 struct events: members with kind === "key"
 * - Cairo 1 enum events: not supported for filtering
 * - Cairo 0 events: no indexed params (only selector is in keys)
 */
const getKeyMembers = (
  event: StarknetAbiEvent,
): { name: string; type: string }[] => {
  // Cairo 1 struct event
  if ("members" in event && event.members) {
    return event.members
      .filter((m: any) => m.kind === "key")
      .map((m: any) => ({ name: m.name, type: m.type }));
  }
  // Cairo 0 or enum events don't support filtering by args
  return [];
};

/**
 * Builds topics for Cairo event filters.
 *
 * Cairo events use:
 * - topic0: starknet_keccak(event_name) - just the name, not full signature
 * - topic1+: "key" members from the event (indexed parameters)
 */
export function buildTopics(
  abi: StarknetAbi,
  filter: NonNullable<Config["contracts"][string]["filter"]>,
): {
  topic0: Hex;
  topic1: Hex | Hex[] | null;
  topic2: Hex | Hex[] | null;
  topic3: Hex | Hex[] | null;
}[] {
  const filters = Array.isArray(filter) ? filter : [filter];

  const topics = filters.map((f) => {
    const cairoEvent = findCairoEvent(abi, f.event);

    if (!cairoEvent) {
      throw new Error(`Event '${f.event}' not found in ABI`);
    }

    // topic0 is the event selector (starknet_keccak of event name)
    const topic0 = computeEventSelector(cairoEvent.name);

    // Get key members (indexed parameters) from the Cairo event
    const keyMembers = getKeyMembers(cairoEvent);

    // Build topic1, topic2, topic3 from filter args
    let topic1: Hex | Hex[] | null = null;
    let topic2: Hex | Hex[] | null = null;
    let topic3: Hex | Hex[] | null = null;

    if (f.args) {
      // Args can be positional (array) or named (object)
      if (Array.isArray(f.args)) {
        // Positional args: [value1, value2, ...]
        if (f.args[0] !== undefined) topic1 = f.args[0] as Hex | Hex[];
        if (f.args[1] !== undefined) topic2 = f.args[1] as Hex | Hex[];
        if (f.args[2] !== undefined) topic3 = f.args[2] as Hex | Hex[];
      } else {
        // Named args: { argName: value, ... }
        // Map arg names to their position in key members
        keyMembers.forEach((member, index) => {
          const argValue = (f.args as Record<string, unknown>)[member.name];
          if (argValue !== undefined) {
            const value = argValue as Hex | Hex[];
            if (index === 0) topic1 = value;
            else if (index === 1) topic2 = value;
            else if (index === 2) topic3 = value;
          }
        });
      }
    }

    return { topic0, topic1, topic2, topic3 };
  });

  return topics;
}

// ============================================================================
// Parse Starknet ABI Item (for factory patterns)
// ============================================================================

/**
 * Parsed Starknet ABI event with EVM-compatible structure (base type)
 */
export type ParsedStarknetAbiEvent = {
  readonly type: "event";
  readonly name: string;
  readonly inputs: readonly {
    readonly name: string;
    readonly type: string;
    readonly indexed: boolean;
  }[];
};

/**
 * Type-level Starknet ABI signature parser (similar to abitype's parseAbiItem)
 */

// Normalize Starknet types to EVM types at type level
type NormalizeStarknetType<T extends string> = T extends "ContractAddress"
  ? "address"
  : T extends "felt252" | "felt"
    ? "uint256"
    : T extends "u8"
      ? "uint8"
      : T extends "u16"
        ? "uint16"
        : T extends "u32"
          ? "uint32"
          : T extends "u64"
            ? "uint64"
            : T extends "u128"
              ? "uint128"
              : T extends "u256"
                ? "uint256"
                : T extends "i8"
                  ? "int8"
                  : T extends "i16"
                    ? "int16"
                    : T extends "i32"
                      ? "int32"
                      : T extends "i64"
                        ? "int64"
                        : T extends "i128"
                          ? "int128"
                          : T extends "bool"
                            ? "bool"
                            : T extends "bytes"
                              ? "bytes"
                              : T extends
                                    | "ByteArray"
                                    | "core::byte_array::ByteArray"
                                ? "string"
                                : T;

// Parse a single parameter: "Type name" or "Type indexed name"
type ParseParam<T extends string> =
  T extends `${infer Type} indexed ${infer Name}`
    ? {
        readonly name: Name;
        readonly type: NormalizeStarknetType<Type>;
        readonly indexed: true;
      }
    : T extends `indexed ${infer Type} ${infer Name}`
      ? {
          readonly name: Name;
          readonly type: NormalizeStarknetType<Type>;
          readonly indexed: true;
        }
      : T extends `${infer Type} ${infer Name}`
        ? {
            readonly name: Name;
            readonly type: NormalizeStarknetType<Type>;
            readonly indexed: false;
          }
        : never;

// Split comma-separated params recursively
type SplitParams<
  T extends string,
  Acc extends readonly any[] = [],
> = T extends `${infer First},${infer Rest}`
  ? SplitParams<Rest, [...Acc, ParseParam<Trim<First>>]>
  : T extends ""
    ? Acc
    : [...Acc, ParseParam<Trim<T>>];

// Trim whitespace
type Trim<T extends string> = T extends ` ${infer R}`
  ? Trim<R>
  : T extends `${infer R} `
    ? Trim<R>
    : T;

// Parse event signature
type ParseEventSignature<T extends string> =
  T extends `event ${infer Name}(${infer Params})`
    ? {
        readonly type: "event";
        readonly name: Trim<Name>;
        readonly inputs: SplitParams<Params>;
      }
    : never;

// Main type-level parser
export type ParseStarknetAbiItem<T extends string> = ParseEventSignature<
  Trim<T>
>;

/**
 * Valid Starknet core types (inspired by starkweb)
 * Supports both short and full forms
 */
const STARKNET_TYPE_MAP: Record<string, string> = {
  // ContractAddress types
  ContractAddress: "address",
  contract_address: "address",
  "core::starknet::contract_address::ContractAddress": "address",

  // Unsigned integer types
  u8: "uint8",
  "core::integer::u8": "uint8",
  u16: "uint16",
  "core::integer::u16": "uint16",
  u32: "uint32",
  "core::integer::u32": "uint32",
  u64: "uint64",
  "core::integer::u64": "uint64",
  u128: "uint128",
  "core::integer::u128": "uint128",
  u256: "uint256",
  "core::integer::u256": "uint256",

  // Signed integer types
  i8: "int8",
  "core::integer::i8": "int8",
  i16: "int16",
  "core::integer::i16": "int16",
  i32: "int32",
  "core::integer::i32": "int32",
  i64: "int64",
  "core::integer::i64": "int64",
  i128: "int128",
  "core::integer::i128": "int128",

  // Felt types
  felt: "felt252",
  felt252: "felt252",
  "core::felt252": "felt252",

  // Boolean
  bool: "bool",
  "core::bool": "bool",

  // ByteArray types (decoded as strings at runtime)
  ByteArray: "string",
  "core::byte_array::ByteArray": "string",
};

/**
 * Helper to normalize Starknet types to EVM-compatible types
 * This is needed for compatibility with the factory pattern
 *
 * Supports both short forms (u32, ContractAddress) and full forms (core::integer::u32)
 */
function normalizeStarknetType(starknetType: string): string {
  return STARKNET_TYPE_MAP[starknetType] || starknetType;
}

/**
 * Parse a Starknet ABI item string (similar to abitype's parseAbiItem but for Starknet)
 */
export function parseStarknetAbiItem<const TSignature extends string>(
  signature: TSignature,
): ParseStarknetAbiItem<TSignature> {
  // Check if it's an event
  const eventMatch = signature.trim().match(/^event\s+(\w+)\s*\((.*)\)\s*$/);
  if (!eventMatch) throw new Error(`Unsupported ABI item type: ${signature}`);

  const [, name, paramsStr] = eventMatch;

  // Type guard: name is always defined from the regex match
  if (!name) throw new Error("Failed to parse event name");

  if (!paramsStr || !paramsStr.trim()) {
    // Empty parameters
    return {
      type: "event",
      name,
      inputs: [],
    } as unknown as ParseStarknetAbiItem<TSignature>;
  }

  // Parse parameters
  const params = paramsStr.split(",").map((param) => {
    const parts = param.trim().split(/\s+/);
    let type: string | undefined;
    let paramName: string | undefined;
    let indexed = false;

    if (parts.length === 2) {
      // ie. "ContractAddress token0"
      [type, paramName] = parts;
    } else if (parts.length === 3 && parts[1] === "indexed") {
      // ie. "ContractAddress indexed token0"
      [type, , paramName] = parts;
      indexed = true;
    } else {
      throw new Error(`Invalid parameter format: ${param}`);
    }

    if (!type || !paramName)
      throw new Error(`Invalid parameter format: ${param}`);

    // Normalize Starknet types to EVM-compatible types
    const normalizedType = normalizeStarknetType(type);

    return {
      name: paramName,
      type: normalizedType,
      indexed,
    };
  });

  return {
    type: "event",
    name,
    inputs: params,
  } as ParseStarknetAbiItem<TSignature>;
}
