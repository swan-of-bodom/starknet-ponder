import type { Common } from "@/internal/common.js";
import type { Chain, IndexingBuild, SetupEvent } from "@/internal/types.js";
import type { Event } from "@/internal/types.js";
import type { RequestParameters } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import {
  RpcProvider,
  Contract,
  selector,
  CallData,
  type Abi as StarknetAbi,
  type GetBlockResponse,
  type GetTransactionReceiptResponse,
  type GetTransactionResponse,
  BlockTag,
  type BlockIdentifier,
} from "starknet";
import {
  getProfilePatternKey,
  recordProfilePattern,
  recoverProfilePattern,
} from "./profile.js";

// ============================================================================
// ABI Type Extraction
// ============================================================================

// Cairo1
type ExtractInterfaceItems<TAbi extends StarknetAbi> = Extract<
  TAbi[number],
  { type: "interface"; items: readonly any[] }
>["items"][number];

// Cairo0
type ExtractTopLevelFunctions<TAbi extends StarknetAbi> = Extract<
  TAbi[number],
  { type: "function" }
>;

/** Extract all functions from both interface items (Cairo 1) and top-level (Cairo 0) */
type ExtractFunctions<TAbi extends StarknetAbi> =
  | Extract<ExtractInterfaceItems<TAbi>, { type: "function" }>
  | ExtractTopLevelFunctions<TAbi>;

/** Get a specific function by name */
type GetFunction<TAbi extends StarknetAbi, TName extends string> = Extract<
  ExtractFunctions<TAbi>,
  { name: TName }
>;

/** Extract struct definitions from ABI */
type ExtractStructs<TAbi extends StarknetAbi> = Extract<
  TAbi[number],
  { type: "struct" }
>;

/** Extract enum definitions from ABI */
type ExtractEnums<TAbi extends StarknetAbi> = Extract<
  TAbi[number],
  { type: "enum" }
>;

// ============================================================================
// Starknet Type Mapping
// ============================================================================

// TODO: Use types.ts ?

/** Map primitive Starknet/Cairo types to TypeScript types */
type PrimitiveTypeLookup<T extends string> =
  // Unsigned integers - starknet.js returns bigint for ALL integer types
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
    ? bigint
    : // Signed integers - starknet.js returns bigint for ALL integer types
      T extends
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
      ? bigint
      : // Core types
        T extends "core::felt252" | "felt252"
                          ? bigint
                          : T extends "core::bool" | "bool"
                            ? boolean
                            : // Address types
                              T extends
                                  | "core::starknet::contract_address::ContractAddress"
                                  | "ContractAddress"
                              ? string
                              : T extends
                                    | "core::starknet::class_hash::ClassHash"
                                    | "ClassHash"
                                ? string
                                : T extends
                                      | "core::starknet::eth_address::EthAddress"
                                      | "EthAddress"
                                  ? string
                                  : // String types
                                    T extends
                                        | "core::byte_array::ByteArray"
                                        | "ByteArray"
                                    ? string
                                    : T extends
                                          | "core::bytes_31::bytes31"
                                          | "bytes31"
                                      ? string
                                      : // Option/Result - simplified to the inner type or undefined
                                        T extends `core::option::Option::<${infer _Inner}>`
                                        ? unknown
                                        : T extends `core::result::Result::<${infer _Ok}, ${infer _Err}>`
                                          ? unknown
                                          : // Not a primitive - return never to signal struct/enum lookup needed
                                            never;

/**
 * Map Starknet types to TypeScript types with ABI struct/enum lookup
 */
type MapStarknetType<
  TAbi extends StarknetAbi,
  T extends string,
> = PrimitiveTypeLookup<T> extends never // First check primitives
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
// Functions
// ============================================================================

/** Extract input types as a tuple for function arguments */
type ExtractInputTypes<TAbi extends StarknetAbi, TFunc> = TFunc extends {
  inputs: infer TInputs extends readonly { name: string; type: string }[];
}
  ? {
      [K in keyof TInputs]: TInputs[K] extends { type: infer T extends string }
        ? MapStarknetType<TAbi, T>
        : never;
    }
  : readonly [];

/** Extract return type from function outputs */
type ExtractReturnType<TAbi extends StarknetAbi, TFunc> = TFunc extends {
  outputs: readonly [{ type: infer T extends string }] | [{ type: infer T extends string }];
}
  ? MapStarknetType<TAbi, T>
  : TFunc extends { outputs: readonly [] | [] }
    ? void
    : unknown;

/** Compute return type for readContract by function name */
type ReadContractReturnType<
  TAbi extends StarknetAbi,
  TFunctionName extends string,
> = [TFunctionName] extends [ExtractAllFunctionNames<TAbi>]
  ? ExtractReturnType<TAbi, GetFunction<TAbi, TFunctionName>>
  : unknown;

// ============================================================================
// ReadContracts Types (multicall-like batch reads)
// ============================================================================

/** Single contract call configuration for readContracts */
export type ContractFunctionConfig<
  TAbi extends StarknetAbi = StarknetAbi,
  TFunctionName extends string = string,
> = {
  abi: TAbi;
  address: string;
  functionName: TFunctionName;
  args?: readonly unknown[];
};

/** Success result when allowFailure is true */
type ReadContractSuccessResult<TResult> = {
  status: "success";
  result: TResult;
};

/** Failure result when allowFailure is true */
type ReadContractFailureResult = {
  status: "failure";
  error: Error;
};

/** Result type for a single contract call based on allowFailure */
type ReadContractResult<TResult, TAllowFailure extends boolean> =
  TAllowFailure extends true
    ? ReadContractSuccessResult<TResult> | ReadContractFailureResult
    : TResult;

/** Extract return type from a ContractFunctionConfig */
type ContractResultType<TContract> = TContract extends ContractFunctionConfig<
  infer TAbi,
  infer TFunctionName
>
  ? ReadContractReturnType<TAbi, TFunctionName>
  : unknown;

/** Map over contracts array to get tuple of return types */
type ReadContractsReturnType<
  TContracts extends readonly ContractFunctionConfig[],
  TAllowFailure extends boolean,
> = {
  [K in keyof TContracts]: ReadContractResult<
    ContractResultType<TContracts[K]>,
    TAllowFailure
  >;
};

/** Extract view function names from interface items (Cairo 1) */
type ExtractViewFunctionNames<TAbi extends StarknetAbi> = Extract<
  ExtractInterfaceItems<TAbi>,
  { type: "function"; state_mutability: "view" }
>["name"];

/** Extract external function names from interface items (Cairo 1) */
type ExtractExternalFunctionNames<TAbi extends StarknetAbi> = Extract<
  ExtractInterfaceItems<TAbi>,
  { type: "function"; state_mutability: "external" }
>["name"];

/** Extract top-level view function names (Cairo 0) */
type ExtractTopLevelViewFunctionNames<TAbi extends StarknetAbi> = Extract<
  ExtractTopLevelFunctions<TAbi>,
  { state_mutability: "view" }
>["name"];

/** Extract top-level external function names (Cairo 0) */
type ExtractTopLevelExternalFunctionNames<TAbi extends StarknetAbi> = Extract<
  ExtractTopLevelFunctions<TAbi>,
  { state_mutability: "external" }
>["name"];

/** All callable function names (view + external from both Cairo 0 and Cairo 1) */
type ExtractAllFunctionNames<TAbi extends StarknetAbi> =
  | ExtractViewFunctionNames<TAbi>
  | ExtractExternalFunctionNames<TAbi>
  | ExtractTopLevelViewFunctionNames<TAbi>
  | ExtractTopLevelExternalFunctionNames<TAbi>;

// ============================================================================
// Profile Types (for RPC request profiling/caching)
// ============================================================================

/**
 * ReadContract parameters for profiling
 */
type ReadContractParameters = {
  abi: StarknetAbi;
  address: string;
  functionName: string;
  args?: unknown[];
};

/**
 * RPC request for profiling/caching
 */
export type ProfileRequest = Pick<
  ReadContractParameters,
  "abi" | "address" | "functionName" | "args"
> & { blockNumber: bigint | "latest"; chainId: number };

/** @deprecated Use ProfileRequest instead */
export type Request = ProfileRequest;

/**
 * Recorded RPC request pattern for profiling
 */
export type ProfilePattern = Pick<
  ReadContractParameters,
  "abi" | "functionName"
> & {
  address:
    | { type: "constant"; value: unknown }
    | { type: "derived"; value: string[] };
  args?: (
    | { type: "constant"; value: unknown }
    | { type: "derived"; value: string[] }
  )[];
  cache?: "immutable";
};

// ============================================================================
// Profiling
// ============================================================================

const SAMPLING_RATE = 10;
const DB_PREDICTION_THRESHOLD = 0.2;
const RPC_PREDICTION_THRESHOLD = 0.8;
const MAX_CONSTANT_PATTERN_COUNT = 10;

/** Serialized {@link ProfilePattern} for unique identification. */
type ProfileKey = string;

/** Event name. */
type EventName = string;

/**
 * Metadata about RPC request patterns for each event.
 *
 * @dev Only profile "starknet_call" requests.
 */
type Profile = Map<
  EventName,
  Map<
    ProfileKey,
    { pattern: ProfilePattern; hasConstant: boolean; count: number }
  >
>;

/**
 * LRU cache of {@link ProfilePattern} in {@link Profile} with constant args.
 *
 * @dev Used to determine which {@link ProfilePattern} should be evicted.
 */
type ProfileConstantLRU = Map<EventName, Set<ProfileKey>>;

// ============================================================================
// Typed Contract
// ============================================================================

/** Typed Contract that provides autocomplete for ABI functions with proper return types */
export type TypedContract<TAbi extends StarknetAbi> = {
  _contract: Contract;
} & {
  [K in ExtractAllFunctionNames<TAbi>]: (
    ...args: ExtractInputTypes<TAbi, GetFunction<TAbi, K>>
  ) => Promise<ExtractReturnType<TAbi, GetFunction<TAbi, K>>>;
};

export type StarknetJsClientActions = {
  /**
   * Read a contract function (viem-style API)
   * @example
   * const balance = await client.readContract({
   *   abi: erc20ABI,
   *   address: tokenAddress,
   *   functionName: "balanceOf",
   *   args: [userAddress],
   * });
   */
  readContract: <
    const TAbi extends StarknetAbi,
    const TFunctionName extends ExtractAllFunctionNames<TAbi>,
  >(params: {
    abi: TAbi;
    address: string;
    functionName: TFunctionName;
    args?: readonly unknown[];
  }) => Promise<ReadContractReturnType<TAbi, TFunctionName>>;

  /**
   * Batch multiple contract reads (similar to viem's multicall)
   * @example
   * const [balance, totalSupply, decimals] = await client.readContracts({
   *   contracts: [
   *     { abi: erc20ABI, address: token, functionName: "balanceOf", args: [user] },
   *     { abi: erc20ABI, address: token, functionName: "totalSupply" },
   *     { abi: erc20ABI, address: token, functionName: "decimals" },
   *   ],
   * });
   *
   * // With allowFailure: true (default), results are wrapped in status objects
   * const results = await client.readContracts({
   *   contracts: [...],
   *   allowFailure: true,
   * });
   * if (results[0].status === "success") console.log(results[0].result);
   */
  readContracts: <
    const TContracts extends readonly ContractFunctionConfig[],
    TAllowFailure extends boolean = true,
  >(params: {
    contracts: TContracts;
    allowFailure?: TAllowFailure;
  }) => Promise<ReadContractsReturnType<TContracts, TAllowFailure>>;

  /**
   * Create a typed Contract instance for calling view functions.
   * @example
   * const erc20 = client.contract(erc20ABI, tokenAddress);
   * const balance = await erc20.balanceOf(userAddress);
   */
  contract: <TAbi extends StarknetAbi>(
    abi: TAbi,
    address: string,
  ) => TypedContract<TAbi>;

  /** Get the underlying RpcProvider for low-level operations */
  provider: RpcProvider;

  /** Get block by number or hash */
  getBlock: (params?: {
    blockNumber?: bigint | number;
    blockHash?: string;
  }) => Promise<GetBlockResponse>;

  /** Get transaction by hash */
  getTransaction: (params: {
    hash: string;
  }) => Promise<GetTransactionResponse>;

  /** Get transaction receipt */
  getTransactionReceipt: (params: {
    hash: string;
  }) => Promise<GetTransactionReceiptResponse>;

  /** Get storage at address */
  getStorageAt: (params: {
    address: string;
    key: string;
    blockNumber?: bigint | number;
  }) => Promise<string>;

  /** Get current block number */
  getBlockNumber: () => Promise<number>;

  /** Get chain ID */
  getChainId: () => Promise<string>;

  /** Get class hash at address */
  getClassHashAt: (params: {
    address: string;
    blockNumber?: bigint | number;
  }) => Promise<string>;

  /** Get nonce for address */
  getNonce: (params: {
    address: string;
    blockNumber?: bigint | number;
  }) => Promise<string>;

  /** Raw RPC request */
  request: <TResult = unknown>(params: {
    method: string;
    params?: unknown;
  }) => Promise<TResult>;
};

export type CachedStarknetJsClient = {
  getClient: (chain: Chain) => StarknetJsClientActions;
  prefetch: (params: { events: Event[] }) => Promise<void>;
  clear: () => void;
  event: Event | SetupEvent | undefined;
};

/** Starknet RPC methods that reference a block number/hash. */
const blockDependentMethods = new Set([
  "starknet_call",
  "starknet_getStorageAt",
  "starknet_getClassAt",
  "starknet_getClassHashAt",
  "starknet_getNonce",
  "starknet_getBlockWithTxs",
  "starknet_getBlockWithTxHashes",
  "starknet_getBlockTransactionCount",
]);

/** Starknet RPC methods that don't reference a block number. */
const nonBlockDependentMethods = new Set([
  "starknet_getTransactionByHash",
  "starknet_getTransactionReceipt",
  "starknet_getTransactionByBlockIdAndIndex",
  "starknet_getEvents",
  "starknet_chainId",
  "starknet_syncing",
  "starknet_getStateUpdate",
]);

/** RPC responses that are not cached. */
const UNCACHED_RESPONSES = [[], null] as unknown[];

export const getCacheKey = (request: RequestParameters) => {
  return toLowerCase(JSON.stringify(orderObject(request)));
};

/**
 * Encode a profile request into a starknet_call RPC request.
 * Similar to core's encodeRequest but for Starknet.
 */
export const encodeRequest = (request: Request) => {
  // Get function selector from name
  const entryPointSelector = selector.getSelectorFromName(request.functionName);

  // Encode calldata
  let calldata: string[] = [];
  if (request.args && request.args.length > 0) {
    // Find the function in the ABI to get input types
    const abi = request.abi as StarknetAbi;
    let functionAbi: any = undefined;

    for (const item of abi) {
      if (item.type === "function" && item.name === request.functionName) {
        functionAbi = item;
        break;
      }
      if (item.type === "interface" && "items" in item) {
        for (const subItem of (item as any).items) {
          if (
            subItem.type === "function" &&
            subItem.name === request.functionName
          ) {
            functionAbi = subItem;
            break;
          }
        }
        if (functionAbi) break;
      }
    }

    if (functionAbi) {
      const cd = new CallData(abi);
      calldata = cd.compile(request.functionName, request.args as any);
    }
  }

  const blockId =
    request.blockNumber === "latest"
      ? "latest"
      : { block_number: Number(request.blockNumber) };

  return {
    method: "starknet_call",
    params: {
      request: {
        contract_address: request.address,
        entry_point_selector: entryPointSelector,
        calldata,
      },
      block_id: blockId,
    },
  } satisfies RequestParameters;
};

export const decodeResponse = (response: string) => {
  try {
    return JSON.parse(response);
  } catch (error) {
    return response;
  }
};

type Cache = Map<number, Map<string, Promise<string | Error> | string>>;

export const createCachedStarknetJsClient = ({
  common,
  indexingBuild,
  syncStore,
  eventCount,
}: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  syncStore: SyncStore;
  eventCount: { [eventName: string]: number };
}): CachedStarknetJsClient => {
  let event: Event | SetupEvent = undefined!;
  const cache: Cache = new Map();
  const profile: Profile = new Map();
  const profileConstantLRU: ProfileConstantLRU = new Map();

  for (const chain of indexingBuild.chains) {
    cache.set(chain.id, new Map());
  }

  // Same as core's addProfilePattern
  const addProfilePattern = ({
    pattern,
    hasConstant,
  }: { pattern: ProfilePattern; hasConstant: boolean }) => {
    const profilePatternKey = getProfilePatternKey(pattern);

    if (profile.get(event.name)!.has(profilePatternKey)) {
      profile.get(event.name)!.get(profilePatternKey)!.count++;

      if (hasConstant) {
        profileConstantLRU.get(event.name)!.delete(profilePatternKey);
        profileConstantLRU.get(event.name)!.add(profilePatternKey);
      }
    } else {
      profile
        .get(event.name)!
        .set(profilePatternKey, { pattern, hasConstant, count: 1 });

      if (hasConstant) {
        profileConstantLRU.get(event.name)!.add(profilePatternKey);
        if (
          profileConstantLRU.get(event.name)!.size > MAX_CONSTANT_PATTERN_COUNT
        ) {
          const firstKey = profileConstantLRU
            .get(event.name)!
            .keys()
            .next().value;
          if (firstKey) {
            profile.get(event.name)!.delete(firstKey);
            profileConstantLRU.get(event.name)!.delete(firstKey);
          }
        }
      }
    }
  };

  return {
    getClient(chain) {
      const rpc =
        indexingBuild.rpcs[indexingBuild.chains.findIndex((n) => n === chain)]!;

      // Create a custom fetch function that uses our RPC with caching
      const cachedRequest = async <TResult = unknown>(
        method: string,
        params?: unknown,
      ): Promise<TResult> => {
        const context = {
          logger: common.logger.child({
            action: "starknetjs request",
            event: event?.name,
          }),
        };

        const body = { method, params } as RequestParameters;

        if (
          blockDependentMethods.has(method) ||
          nonBlockDependentMethods.has(method)
        ) {
          const cacheKey = getCacheKey(body);

          // Check in-memory cache
          if (cache.get(chain.id)!.has(cacheKey)) {
            const cachedResult = cache.get(chain.id)!.get(cacheKey)!;

            if (cachedResult instanceof Promise) {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_rpc",
              });
              const result = await cachedResult;
              if (result instanceof Error) throw result;
              return JSON.parse(result);
            } else {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_database",
              });
              return JSON.parse(cachedResult);
            }
          }

          // Check database cache
          const [cachedResult] = await syncStore.getRpcRequestResults(
            { requests: [body], chainId: chain.id },
            context,
          );

          if (cachedResult !== undefined) {
            common.metrics.ponder_indexing_rpc_requests_total.inc({
              chain: chain.name,
              method,
              type: "database",
            });
            return JSON.parse(cachedResult);
          }

          // Make RPC request
          common.metrics.ponder_indexing_rpc_requests_total.inc({
            chain: chain.name,
            method,
            type: "rpc",
          });

          const response = await rpc.request(body, context);

          // Cache the response
          if (!UNCACHED_RESPONSES.includes(response)) {
            // Extract block number from request for cache keying
            const blockIdParam = getBlockIdParam(body);
            const encodedBlockNumber =
              blockIdParam === undefined
                ? undefined
                : blockIdParam === "latest"
                  ? 0
                  : typeof blockIdParam === "number"
                    ? blockIdParam
                    : undefined;

            syncStore
              .insertRpcRequestResults(
                {
                  requests: [
                    {
                      request: body,
                      blockNumber: encodedBlockNumber,
                      result: JSON.stringify(response),
                    },
                  ],
                  chainId: chain.id,
                },
                context,
              )
              .catch(() => {});
          }

          return response as TResult;
        }

        // Non-cacheable request
        return rpc.request(body, context) as Promise<TResult>;
      };

      // Create RpcProvider with custom baseFetch that uses our caching layer
      // The nodeUrl is required but our baseFetch intercepts all requests
      const provider = new RpcProvider({
        nodeUrl: "http://localhost:5050", // Placeholder, our baseFetch intercepts
        baseFetch: async (
          _url: string | globalThis.Request,
          options?: RequestInit,
        ): Promise<globalThis.Response> => {
          // Parse the JSON-RPC request from the body
          const body = JSON.parse(options?.body as string);
          const { method, params } = body;

          try {
            const result = await cachedRequest(method, params);
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          } catch (error) {
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32603,
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        },
      });

      // Helper to get block identifier
      const getBlockId = (blockNumber?: bigint | number): BlockIdentifier => {
        if (blockNumber === undefined) {
          // Use the current event's block number
          if (event?.type === "setup") {
            return event.block ? Number(event.block) : BlockTag.LATEST;
          }
          // All event types have event.event.block.number
          const eventBlockNumber = event?.event?.block?.number;
          return eventBlockNumber !== undefined
            ? Number(eventBlockNumber)
            : BlockTag.LATEST;
        }
        return typeof blockNumber === "bigint"
          ? Number(blockNumber)
          : blockNumber;
      };

      const actions: StarknetJsClientActions = {
        readContract(params) {
          const { abi, address, functionName, args = [] } = params;
          const endClock = startClock();

          // Create contract instance
          const contract = new Contract({
            abi,
            address,
            providerOrAccount: provider,
          });

          // Profile pattern recording (same logic as core's getPonderAction)
          if (
            event.type !== "setup" &&
            eventCount[event.name]! % SAMPLING_RATE === 1
          ) {
            if (profile.has(event.name) === false) {
              profile.set(event.name, new Map());
              profileConstantLRU.set(event.name, new Set());
            }

            const recordPatternResult = recordProfilePattern({
              event: event as Event,
              args: {
                address,
                abi: abi as any,
                functionName,
                args: args.length > 0 ? [...args] : undefined,
              },
              hints: Array.from(profile.get(event.name)!.values()),
            });
            if (recordPatternResult) {
              addProfilePattern(recordPatternResult);
            }
          }

          const blockId = getBlockId();

          // Retry logic (same as core's getRetryAction)
          const RETRY_COUNT = 9;
          const BASE_DURATION = 125;

          const execute = async (): Promise<any> => {
            for (let i = 0; i <= RETRY_COUNT; i++) {
              try {
                const result = await contract.call(
                  functionName,
                  [...args] as any[],
                  {
                    blockIdentifier: blockId,
                  },
                );

                // Record metrics
                common.metrics.ponder_indexing_rpc_action_duration.observe(
                  { action: "readContract" },
                  endClock(),
                );

                return result;
              } catch (error) {
                const isRetryable =
                  (error as Error)?.message?.includes("not found") ||
                  (error as Error)?.message?.includes("returned no data");

                if (!isRetryable || i === RETRY_COUNT) {
                  common.logger.warn({
                    msg: "Failed 'context.client' action",
                    action: `readContract.${functionName}`,
                    event: event.name,
                    chain: chain.name,
                    chain_id: chain.id,
                    retry_count: i,
                    error: error as Error,
                  });
                  throw error;
                }

                const duration = BASE_DURATION * 2 ** i;
                common.logger.warn({
                  msg: "Failed 'context.client' action",
                  action: `readContract.${functionName}`,
                  event: event.name,
                  chain: chain.name,
                  chain_id: chain.id,
                  retry_count: i,
                  retry_delay: duration,
                  error: error as Error,
                });
                await wait(duration);
              }
            }
            throw new Error("Exhausted retries without result");
          };

          return execute();
        },

        async readContracts(params) {
          const { contracts, allowFailure = true } = params;
          const endClock = startClock();

          // Profile pattern recording for batch (like core's multicall profiling)
          if (
            event.type !== "setup" &&
            eventCount[event.name]! % SAMPLING_RATE === 1 &&
            contracts.length < 10
          ) {
            if (profile.has(event.name) === false) {
              profile.set(event.name, new Map());
              profileConstantLRU.set(event.name, new Set());
            }

            for (const contractConfig of contracts) {
              const recordPatternResult = recordProfilePattern({
                event: event as Event,
                args: {
                  address: contractConfig.address,
                  abi: contractConfig.abi as any,
                  functionName: contractConfig.functionName,
                  args:
                    contractConfig.args && contractConfig.args.length > 0
                      ? [...contractConfig.args]
                      : undefined,
                },
                hints: Array.from(profile.get(event.name)!.values()),
              });
              if (recordPatternResult) {
                addProfilePattern(recordPatternResult);
              }
            }
          }

          const results = await Promise.all(
            contracts.map(async (contractConfig) => {
              const { abi, address, functionName, args = [] } = contractConfig;

              // Create contract instance
              const contract = new Contract({
                abi,
                address,
                providerOrAccount: provider,
              });

              const blockId = getBlockId();

              // Retry logic
              const RETRY_COUNT = 9;
              const BASE_DURATION = 125;

              for (let i = 0; i <= RETRY_COUNT; i++) {
                try {
                  const result = await contract.call(
                    functionName,
                    [...args] as any[],
                    { blockIdentifier: blockId },
                  );

                  if (allowFailure) {
                    return { status: "success" as const, result };
                  }
                  return result;
                } catch (error) {
                  const isRetryable =
                    (error as Error)?.message?.includes("not found") ||
                    (error as Error)?.message?.includes("returned no data");

                  if (!isRetryable || i === RETRY_COUNT) {
                    if (allowFailure) {
                      return {
                        status: "failure" as const,
                        error: error as Error,
                      };
                    }
                    common.logger.warn({
                      msg: "Failed 'context.client' action",
                      action: `readContracts.${functionName}`,
                      event: event.name,
                      chain: chain.name,
                      chain_id: chain.id,
                      retry_count: i,
                      error: error as Error,
                    });
                    throw error;
                  }

                  const duration = BASE_DURATION * 2 ** i;
                  common.logger.warn({
                    msg: "Failed 'context.client' action",
                    action: `readContracts.${functionName}`,
                    event: event.name,
                    chain: chain.name,
                    chain_id: chain.id,
                    retry_count: i,
                    retry_delay: duration,
                    error: error as Error,
                  });
                  await wait(duration);
                }
              }

              // Should never reach here
              if (allowFailure) {
                return {
                  status: "failure" as const,
                  error: new Error("Exhausted retries without result"),
                };
              }
              throw new Error("Exhausted retries without result");
            }),
          );

          // Record metrics
          common.metrics.ponder_indexing_rpc_action_duration.observe(
            { action: "readContracts" },
            endClock(),
          );

          return results as any;
        },

        contract<TAbi extends StarknetAbi>(
          abi: TAbi,
          address: string,
        ): TypedContract<TAbi> {
          // starknet.js v9 uses options object for Contract constructor
          const contract = new Contract({
            abi,
            address,
            providerOrAccount: provider,
          });

          // Helper to get all function names from ABI (handles nested interface structure)
          const getFunctionNames = (): string[] => {
            const names: string[] = [];
            for (const item of abi) {
              // Check top-level functions
              if (
                item.type === "function" &&
                (item.state_mutability === "view" ||
                  item.state_mutability === "external")
              ) {
                names.push(item.name);
              }
              // Check functions inside interface items (Starknet ABI structure)
              if (
                item.type === "interface" &&
                "items" in item &&
                Array.isArray(item.items)
              ) {
                for (const subItem of item.items as any[]) {
                  if (
                    subItem.type === "function" &&
                    (subItem.state_mutability === "view" ||
                      subItem.state_mutability === "external")
                  ) {
                    names.push(subItem.name);
                  }
                }
              }
            }
            return names;
          };

          // Create a wrapper object with methods that use the correct block
          // We can't use Proxy because starknet.js Contract properties are non-configurable
          const wrapper: any = {
            // Expose the underlying contract for advanced use cases
            _contract: contract,
          };

          // Add wrapped methods for each ABI function
          for (const fnName of getFunctionNames()) {
            wrapper[fnName] = async (...args: unknown[]) => {
              const endClock = startClock();

              // Profile pattern recording (same logic as core's getPonderAction)
              if (
                event.type !== "setup" &&
                eventCount[event.name]! % SAMPLING_RATE === 1
              ) {
                if (profile.has(event.name) === false) {
                  profile.set(event.name, new Map());
                  profileConstantLRU.set(event.name, new Set());
                }

                const recordPatternResult = recordProfilePattern({
                  event: event as Event,
                  args: {
                    address,
                    abi: abi as any,
                    functionName: fnName,
                    args: args.length > 0 ? args : undefined,
                  },
                  hints: Array.from(profile.get(event.name)!.values()),
                });
                if (recordPatternResult) {
                  addProfilePattern(recordPatternResult);
                }
              }

              const blockId = getBlockId();

              // Retry logic (same as core's getRetryAction)
              const RETRY_COUNT = 9;
              const BASE_DURATION = 125;

              for (let i = 0; i <= RETRY_COUNT; i++) {
                try {
                  // starknet.js v9 Contract.call signature: call(method, args?, options?)
                  const result = await contract.call(fnName, args as any[], {
                    blockIdentifier: blockId,
                  });

                  // Record metrics
                  common.metrics.ponder_indexing_rpc_action_duration.observe(
                    { action: "contract.call" },
                    endClock(),
                  );

                  return result;
                } catch (error) {
                  // Check if error is retryable (similar to core's logic)
                  const isRetryable =
                    (error as Error)?.message?.includes("not found") ||
                    (error as Error)?.message?.includes("returned no data");

                  if (!isRetryable || i === RETRY_COUNT) {
                    common.logger.warn({
                      msg: "Failed 'context.client' action",
                      action: `contract.${fnName}`,
                      event: event.name,
                      chain: chain.name,
                      chain_id: chain.id,
                      retry_count: i,
                      error: error as Error,
                    });
                    throw error;
                  }

                  const duration = BASE_DURATION * 2 ** i;
                  common.logger.warn({
                    msg: "Failed 'context.client' action",
                    action: `contract.${fnName}`,
                    event: event.name,
                    chain: chain.name,
                    chain_id: chain.id,
                    retry_count: i,
                    retry_delay: duration,
                    error: error as Error,
                  });
                  await wait(duration);
                }
              }
              // Should never reach here, but TypeScript needs a return
              throw new Error("Exhausted retries without result");
            };
          }

          return wrapper as TypedContract<TAbi>;
        },

        provider,

        async getBlock(params) {
          const blockId = params?.blockHash
            ? params.blockHash
            : getBlockId(params?.blockNumber);
          return provider.getBlock(blockId);
        },

        async getTransaction(params) {
          return provider.getTransactionByHash(params.hash);
        },

        async getTransactionReceipt(params) {
          return provider.getTransactionReceipt(params.hash);
        },

        async getStorageAt(params) {
          const blockId = getBlockId(params.blockNumber);
          return provider.getStorageAt(params.address, params.key, blockId);
        },

        async getBlockNumber() {
          return provider.getBlockNumber();
        },

        async getChainId() {
          return provider.getChainId();
        },

        async getClassHashAt(params) {
          const blockId = getBlockId(params.blockNumber);
          return provider.getClassHashAt(params.address, blockId);
        },

        async getNonce(params) {
          const blockId = getBlockId(params.blockNumber);
          return provider.getNonceForAddress(params.address, blockId);
        },

        async request<TResult = unknown>(params: {
          method: string;
          params?: unknown;
        }) {
          return cachedRequest<TResult>(params.method, params.params);
        },
      };

      return actions;
    },

    // Same implementation as core's prefetch
    async prefetch({ events }) {
      const context = {
        logger: common.logger.child({ action: "prefetch_rpc_requests" }),
      };
      const prefetchEndClock = startClock();

      // Use profiling metadata + next event batch to determine which
      // rpc requests are going to be made, and preload them into the cache.

      const prediction: { ev: number; request: Request }[] = [];

      for (const ev of events) {
        if (profile.has(ev.name)) {
          for (const [, { pattern, count }] of profile.get(ev.name)!) {
            // Expected value of times the prediction will be used.
            const expectedValue =
              (count * SAMPLING_RATE) / eventCount[ev.name]!;
            prediction.push({
              ev: expectedValue,
              request: recoverProfilePattern(pattern, ev),
            });
          }
        }
      }

      const chainRequests: Map<
        number,
        { ev: number; request: RequestParameters }[]
      > = new Map();
      for (const chain of indexingBuild.chains) {
        chainRequests.set(chain.id, []);
      }

      for (const { ev, request } of dedupe(prediction, ({ request }) =>
        getCacheKey(encodeRequest(request)),
      )) {
        chainRequests.get(request.chainId)!.push({
          ev,
          request: encodeRequest(request),
        });
      }

      await Promise.all(
        Array.from(chainRequests.entries()).map(async ([chainId, requests]) => {
          const i = indexingBuild.chains.findIndex((n) => n.id === chainId);
          const chain = indexingBuild.chains[i]!;
          const rpc = indexingBuild.rpcs[i]!;

          const dbRequests = requests.filter(
            ({ ev }) => ev > DB_PREDICTION_THRESHOLD,
          );

          common.metrics.ponder_indexing_rpc_prefetch_total.inc(
            {
              chain: chain.name,
              method: "starknet_call",
              type: "database",
            },
            dbRequests.length,
          );

          const cachedResults = await syncStore.getRpcRequestResults(
            {
              requests: dbRequests.map(({ request }) => request),
              chainId,
            },
            context,
          );

          for (let j = 0; j < dbRequests.length; j++) {
            const request = dbRequests[j]!;
            const cachedResult = cachedResults[j]!;

            if (cachedResult !== undefined) {
              cache
                .get(chainId)!
                .set(getCacheKey(request.request), cachedResult);
            } else if (request.ev > RPC_PREDICTION_THRESHOLD) {
              const resultPromise = rpc
                .request(request.request, context)
                .then((result) => JSON.stringify(result))
                .catch((error) => error as Error);

              common.metrics.ponder_indexing_rpc_prefetch_total.inc({
                chain: chain.name,
                method: "starknet_call",
                type: "rpc",
              });

              // Note: Unawaited request added to cache
              cache
                .get(chainId)!
                .set(getCacheKey(request.request), resultPromise);
            }
          }

          if (dbRequests.length > 0) {
            common.logger.debug({
              msg: "Prefetched JSON-RPC requests",
              chain: chain.name,
              chain_id: chain.id,
              request_count: dbRequests.length,
              duration: prefetchEndClock(),
            });
          }
        }),
      );
    },

    clear() {
      for (const chain of indexingBuild.chains) {
        cache.get(chain.id)!.clear();
      }
    },

    set event(_event: Event | SetupEvent) {
      event = _event;
    },
  };
};

/**
 * Extract block ID from request parameters for caching purposes
 */
export const getBlockIdParam = (request: RequestParameters) => {
  let blockId: number | "latest" | "pending" | string | undefined = undefined;

  const getBlockId = (blockId: any) => {
    if (!blockId) return undefined;
    // Handle "latest" or "pending"
    if (blockId === "latest" || blockId === "pending") return blockId;
    // Handle object with block_number
    if (typeof blockId === "object" && "block_number" in blockId)
      return blockId.block_number;
    // Handle object with block_hash
    if (typeof blockId === "object" && "block_hash" in blockId)
      return blockId.block_hash;
    return undefined;
  };

  switch (request.method as string) {
    // params: { request: {...}, block_id: {...} } (named params)
    case "starknet_call":
      blockId = getBlockId((request.params as any)?.block_id);
      break;

    // params: [contract_address, key, block_id]
    case "starknet_getStorageAt":
      blockId = getBlockId(request.params?.[2]);
      break;

    // These methods have block_id as the first parameter
    case "starknet_getNonce":
    case "starknet_getClassAt":
    case "starknet_getClassHashAt":
    case "starknet_getBlockWithTxs":
    case "starknet_getBlockWithTxHashes":
    case "starknet_getBlockTransactionCount":
      blockId = getBlockId(request.params?.[0]);
      break;
  }

  return blockId;
};
