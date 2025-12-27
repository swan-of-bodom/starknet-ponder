// NOTE: Tried to follow Viem types to make the Starknet package as close as possible to /core

export type StarknetAbiParameter = {
  readonly name: string;
  readonly type: string;
};

// ----------------
// Cairo 0
// ----------------

/**
 * Cairo 0 event - has `inputs` array without indexed/kind markers
 *
 * At runtime:
 * - keys[0] = event selector only
 * - data[...] = ALL event parameters (nothing is indexed)
 *
 * Filtering by event args is not possible for Cairo 0 events.
 */
export type Cairo0Event = {
  readonly type: "event";
  readonly name: string;
  readonly inputs: readonly StarknetAbiParameter[];
};

// ----------------
// Cairo 1
// ----------------

export type Cairo1EventField = StarknetAbiParameter & {
  readonly kind: "key" | "data" | "nested";
};

export type Cairo1StructEvent = {
  readonly type: "event";
  readonly name: string;
  readonly kind: "struct";
  readonly members: readonly Cairo1EventField[];
};

export type Cairo1EnumEvent = {
  readonly type: "event";
  readonly name: string;
  readonly kind: "enum";
  readonly variants: readonly Cairo1EventField[];
};

export type Cairo1Event = Cairo1StructEvent | Cairo1EnumEvent;

// ----------------
// Ponder Starknet ABI
// ----------------

export type StarknetAbiEvent = Cairo0Event | Cairo1Event;

export type StarknetAbiFunction = {
  readonly type: "function" | "l1_handler" | "constructor";
  readonly name: string;
  readonly inputs: readonly { readonly name: string; readonly type: string }[];
  readonly outputs?: readonly { readonly type: string }[];
  readonly state_mutability?: "view" | "external";
};

export type StarknetAbiStruct = {
  readonly type: "struct";
  readonly name: string;
  readonly members: readonly { readonly name: string; readonly type: string }[];
};

export type StarknetAbiEnum = {
  readonly type: "enum";
  readonly name: string;
  readonly variants: readonly { readonly name: string; readonly type: string }[];
};

export type StarknetAbiInterface = {
  readonly type: "interface";
  readonly name: string;
  readonly items: readonly StarknetAbiFunction[];
};

export type StarknetAbiImpl = {
  readonly type: "impl";
  readonly name: string;
  readonly interface_name: string;
};

export type StarknetAbi = readonly (
  | StarknetAbiEvent
  | StarknetAbiFunction
  | StarknetAbiStruct
  | StarknetAbiEnum
  | StarknetAbiInterface
  | StarknetAbiImpl
)[];

// ============================================================================
// ABI Type Extraction (for starknet.js Abi type)
// ============================================================================

// Note: The types below work with starknet.js's Abi type for runtime contract interactions.
// Import as: import { type Abi as StarknetJsAbi } from "starknet";

/** Cairo1: Extract interface items from ABI */
export type ExtractInterfaceItems<TAbi extends readonly unknown[]> = Extract<
  TAbi[number],
  { type: "interface"; items: readonly any[] }
>["items"][number];

/** Cairo0: Extract top-level functions from ABI */
export type ExtractTopLevelFunctions<TAbi extends readonly unknown[]> = Extract<
  TAbi[number],
  { type: "function"; name: string }
>;

/** Extract all functions from both interface items (Cairo 1) and top-level (Cairo 0) */
export type ExtractFunctions<TAbi extends readonly unknown[]> =
  | Extract<ExtractInterfaceItems<TAbi>, { type: "function"; name: string }>
  | ExtractTopLevelFunctions<TAbi>;

/** Get a specific function by name */
export type GetFunction<
  TAbi extends readonly unknown[],
  TName extends string,
> = Extract<ExtractFunctions<TAbi>, { name: TName }>;

/** Extract struct definitions from ABI */
export type ExtractStructs<TAbi extends readonly unknown[]> = Extract<
  TAbi[number],
  { type: "struct" }
>;

/** Extract enum definitions from ABI */
export type ExtractEnums<TAbi extends readonly unknown[]> = Extract<
  TAbi[number],
  { type: "enum" }
>;

// ============================================================================
// Starknet/Cairo Type Mapping
// ============================================================================

/** Map primitive Starknet/Cairo types to TypeScript types */
export type PrimitiveTypeLookup<T extends string> =
  // Unsigned integers - starknet.js returns bigint for ALL integer types
  // https://starknetjs.com/docs/guides/contracts/define_call_message#receive-data-from-a-cairo-contract
  T extends
    | "core::integer::u8"
    | "u8"
    | "core::integer::u16"
    | "u16"
    | "core::integer::u32"
    | "u32"
    | "core::integer::u64"
    | "u64"
    | "core::integer::u128"
    | "u128"
    | "core::integer::u256"
    | "u256"
    | "core::integer::i8"
    | "i8"
    | "core::integer::i16"
    | "i16"
    | "core::integer::i32"
    | "i32"
    | "core::integer::i64"
    | "i64"
    | "core::integer::i128"
    | "i128"
    | "core::felt252"
    | "felt252"
    ? bigint
    : T extends "core::bool" | "bool"
      ? boolean
      : // Address types
        T extends
            | "core::starknet::contract_address::ContractAddress"
            | "ContractAddress"
            | "core::starknet::class_hash::ClassHash"
            | "ClassHash"
            | "core::starknet::eth_address::EthAddress"
            | "EthAddress"
            | "core::byte_array::ByteArray"
            | "ByteArray"
            | "core::bytes_31::bytes31"
            | "bytes31"
        ? string
        : // Option/Result
          T extends `core::option::Option::<${infer _Inner}>`
          ? unknown
          : T extends `core::result::Result::<${infer _Ok}, ${infer _Err}>`
            ? unknown
            : // Not a primitive - return never to signal struct/enum lookup needed
              never;

/** Map Starknet types to TypeScript types with ABI struct/enum lookup */
export type MapStarknetType<
  TAbi extends readonly unknown[],
  T extends string,
> = PrimitiveTypeLookup<T> extends never
  ? // Handle Array types
    T extends `core::array::Array::<${infer Inner}>`
    ? MapStarknetType<TAbi, Inner>[]
    : T extends `core::array::Span::<${infer Inner}>`
      ? MapStarknetType<TAbi, Inner>[]
      : // Try to find struct in ABI
        Extract<ExtractStructs<TAbi>, { name: T }> extends {
            members: infer TMembers extends readonly {
              name: string;
              type: string;
            }[];
          }
        ? {
            [M in TMembers[number] as M["name"]]: MapStarknetType<
              TAbi,
              M["type"]
            >;
          }
        : // Try to find enum in ABI (return variant names as string union)
          Extract<ExtractEnums<TAbi>, { name: T }> extends {
              variants: infer TVariants extends readonly { name: string }[];
            }
          ? TVariants[number]["name"]
          : // Unknown type - fallback to unknown
            unknown
  : // Primitive type found
    PrimitiveTypeLookup<T>;

// ============================================================================
// Function Type Utilities
// ============================================================================

/** Extract input types as a tuple for function arguments */
export type ExtractInputTypes<
  TAbi extends readonly unknown[],
  TFunc,
> = TFunc extends {
  inputs: infer TInputs extends readonly { name: string; type: string }[];
}
  ? {
      [K in keyof TInputs]: TInputs[K] extends { type: infer T extends string }
        ? MapStarknetType<TAbi, T>
        : never;
    }
  : readonly [];

/** Extract return type from function outputs */
export type ExtractReturnType<
  TAbi extends readonly unknown[],
  TFunc,
> = TFunc extends {
  outputs:
    | readonly [{ type: infer T extends string }]
    | [{ type: infer T extends string }];
}
  ? MapStarknetType<TAbi, T>
  : TFunc extends { outputs: readonly [] | [] }
    ? void
    : unknown;

/** Compute return type for readContract by function name */
export type ReadContractReturnType<
  TAbi extends readonly unknown[],
  TFunctionName extends string,
> = [TFunctionName] extends [ExtractAllFunctionNames<TAbi>]
  ? ExtractReturnType<TAbi, GetFunction<TAbi, TFunctionName>>
  : unknown;

// ============================================================================
// Function Name Extraction
// ============================================================================

/** Extract view function names from interface items (Cairo 1) */
export type ExtractViewFunctionNames<TAbi extends readonly unknown[]> = Extract<
  ExtractInterfaceItems<TAbi>,
  { type: "function"; name: string; state_mutability: "view" }
>["name"];

/** Extract external function names from interface items (Cairo 1) */
export type ExtractExternalFunctionNames<TAbi extends readonly unknown[]> =
  Extract<
    ExtractInterfaceItems<TAbi>,
    { type: "function"; name: string; state_mutability: "external" }
  >["name"];

/** Extract top-level view function names (Cairo 0) */
export type ExtractTopLevelViewFunctionNames<TAbi extends readonly unknown[]> =
  Extract<ExtractTopLevelFunctions<TAbi>, { name: string; state_mutability: "view" }>["name"];

/** Extract top-level external function names (Cairo 0) */
export type ExtractTopLevelExternalFunctionNames<
  TAbi extends readonly unknown[],
> = Extract<
  ExtractTopLevelFunctions<TAbi>,
  { name: string; state_mutability: "external" }
>["name"];

/** All callable function names (view + external from both Cairo 0 and Cairo 1) */
export type ExtractAllFunctionNames<TAbi extends readonly unknown[]> =
  | ExtractViewFunctionNames<TAbi>
  | ExtractExternalFunctionNames<TAbi>
  | ExtractTopLevelViewFunctionNames<TAbi>
  | ExtractTopLevelExternalFunctionNames<TAbi>;

// ============================================================================
// Contract Call Types (for readContract/readContracts)
// ============================================================================

/**
 * Helper type to make args required when function has inputs,
 * and optional/undefined when function has no inputs.
 */
export type RequiredArgs<TArgs> = TArgs extends readonly []
  ? { args?: undefined }
  : { args: TArgs };

/** Base type for contract function config (used for internal iteration) */
export type ContractFunctionConfigBase = {
  abi: readonly unknown[];
  address: string;
  functionName: string;
  args?: readonly unknown[];
};

/** Single contract call configuration for readContracts */
export type ContractFunctionConfig<
  TAbi extends readonly unknown[] = readonly unknown[],
  TFunctionName extends string = string,
> = {
  abi: TAbi;
  address: string;
  functionName: TFunctionName;
} & RequiredArgs<ExtractInputTypes<TAbi, GetFunction<TAbi, TFunctionName>>>;

/** Success result when allowFailure is true */
export type ReadContractSuccessResult<TResult> = {
  error?: undefined;
  result: TResult;
  status: "success";
};

/** Failure result when allowFailure is true */
export type ReadContractFailureResult = {
  error: Error;
  result?: undefined;
  status: "failure";
};

/** Result type for a single contract call based on allowFailure */
export type ReadContractResult<
  TResult,
  TAllowFailure extends boolean,
> = TAllowFailure extends true
  ? ReadContractSuccessResult<TResult> | ReadContractFailureResult
  : TResult;

/** Extract return type from a ContractFunctionConfig or ContractFunctionConfigBase */
export type ContractResultType<TContract> =
  TContract extends { abi: infer TAbi extends readonly unknown[]; functionName: infer TFunctionName extends string }
    ? ReadContractReturnType<TAbi, TFunctionName>
    : unknown;

/** Map over contracts array to get tuple of return types */
export type ReadContractsReturnType<
  TContracts extends readonly unknown[],
  TAllowFailure extends boolean,
> = {
  [K in keyof TContracts]: ReadContractResult<
    ContractResultType<TContracts[K]>,
    TAllowFailure
  >;
};
