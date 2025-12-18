/**
 * Starknet.js based client for Ponder indexing
 *
 * Provides a clean API using starknet.js Contract pattern:
 *   const erc20 = context.client.contract(erc20ABI, address);
 *   const balance = await erc20.balanceOf(userAddress);
 */

import type { Common } from "@/internal/common.js";
import type { Chain, IndexingBuild, SetupEvent } from "@/internal/types.js";
import type { Event } from "@/internal/types.js";
import type { RequestParameters } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import {
  RpcProvider,
  Contract,
  type Abi as StarknetAbi,
  type GetBlockResponse,
  type GetTransactionReceiptResponse,
  type GetTransactionResponse,
  BlockTag,
  type BlockIdentifier,
} from "starknet";

// ============================================================================
// ABI Type Extraction
// ============================================================================

/**
 * Extract interface items from Starknet ABI (Cairo 1 style)
 * Starknet ABIs nest functions inside interface items
 */
type ExtractInterfaceItems<TAbi extends StarknetAbi> = Extract<
  TAbi[number],
  { type: "interface"; items: readonly any[] }
>["items"][number];

/**
 * Extract top-level functions from ABI (Cairo 0 style)
 */
type ExtractTopLevelFunctions<TAbi extends StarknetAbi> = Extract<
  TAbi[number],
  { type: "function" }
>;

/**
 * Extract all functions from both interface items (Cairo 1) and top-level (Cairo 0)
 */
type ExtractFunctions<TAbi extends StarknetAbi> =
  | Extract<ExtractInterfaceItems<TAbi>, { type: "function" }>
  | ExtractTopLevelFunctions<TAbi>;

/**
 * Get a specific function by name
 */
type GetFunction<TAbi extends StarknetAbi, TName extends string> = Extract<
  ExtractFunctions<TAbi>,
  { name: TName }
>;

/**
 * Extract struct definitions from ABI
 */
type ExtractStructs<TAbi extends StarknetAbi> = Extract<
  TAbi[number],
  { type: "struct" }
>;

/**
 * Extract enum definitions from ABI
 */
type ExtractEnums<TAbi extends StarknetAbi> = Extract<
  TAbi[number],
  { type: "enum" }
>;

// ============================================================================
// Starknet Type Mapping
// ============================================================================

/**
 * Map primitive Starknet/Cairo types to TypeScript types
 */
type PrimitiveTypeLookup<T extends string> =
  // Unsigned integers
  T extends "core::integer::u8" | "u8" ? number :
  T extends "core::integer::u16" | "u16" ? number :
  T extends "core::integer::u32" | "u32" ? number :
  T extends "core::integer::u64" | "u64" ? bigint :
  T extends "core::integer::u128" | "u128" ? bigint :
  T extends "core::integer::u256" | "u256" ? bigint :
  // Signed integers
  T extends "core::integer::i8" | "i8" ? number :
  T extends "core::integer::i16" | "i16" ? number :
  T extends "core::integer::i32" | "i32" ? number :
  T extends "core::integer::i64" | "i64" ? bigint :
  T extends "core::integer::i128" | "i128" ? bigint :
  // Core types
  T extends "core::felt252" | "felt252" ? bigint :
  T extends "core::bool" | "bool" ? boolean :
  // Address types
  T extends "core::starknet::contract_address::ContractAddress" | "ContractAddress" ? string :
  T extends "core::starknet::class_hash::ClassHash" | "ClassHash" ? string :
  T extends "core::starknet::eth_address::EthAddress" | "EthAddress" ? string :
  // String types
  T extends "core::byte_array::ByteArray" | "ByteArray" ? string :
  T extends "core::bytes_31::bytes31" | "bytes31" ? string :
  // Option/Result - simplified to the inner type or undefined
  T extends `core::option::Option::<${infer _Inner}>` ? unknown :
  T extends `core::result::Result::<${infer _Ok}, ${infer _Err}>` ? unknown :
  // Not a primitive - return never to signal struct/enum lookup needed
  never;

/**
 * Map Starknet types to TypeScript types with ABI struct/enum lookup
 */
type MapStarknetType<TAbi extends StarknetAbi, T extends string> =
  // First check primitives
  PrimitiveTypeLookup<T> extends never
    ? // Handle Array types
      T extends `core::array::Array::<${infer Inner}>`
      ? MapStarknetType<TAbi, Inner>[]
      : T extends `core::array::Span::<${infer Inner}>`
        ? MapStarknetType<TAbi, Inner>[]
        : // Try to find struct in ABI
          Extract<ExtractStructs<TAbi>, { name: T }> extends {
            members: infer TMembers extends readonly { name: string; type: string }[];
          }
          ? { [M in TMembers[number] as M["name"]]: MapStarknetType<TAbi, M["type"]> }
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
// Function Input/Output Type Extraction
// ============================================================================

/**
 * Extract input types as a tuple for function arguments
 */
type ExtractInputTypes<
  TAbi extends StarknetAbi,
  TFunc,
> = TFunc extends { inputs: infer TInputs extends readonly { name: string; type: string }[] }
  ? { [K in keyof TInputs]: TInputs[K] extends { type: infer T extends string } ? MapStarknetType<TAbi, T> : never }
  : readonly [];

/**
 * Extract return type from function outputs
 */
type ExtractReturnType<
  TAbi extends StarknetAbi,
  TFunc,
> = TFunc extends { outputs: readonly [{ type: infer T extends string }] }
  ? MapStarknetType<TAbi, T>
  : TFunc extends { outputs: readonly [] }
    ? void
    : unknown;

// ============================================================================
// Function Name Extraction
// ============================================================================

/**
 * Extract view function names from interface items (Cairo 1)
 */
type ExtractViewFunctionNames<TAbi extends StarknetAbi> = Extract<
  ExtractInterfaceItems<TAbi>,
  { type: "function"; state_mutability: "view" }
>["name"];

/**
 * Extract external function names from interface items (Cairo 1)
 */
type ExtractExternalFunctionNames<TAbi extends StarknetAbi> = Extract<
  ExtractInterfaceItems<TAbi>,
  { type: "function"; state_mutability: "external" }
>["name"];

/**
 * Extract top-level view function names (Cairo 0)
 */
type ExtractTopLevelViewFunctionNames<TAbi extends StarknetAbi> = Extract<
  ExtractTopLevelFunctions<TAbi>,
  { state_mutability: "view" }
>["name"];

/**
 * Extract top-level external function names (Cairo 0)
 */
type ExtractTopLevelExternalFunctionNames<TAbi extends StarknetAbi> = Extract<
  ExtractTopLevelFunctions<TAbi>,
  { state_mutability: "external" }
>["name"];

/**
 * All callable function names (view + external from both Cairo 0 and Cairo 1)
 */
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
// Typed Contract
// ============================================================================

/**
 * Typed Contract that provides autocomplete for ABI functions with proper return types
 */
export type TypedContract<TAbi extends StarknetAbi> = {
  /** Access to the underlying starknet.js Contract instance */
  _contract: Contract;
} & {
  [K in ExtractAllFunctionNames<TAbi>]: (
    ...args: ExtractInputTypes<TAbi, GetFunction<TAbi, K>>
  ) => Promise<ExtractReturnType<TAbi, GetFunction<TAbi, K>>>;
};

export type StarknetJsClientActions = {
  /**
   * Create a Contract instance for calling view functions
   * @example
   * const erc20 = client.contract(erc20ABI, tokenAddress);
   * const balance = await erc20.balanceOf(userAddress);
   */
  contract: <TAbi extends StarknetAbi>(
    abi: TAbi,
    address: string,
  ) => TypedContract<TAbi>;

  /**
   * Get the underlying RpcProvider for low-level operations
   */
  provider: RpcProvider;

  /**
   * Get block by number or hash
   */
  getBlock: (params?: {
    blockNumber?: bigint | number;
    blockHash?: string;
  }) => Promise<GetBlockResponse>;

  /**
   * Get transaction by hash
   */
  getTransaction: (params: {
    hash: string;
  }) => Promise<GetTransactionResponse>;

  /**
   * Get transaction receipt
   */
  getTransactionReceipt: (params: {
    hash: string;
  }) => Promise<GetTransactionReceiptResponse>;

  /**
   * Get storage at address
   */
  getStorageAt: (params: {
    address: string;
    key: string;
    blockNumber?: bigint | number;
  }) => Promise<string>;

  /**
   * Get current block number
   */
  getBlockNumber: () => Promise<number>;

  /**
   * Get chain ID
   */
  getChainId: () => Promise<string>;

  /**
   * Get class hash at address
   */
  getClassHashAt: (params: {
    address: string;
    blockNumber?: bigint | number;
  }) => Promise<string>;

  /**
   * Get nonce for address
   */
  getNonce: (params: {
    address: string;
    blockNumber?: bigint | number;
  }) => Promise<string>;

  /**
   * Raw RPC request
   */
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

/**
 * RPC responses that are not cached.
 */
const UNCACHED_RESPONSES = [[], null] as unknown[];

export const getCacheKey = (request: RequestParameters) => {
  return toLowerCase(JSON.stringify(orderObject(request)));
};

type Cache = Map<number, Map<string, Promise<string | Error> | string>>;

/**
 * Create a cached starknet.js client for indexing
 */
export const createCachedStarknetJsClient = ({
  common,
  indexingBuild,
  syncStore,
  eventCount: _eventCount,
}: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  syncStore: SyncStore;
  eventCount?: { [eventName: string]: number };
}): CachedStarknetJsClient => {
  let event: Event | SetupEvent = undefined!;
  const cache: Cache = new Map();

  for (const chain of indexingBuild.chains) {
    cache.set(chain.id, new Map());
  }

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
            syncStore
              .insertRpcRequestResults(
                {
                  requests: [
                    {
                      request: body,
                      blockNumber: undefined,
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
                  message: error instanceof Error ? error.message : "Unknown error",
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
        contract<TAbi extends StarknetAbi>(abi: TAbi, address: string): TypedContract<TAbi> {
          // starknet.js v9 uses options object for Contract constructor
          const contract = new Contract({ abi, address, providerOrAccount: provider });

          // Helper to get all function names from ABI (handles nested interface structure)
          const getFunctionNames = (): string[] => {
            const names: string[] = [];
            for (const item of abi) {
              // Check top-level functions
              if (
                item.type === "function" &&
                (item.state_mutability === "view" || item.state_mutability === "external")
              ) {
                names.push(item.name);
              }
              // Check functions inside interface items (Starknet ABI structure)
              if (item.type === "interface" && "items" in item && Array.isArray(item.items)) {
                for (const subItem of item.items as any[]) {
                  if (
                    subItem.type === "function" &&
                    (subItem.state_mutability === "view" || subItem.state_mutability === "external")
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
              const blockId = getBlockId();
              // starknet.js v9 Contract.call signature: call(method, args?, options?)
              return contract.call(fnName, args as any[], { blockIdentifier: blockId });
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

    // TODO: Implement profiling/prefetch optimization for RPC-heavy indexers
    // This would integrate with indexing/profile.ts to:
    // 1. Record patterns when contract.call() is invoked (via wrapper)
    // 2. Predict future RPC calls based on detected patterns
    // 3. Batch multiple calls for upcoming events in fewer round-trips
    // See core/src/indexing/client.ts for reference implementation
    // Potential 10-20x speedup for indexers making many RPC calls per event
    async prefetch(_params: { events: Event[] }) {
      // No-op for now - implement when performance becomes an issue
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
    // params: [{ contract_address, entry_point_selector, calldata}, block_id]
    case "starknet_call":
      blockId = getBlockId(request.params?.[1]);
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
