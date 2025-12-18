import type { Prettify } from "./utils.js";
import type { Hash, Address } from "viem";

export type StarknetAbiMember = {
  name: string;
  type: string;
  kind?: "key" | "data" | "nested";
};

export type StarknetAbiEvent = {
  type: "event";
  name: string;
  kind?: "struct" | "enum";
  members?: readonly StarknetAbiMember[];
  keys?: readonly StarknetAbiMember[];
  data?: readonly StarknetAbiMember[];
  // TODO: Legacy Cairo 0 format uses `inputs` instead of `members`, not sure if this is enough
  inputs?: readonly { name: string; type: string }[];
  variants?: readonly unknown[];
};

/** Exclude Enum events */
export type IsStructEvent<TEvent> = TEvent extends { kind: "enum" }
  ? false
  : TEvent extends { variants: readonly unknown[] }
    ? false
    : true;

export type StarknetAbiStruct = {
  type: "struct";
  name: string;
  members: readonly StarknetAbiMember[];
};

export type ExtractAbiEvents<TAbi extends readonly unknown[]> = Extract<
  TAbi[number],
  { type: "event" }
>;

/**
 * Get the simple event name from full event name
 * ie. "openzeppelin::token::erc20::ERC20::Transfer" → "Transfer"
 */
export type GetEventName<TEvent extends StarknetAbiEvent> =
  TEvent["name"] extends `${string}::${infer Name}`
    ? Name extends `${string}::${infer Rest}`
      ? GetEventName<{ type: "event"; name: Rest }>
      : Name
    : TEvent["name"];

/** Extract all struct definitions from a Starknet ABI */
export type ExtractAbiStructs<TAbi extends readonly unknown[]> = Extract<
  TAbi[number],
  { type: "struct" }
>;

/** Find a struct definition by name in the ABI */
type FindStructByName<
  TAbi extends readonly unknown[],
  TName extends string,
> = Extract<ExtractAbiStructs<TAbi>, { name: TName }>;

/** Lookup and resolve a struct type from the ABI */
type LookupStructType<
  TName extends string,
  TAbi extends readonly unknown[],
> = FindStructByName<TAbi, TName> extends StarknetAbiStruct
  ? Prettify<MembersToObject<FindStructByName<TAbi, TName>["members"], TAbi>>
  : any;

/**
 * Extract event argument types from a Starknet ABI event
 * Converts members array to a typed object
 * Supports Cairo 1 (members), alternate (data), and legacy (inputs) formats
 *
 * Note: Uses TEvent["field"] extends X pattern instead of TEvent extends { field: X }
 * because the latter matches when field is undefined due to optional property handling
 */
export type ExtractEventArgs<
  TEvent extends StarknetAbiEvent,
  TAbi extends readonly unknown[] = readonly unknown[],
> = TEvent["members"] extends readonly StarknetAbiMember[]
  ? Prettify<MembersToObject<TEvent["members"], TAbi>>
  : TEvent["data"] extends readonly StarknetAbiMember[]
    ? Prettify<MembersToObject<TEvent["data"], TAbi>>
    : TEvent["inputs"] extends readonly { name: string; type: string }[]
      ? Prettify<InputsToObject<TEvent["inputs"], TAbi>>
      : Record<string, any>;

/** Convert ABI members array to a typed object */
type MembersToObject<
  TMembers extends readonly StarknetAbiMember[],
  TAbi extends readonly unknown[],
> = {
  [K in TMembers[number] as K["name"]]: StarknetTypeToTS<K["type"], TAbi>;
};

/**
 * Convert ABI inputs array to a typed object (for legacy Cairo 0 format)
 * More permissive - only requires name and type fields
 */
type InputsToObject<
  TInputs extends readonly { name: string; type: string }[],
  TAbi extends readonly unknown[],
> = {
  [K in TInputs[number] as K["name"]]: StarknetTypeToTS<K["type"], TAbi>;
};

// TODO: Improve this
type StarknetTypeToTS<
  T extends string,
  TAbi extends readonly unknown[] = readonly unknown[],
> = T extends "core::integer::u256" | "u256" // Primitives
  ? bigint
  : T extends "core::integer::u128" | "u128"
    ? bigint
    : T extends "core::integer::u64" | "u64"
      ? bigint
      : T extends "core::integer::u32" | "u32"
        ? number
        : T extends "core::integer::u16" | "u16"
          ? number
          : T extends "core::integer::u8" | "u8"
            ? number
            : T extends "core::felt252" | "felt252"
              ? string
              : T extends
                    | "core::starknet::contract_address::ContractAddress"
                    | "ContractAddress"
                ? Address
                : T extends
                      | "core::starknet::class_hash::ClassHash"
                      | "ClassHash"
                  ? Hash
                  : T extends "core::bool"
                    ? boolean
                    : T extends
                          | "core::byte_array::ByteArray"
                          | "ByteArray"
                      ? string
                      : // Handle Array types: core::array::Array::<T> or Array<T>
                        T extends `core::array::Array::<${infer Inner}>`
                        ? StarknetTypeToTS<Inner, TAbi>[]
                        : T extends `core::array::Span::<${infer Inner}>`
                          ? StarknetTypeToTS<Inner, TAbi>[]
                          : T extends `Array<${infer Inner}>`
                            ? StarknetTypeToTS<Inner, TAbi>[]
                            : T extends `Span<${infer Inner}>`
                              ? StarknetTypeToTS<Inner, TAbi>[]
                              : // Check if it's a custom struct type
                                T extends string
                                ? LookupStructType<T, TAbi>
                                : any;

/**
 * Get all event names from a Starknet ABI as union of strings
 * ie. "Transfer" | "Approval" | etc.
 */
export type SafeEventNames<TAbi extends readonly unknown[]> =
  ExtractAbiEvents<TAbi> extends infer Events
    ? Events extends StarknetAbiEvent
      ? IsStructEvent<Events> extends true
        ? GetEventName<Events>
        : never
      : never
    : never;

/**
 * Format event names with contract prefix
 * "Token" + ["Transfer", "Approval"] → "Token:Transfer" | "Token:Approval"
 */
export type FormatEventNames<
  TContractName extends string,
  TEventNames extends string,
> = `${TContractName}:${TEventNames}`;

/**
 * Find an event in the ABI by its simple name
 * NOTE: replaced infer pattern with [X] extends [never] to preserve literal types
 * TODO: This still needs more checking, for some reason some cairo0 ABIs fail?
 */
export type FindEventByName<
  TAbi extends readonly unknown[],
  TEventName extends string,
> = [Extract<ExtractAbiEvents<TAbi>, { name: `${string}::${TEventName}` }>] extends [never]
  ? Extract<ExtractAbiEvents<TAbi>, { name: TEventName }>
  : Extract<ExtractAbiEvents<TAbi>, { name: `${string}::${TEventName}` }>;

/** Get event args for a specific event name from an ABI */
export type GetEventArgs<
  TAbi extends readonly unknown[],
  TEventName extends string,
> = FindEventByName<TAbi, TEventName> extends StarknetAbiEvent
  ? ExtractEventArgs<FindEventByName<TAbi, TEventName>, TAbi>
  : Record<string, any>;
