// TODO: Improve:
//       - Remove duplicate functions from starkweb/starknet
//       - Simplify it to match closer /core's implementation

import type { Common } from "@/internal/common.js";
import type { Chain, IndexingBuild, SetupEvent } from "@/internal/types.js";
import type { Event } from "@/internal/types.js";
import type { RequestParameters, Rpc } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import {
  type Abi,
  type Account,
  BlockNotFoundError,
  type Client,
  type ContractFunctionName,
  type ContractFunctionParameters,
  type Hash,
  type PublicActions,
  type SNIP1474Methods,
  type Transport,
  type Chain as ViemChain,
  createClient,
  custom,
  publicActions,
} from "starkweb2";
import { compile, calldataToHex } from "starkweb2/utils";
import { selector, num } from "starknet";
import type {
  ReadContractsParameters,
  ReadContractParameters,
  ReadContractReturnType,
  SimulateTransactionParameters,
  SimulateTransactionReturnTypes,
} from "starkweb2/actions";
import type {
  GetTransactionConfirmationsParameters,
  GetTransactionConfirmationsReturnType,
  GetTransactionParameters,
  GetTransactionReceiptParameters,
  GetTransactionReceiptReturnType,
  GetTransactionReturnType,
  Prettify,
} from "viem";
import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";
import {
  getProfilePatternKey,
  recordProfilePattern,
  recoverProfilePattern,
} from "./profile.js";

export type CachedViemClient = {
  getClient: (chain: Chain) => ReadonlyClient;
  prefetch: (params: {
    events: Event[];
  }) => Promise<void>;
  clear: () => void;
  event: Event | SetupEvent | undefined;
};

const SAMPLING_RATE = 10;
const DB_PREDICTION_THRESHOLD = 0.2;
const RPC_PREDICTION_THRESHOLD = 0.8;
const MAX_CONSTANT_PATTERN_COUNT = 10;

/**
 * RPC responses that are not cached. These are valid responses
 * that are sometimes erroneously returned by the RPC.
 *
 * Empty arrays can be returned by `starknet_call` and cause errors.
 * `null` is returned by block queries and causes the `BlockNotFoundError`.
 */
const UNCACHED_RESPONSES = [[], null] as any[];

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

/** Starknet actions where the `block` property is optional and implicit. */
const blockDependentActions = [
  "getBalance",
  "call",
  "getStorageAt",
  "readContract",
  "readContracts",
  "getClassAt",
  "getClassHashAt",
  "getNonce",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Starknet actions where the `block` property is required. */
const blockRequiredActions = [
  "getBlockWithTxHashes",
  "getBlockWithTxs",
  "getBlockTransactionCount",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Starknet actions where the `block` property is non-existent. */
const nonBlockDependentActions = [
  "getBlockNumber",
  "getTransactionByHash",
  "getTransactionReceipt",
  "getChainId",
  "getEvents",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Starknet actions that should be retried if they fail. */
const retryableActions = [
  "readContract",
  "readContracts",
  "getBlockWithTxHashes",
  "getBlockWithTxs",
  "getTransactionByHash",
  "getTransactionReceipt",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

type BlockOptions =
  | {
      cache?: undefined;
      blockNumber?: undefined;
    }
  | {
      cache: "immutable";
      blockNumber?: undefined;
    }
  | {
      cache?: undefined;
      blockNumber: bigint;
    };

type RequiredBlockOptions =
  | {
      /** Hash of the block. */
      blockHash: Hash;
      blockNumber?: undefined;
    }
  | {
      blockHash?: undefined;
      /** The block number. */
      blockNumber: bigint;
    };

type RetryableOptions = {
  /**
   * Whether or not to retry the action if the response is empty.
   *
   * @default true
   */
  retryEmptyResponse?: boolean;
};

type BlockDependentAction<
  fn extends (client: any, args: any) => unknown,
  ///
  params = Parameters<fn>[0],
  returnType = ReturnType<fn>,
> = (
  args: Omit<params, "blockTag" | "blockNumber"> & BlockOptions,
) => returnType;

type ContractCall = {
  abi: Abi | readonly unknown[];
  address: string;
  functionName: string;
  args?: readonly unknown[];
};

/** Helper type to infer return type from a single contract call */
type InferReadContractResult<TContract> = TContract extends {
  abi: infer TAbi;
  functionName: infer TFunctionName;
}
  ? TAbi extends Abi | readonly unknown[]
    ? TFunctionName extends ContractFunctionName<TAbi, "view">
      ? ReadContractReturnType<TAbi, TFunctionName>
      : any
    : any
  : any;

// Starkweb's "multicall" (not multicall) but need to map it to proper return type
type ReadContractsResult<TContracts extends readonly unknown[]> = {
  [K in keyof TContracts]: InferReadContractResult<TContracts[K]>;
};

type TransformStarknetType<T> = T extends { data: "u256" }
  ? { data: bigint }
  : T extends { data: "u128" }
    ? { data: bigint }
    : T extends { data: "i128" }
      ? { data: bigint }
      : T extends { data: "u64" }
        ? { data: bigint }
        : T extends { data: "i64" }
          ? { data: bigint }
          : T extends { data: "u32" }
            ? { data: number }
            : T extends { data: "i32" }
              ? { data: number }
              : T extends { data: "u16" }
                ? { data: number }
                : T extends { data: "i16" }
                  ? { data: number }
                  : T extends { data: "u8" }
                    ? { data: number }
                    : T extends { data: "i8" }
                      ? { data: number }
                      : T extends "u256"
                        ? bigint
                        : T extends "u128"
                          ? bigint
                          : T extends "i128"
                            ? bigint
                            : T extends "u64"
                              ? bigint
                              : T extends "i64"
                                ? bigint
                                : T extends "u32"
                                  ? number
                                  : T extends "i32"
                                    ? number
                                    : T extends "u16"
                                      ? number
                                      : T extends "i16"
                                        ? number
                                        : T extends "u8"
                                          ? number
                                          : T extends "i8"
                                            ? number
                                            : T extends object
                                              ? {
                                                  [K in keyof T]: TransformStarknetType<
                                                    T[K]
                                                  >;
                                                }
                                              : T extends readonly (infer U)[]
                                                ? TransformStarknetType<U>[]
                                                : T;

export type PonderActions = Omit<
  {
    [action in (typeof blockDependentActions)[number]]: BlockDependentAction<
      ReturnType<typeof publicActions>[action]
    >;
  } & Pick<PublicActions, (typeof nonBlockDependentActions)[number]> &
    Pick<PublicActions, (typeof blockRequiredActions)[number]>,
  (typeof retryableActions)[number]
> & {
  // Types for `retryableActions` are manually defined.
  readContract: <
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "view">,
  >(
    args: Omit<
      ReadContractParameters<abi, functionName>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions &
      RetryableOptions,
  ) => Promise<
    TransformStarknetType<ReadContractReturnType<abi, functionName>>
  >;
  simulateContract: (
    args: SimulateTransactionParameters & BlockOptions & RetryableOptions,
  ) => Promise<SimulateTransactionReturnTypes>;
  readContracts: <const TContracts extends readonly ContractCall[]>(
    args: {
      contracts: TContracts;
    } & Omit<
      ReadContractsParameters,
      "contracts" | "blockTag" | "blockNumber" | "blockHash"
    > &
      BlockOptions &
      RetryableOptions,
  ) => Promise<TransformStarknetType<ReadContractsResult<TContracts>>>;
  getBlock: <includeTransactions extends boolean = false>(
    args: {
      /** Whether or not to include transaction data in the response. */
      includeTransactions?: includeTransactions | undefined;
    } & RequiredBlockOptions &
      RetryableOptions,
  ) => Promise<any>; // Returns Block or PendingBlock from starkweb
  getTransaction: (
    args: GetTransactionParameters & RetryableOptions,
  ) => Promise<GetTransactionReturnType>;
  getTransactionReceipt: (
    args: GetTransactionReceiptParameters & RetryableOptions,
  ) => Promise<GetTransactionReceiptReturnType>;
  getTransactionConfirmations: (
    args: GetTransactionConfirmationsParameters & RetryableOptions,
  ) => Promise<GetTransactionConfirmationsReturnType>;
};

export type ReadonlyClient<
  transport extends Transport = Transport,
  chain extends ViemChain | undefined = ViemChain | undefined,
> = Prettify<
  Omit<
    Client<transport, chain, undefined, SNIP1474Methods, PonderActions>,
    | "extend"
    | "key"
    | "batch"
    | "cacheTime"
    | "account"
    | "type"
    | "uid"
    | "chain"
    | "name"
    | "pollingInterval"
    | "transport"
    | "ccipRead"
  >
>;

/**
 * RPC request.
 */
export type Request = Omit<
  Pick<ReadContractParameters, "abi" | "address" | "functionName" | "args">,
  "args"
> & {
  args?: any[];
  blockNumber: bigint | "latest";
  chainId: number;
};
/**
 * Serialized RPC request for uniquely identifying a request.
 *
 * @dev Encoded from {@link Request} using `abi`.
 *
 * @example
 * "{
 *   "method": "starknet_call",
 *   "params": [{"data": "0x123", "to": "0x456"}, "0x789"]
 * }"
 */
type CacheKey = string;
/**
 * Response of an RPC request.
 *
 * @example
 * "0x123"
 *
 * @example
 * ""0x123456789""
 */
type Response = string;
/**
 * Recorded RPC request pattern.
 *
 * @example
 * {
 *   "address": ["args", "from"],
 *   "abi": [...],
 *   "functionName": "balanceOf",
 *   "args": ["log", "address"],
 * }
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
/**
 * Serialized {@link ProfilePattern} for unique identification.
 *
 * @example
 * "{
 *   "address": ["args", "from"],
 *   "args": ["log", "address"],
 *   "functionName": "balanceOf",
 * }"
 */
type ProfileKey = string;
/**
 * Event name.
 *
 * @example
 * "Erc20:Transfer"
 *
 * @example
 * "Erc20.mint()"
 */
type EventName = string;
/**
 * Metadata about RPC request patterns for each event.
 *
 * @dev Only profile "starknet_call" requests (via readContract).
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
/**
 * Cache of RPC responses.
 */
type Cache = Map<number, Map<CacheKey, Promise<Response | Error> | Response>>;

export const getCacheKey = (request: RequestParameters) => {
  return toLowerCase(JSON.stringify(orderObject(request)));
};

/** Compute selector from function name */
const getStarknetSelector = (funcName: string): string => {
  return num.toHex(selector.getSelectorFromName(funcName));
};

// Removed: encodeRequest (EVM-only function, not needed for Starknet)

/**
 * Create a Starknet request cache key without full encoding
 * This is used for deduplication and doesn't validate the ABI
 */
export const createStarknetCacheKey = (request: Request): string => {
  const entry_point_selector = getStarknetSelector(
    request.functionName as string,
  );

  const blockNumber =
    request.blockNumber === "latest"
      ? "latest"
      : typeof request.blockNumber === "bigint"
        ? Number(request.blockNumber)
        : request.blockNumber;

  // Create a minimal request structure for cache key purposes
  // We don't encode the actual calldata here to avoid ABI validation errors
  const cacheKeyObject = {
    method: "starknet_call",
    params: {
      request: {
        contract_address: request.address,
        entry_point_selector,
        // Use stringified args for cache key instead of encoded calldata
        args: request.args ? JSON.stringify(request.args) : undefined,
      },
      block_id:
        blockNumber === "latest" ? "latest" : { block_number: blockNumber },
    },
  };

  return getCacheKey(cacheKeyObject as any);
};

// NOTE: The calldata should only contain the arguments, NOT the selector
export const encodeStarknetRequest = (request: Request): RequestParameters => {
  // Get the entry point selector from the function name
  const entry_point_selector = getStarknetSelector(
    request.functionName as string,
  );

  let calldata: string[] = [];
  if (request.args && request.args.length > 0) {
    const compiled = compile(request.args as any[]);
    calldata = calldataToHex(compiled);
  }

  const blockNumber =
    request.blockNumber === "latest"
      ? "latest"
      : typeof request.blockNumber === "bigint"
        ? Number(request.blockNumber)
        : request.blockNumber;

  return {
    method: "starknet_call" as any,
    params: {
      request: {
        contract_address: request.address,
        entry_point_selector,
        calldata,
      },
      block_id:
        blockNumber === "latest" ? "latest" : { block_number: blockNumber },
    } as any,
  };
};

export const decodeResponse = (response: Response) => {
  // Note: I don't actually remember why we had to add the try catch.
  try {
    return JSON.parse(response);
  } catch (error) {
    return response;
  }
};

export const createCachedViemClient = ({
  common,
  indexingBuild,
  syncStore,
  eventCount,
}: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  syncStore: SyncStore;
  eventCount: { [eventName: string]: number };
}): CachedViemClient => {
  let event: Event | SetupEvent = undefined!;
  const cache: Cache = new Map();
  const profile: Profile = new Map();
  const profileConstantLRU: ProfileConstantLRU = new Map();

  for (const chain of indexingBuild.chains) {
    cache.set(chain.id, new Map());
  }

  const ponderActions = <
    TTransport extends Transport = Transport,
    TChain extends ViemChain | undefined = ViemChain | undefined,
    TAccount extends Account | undefined = Account | undefined,
  >(
    client: Client<TTransport, TChain, TAccount>,
  ): PonderActions => {
    const actions = {} as PonderActions;
    const _publicActions = publicActions(client);

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
            profileConstantLRU.get(event.name)!.size >
            MAX_CONSTANT_PATTERN_COUNT
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

    const getPonderAction = <
      action extends (typeof blockDependentActions)[number],
    >(
      action: action,
    ) => {
      return ({
        cache,
        blockNumber: userBlockNumber,
        ...args
      }: Parameters<PonderActions[action]>[0]) => {
        // Note: prediction only possible when block number is managed by Ponder.

        if (
          event.type !== "setup" &&
          userBlockNumber === undefined &&
          eventCount[event.name]! % SAMPLING_RATE === 1
        ) {
          if (profile.has(event.name) === false) {
            profile.set(event.name, new Map());
            profileConstantLRU.set(event.name, new Set());
          }

          // profile "readContract" and "multicall" actions
          if (action === "readContract") {
            const recordPatternResult = recordProfilePattern({
              event: event,
              args: { ...args, cache } as Parameters<
                PonderActions["readContract"]
              >[0],
              hints: Array.from(profile.get(event.name)!.values()),
            });
            if (recordPatternResult) {
              addProfilePattern(recordPatternResult);
            }
          } else if (action === "readContracts") {
            const contracts = (
              { ...args, cache } as Parameters<
                PonderActions["readContracts"]
              >[0]
            ).contracts as ContractFunctionParameters[];

            if (contracts.length < 10) {
              for (const contract of contracts) {
                const recordPatternResult = recordProfilePattern({
                  event: event,
                  args: contract as any,
                  hints: Array.from(profile.get(event.name)!.values()),
                });
                if (recordPatternResult) {
                  addProfilePattern(recordPatternResult);
                }
              }
            }
          }
        }

        const blockNumber =
          event.type === "setup" ? event.block : event.event.block.number;

        // Convert BigInt blockNumber to number for RPC serialization
        const numericBlockNumber =
          typeof blockNumber === "bigint" ? Number(blockNumber) : blockNumber;

        // @ts-expect-error
        return _publicActions[action]({
          ...args,
          ...(cache === "immutable"
            ? { blockTag: "latest" }
            : {
                blockNumber:
                  userBlockNumber !== undefined
                    ? typeof userBlockNumber === "bigint"
                      ? Number(userBlockNumber)
                      : userBlockNumber
                    : numericBlockNumber,
              }),
        } as Parameters<ReturnType<typeof publicActions>[action]>[0]);
      };
    };

    const getRetryAction = (
      action: PonderActions[keyof PonderActions],
      actionName: keyof PonderActions,
    ) => {
      return async (...args: Parameters<typeof action>) => {
        const RETRY_COUNT = 9;
        const BASE_DURATION = 125;
        for (let i = 0; i <= RETRY_COUNT; i++) {
          try {
            // @ts-ignore
            return await action(...args);
          } catch (error) {
            // TODO: Don't think this right for Starknet, we get things like "Invalid U256 value", etc.
            if (
              (error instanceof BlockNotFoundError === false &&
                error instanceof TransactionNotFoundError === false &&
                error instanceof TransactionReceiptNotFoundError === false &&
                // Note: Another way to catch this error is:
                // `error instanceof ContractFunctionExecutionError && error.cause instanceOf ContractFunctionZeroDataError`
                (error as Error)?.message?.includes("returned no data") ===
                  false) ||
              i === RETRY_COUNT ||
              (args[0] as RetryableOptions).retryEmptyResponse === false
            ) {
              const chain = indexingBuild.chains.find(
                (n) => n.id === event.chainId,
              )!;
              common.logger.warn({
                msg: "Failed 'context.client' action",
                action: actionName,
                event: event.name,
                chain: chain.name,
                chain_id: chain.id,
                retry_count: i,
                error: error as Error,
              });

              throw error;
            }

            const duration = BASE_DURATION * 2 ** i;
            const chain = indexingBuild.chains.find(
              (n) => n.id === event.chainId,
            )!;
            common.logger.warn({
              msg: "Failed 'context.client' action",
              action: actionName,
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
      };
    };

    for (const action of blockDependentActions) {
      actions[action] = getPonderAction(action);
    }

    for (const action of nonBlockDependentActions) {
      // @ts-ignore
      actions[action] = _publicActions[action];
    }

    for (const action of blockRequiredActions) {
      // @ts-ignore
      actions[action] = _publicActions[action];
    }

    for (const action of retryableActions) {
      // @ts-ignore
      actions[action] = getRetryAction(actions[action], action);
    }

    // starkweb's readContracts already decodes results, no need to override

    const actionsWithMetrics = {} as PonderActions;

    for (const [action, actionFn] of Object.entries(actions)) {
      // @ts-ignore
      actionsWithMetrics[action] = async (
        ...args: Parameters<PonderActions[keyof PonderActions]>
      ) => {
        const endClock = startClock();
        try {
          // @ts-ignore
          return await actionFn(...args);
        } finally {
          common.metrics.ponder_indexing_rpc_action_duration.observe(
            { action },
            endClock(),
          );
        }
      };
    }

    return actionsWithMetrics;
  };

  return {
    getClient(chain) {
      const rpc =
        indexingBuild.rpcs[indexingBuild.chains.findIndex((n) => n === chain)]!;

      return createClient({
        transport: cachedTransport({
          common,
          chain,
          rpc,
          syncStore,
          cache,
          event: () => event,
        }),
        chain: chain.viemChain,
      }).extend(ponderActions);
    },
    async prefetch({ events }) {
      const context = {
        logger: common.logger.child({ action: "prefetch_rpc_requests" }),
      };
      const prefetchEndClock = startClock();

      // Use profiling metadata + next event batch to determine which
      // rpc requests are going to be made, and preload them into the cache.

      const prediction: { ev: number; request: Request }[] = [];

      for (const event of events) {
        if (profile.has(event.name)) {
          for (const [, { pattern, count }] of profile.get(event.name)!) {
            // Expected value of times the prediction will be used.
            const ev = (count * SAMPLING_RATE) / eventCount[event.name]!;
            try {
              prediction.push({
                ev,
                request: recoverProfilePattern(pattern, event),
              });
            } catch (error) {
              // Skip patterns that fail to recover (e.g., Starknet-specific issues)
              common.logger.debug({
                msg: "Failed to recover profile pattern",
                event: event.name,
                error: error as Error,
              });
            }
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

      for (const { ev, request } of dedupe(prediction, ({ request }) => {
        try {
          return createStarknetCacheKey(request);
        } catch (error) {
          // If encoding fails, return unique key with BigInt converted
          const serializable = {
            ...request,
            blockNumber:
              typeof request.blockNumber === "bigint"
                ? request.blockNumber.toString()
                : request.blockNumber,
            _error: true,
          };
          return JSON.stringify(serializable);
        }
      })) {
        let encodedRequest: RequestParameters | undefined;
        try {
          encodedRequest = encodeStarknetRequest(request);
        } catch (error) {
          // Skip requests that fail to encode
          common.logger.debug({
            msg: "Failed to encode Starknet prefetch request",
            chainId: request.chainId,
            error: error as Error,
          });
        }

        if (encodedRequest) {
          chainRequests.get(request.chainId)!.push({
            ev,
            request: encodedRequest,
          });
        }
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

          for (let i = 0; i < dbRequests.length; i++) {
            const request = dbRequests[i]!;
            const cachedResult = cachedResults[i]!;

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

export const cachedTransport =
  ({
    common,
    chain,
    rpc,
    syncStore,
    cache,
    event,
  }: {
    common: Common;
    chain: Chain;
    rpc: Rpc;
    syncStore: SyncStore;
    cache: Cache;
    event: () => Event | SetupEvent;
  }): Transport =>
  ({ chain: viemChain }) =>
    custom({
      async request({ method, params }) {
        const context = {
          logger: common.logger.child({
            action: "cache JSON-RPC request",
            event: event().name,
          }),
        };
        const body = { method, params };

        // NOTE: Removed EVM multicall interception since starknet handles this internally

        if (
          blockDependentMethods.has(method) ||
          nonBlockDependentMethods.has(method)
        ) {
          const blockId = getBlockIdParam(body);
          const encodedBlockId =
            blockId === undefined
              ? undefined
              : blockId === "latest"
                ? 0
                : blockId === "pending"
                  ? 0
                  : typeof blockId === "number"
                    ? blockId
                    : undefined; // Block hash: can't convert to number, so don't cache in DB

          const cacheKey = getCacheKey(body);

          if (cache.get(chain.id)!.has(cacheKey)) {
            const cachedResult = cache.get(chain.id)!.get(cacheKey)!;

            // `cachedResult` is a Promise if the request had to be fetched from the RPC.
            if (cachedResult instanceof Promise) {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_rpc",
              });
              const result = await cachedResult;

              if (result instanceof Error) throw result;

              if (UNCACHED_RESPONSES.includes(result) === false) {
                // Note: insertRpcRequestResults errors can be ignored and not awaited, since
                // the response is already fetched.
                syncStore
                  .insertRpcRequestResults(
                    {
                      requests: [
                        {
                          request: body,
                          blockNumber: encodedBlockId,
                          result,
                        },
                      ],
                      chainId: chain.id,
                    },
                    context,
                  )
                  .catch(() => {});
              }

              return decodeResponse(result);
            } else {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_database",
              });
            }

            return decodeResponse(cachedResult);
          }

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

            return decodeResponse(cachedResult);
          }

          common.metrics.ponder_indexing_rpc_requests_total.inc({
            chain: chain.name,
            method,
            type: "rpc",
          });

          const response = await rpc.request(body, context);

          if (UNCACHED_RESPONSES.includes(response) === false) {
            // Note: insertRpcRequestResults errors can be ignored and not awaited, since
            // the response is already fetched.
            syncStore
              .insertRpcRequestResults(
                {
                  requests: [
                    {
                      request: body,
                      blockNumber: encodedBlockId,
                      result: JSON.stringify(response),
                    },
                  ],
                  chainId: chain.id,
                },
                context,
              )
              .catch(() => {});
          }
          return response;
        } else {
          return rpc.request(body, context);
        }
      },
    })({ chain: viemChain, retryCount: 0 });

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
