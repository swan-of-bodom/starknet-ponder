// Starknet RPC layer using starknetjs
// Based on /core's implementation pattern but adapted for Starknet

import crypto from "node:crypto";
import url from "node:url";
import type { Common } from "@/internal/common.js";
import type { Logger } from "@/internal/logger.js";
import type { Chain, SyncBlock, SyncBlockHeader } from "@/internal/types.js";
import {
  _starknet_getBlockByNumber,
  standardizeBlock,
} from "@/rpc/actions.js";
import { createQueue } from "@/utils/queue.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import type { RpcError } from "viem";
// RpcProvider no longer needed - using direct HTTP fetch for performance
import { WebSocket } from "ws";
// Note: DebugRpcSchema from "../utils/debug.js" available for debugging

/** Starknet RPC Types (raw snake_case format from RPC) */
export type StarknetEvent = {
  from_address: string;
  keys: string[];
  data: string[];
  block_number: number;
  block_hash: string;
  transaction_hash: string;
};

export type StarknetGetEventsResponse = {
  events: StarknetEvent[];
  continuation_token?: string;
};

/** Raw transaction receipt from RPC (snake_case) */
export type StarknetTransactionReceipt = {
  transaction_hash: string;
  type: "INVOKE" | "DECLARE" | "DEPLOY" | "DEPLOY_ACCOUNT" | "L1_HANDLER";
  actual_fee: string | { amount: string; unit: "WEI" | "FRI" };
  execution_status: "SUCCEEDED" | "REVERTED";
  finality_status: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";
  block_hash: string;
  block_number: number;
  messages_sent: Array<{
    from_address: string;
    to_address: string;
    payload: string[];
  }>;
  events: Array<{
    from_address: string;
    keys: string[];
    data: string[];
  }>;
  execution_resources: {
    steps?: number;
    memory_holes?: number;
    range_check_builtin_applications?: number;
    pedersen_builtin_applications?: number;
    poseidon_builtin_applications?: number;
    ec_op_builtin_applications?: number;
    ecdsa_builtin_applications?: number;
    bitwise_builtin_applications?: number;
    keccak_builtin_applications?: number;
    segment_arena_builtin?: number;
    l1_gas?: number;
    l1_data_gas?: number;
    l2_gas?: number;
    data_availability?: {
      l1_gas: number;
      l1_data_gas: number;
    };
  };
  revert_reason?: string;
  contract_address?: string;
  message_hash?: string;
};

export type StarknetBlockWithReceipts = {
  block_number: number;
  block_hash: string;
  continuation_token: string;
  transactions: Array<{
    transaction: any;
    receipt: StarknetTransactionReceipt;
  }>;
} | null;

export type StarknetBlockWithTxs = {
  block_number: number;
  block_hash: string;
  parent_hash: string;
  timestamp: number;
  sequencer_address: string;
  starknet_version: string;
  status: "PENDING" | "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";
  l1_da_mode: string;
  l1_gas_price: { price_in_wei: string; price_in_fri: string };
  l1_data_gas_price: { price_in_wei: string; price_in_fri: string };
  new_root: string;
  transactions: any[];
} | null;

/** Starknet RPC method types */
type StarknetRpcMethod =
  | "starknet_blockNumber"
  | "starknet_blockHashAndNumber"
  | "starknet_getBlockWithTxHashes"
  | "starknet_getBlockWithTxs"
  | "starknet_getBlockWithReceipts"
  | "starknet_getStateUpdate"
  | "starknet_getStorageAt"
  | "starknet_getTransactionStatus"
  | "starknet_getTransactionByHash"
  | "starknet_getTransactionByBlockIdAndIndex"
  | "starknet_getTransactionReceipt"
  | "starknet_getClass"
  | "starknet_getClassHashAt"
  | "starknet_getClassAt"
  | "starknet_getBlockTransactionCount"
  | "starknet_call"
  | "starknet_estimateFee"
  | "starknet_estimateMessageFee"
  | "starknet_getNonce"
  | "starknet_chainId"
  | "starknet_syncing"
  | "starknet_getEvents"
  | "starknet_specVersion"
  | "starknet_traceTransaction"
  | "starknet_traceBlockTransactions"
  | "starknet_subscribeNewHeads"
  | "starknet_unsubscribe"
  | "devnet_getPredeployedAccounts";

/** Request parameters type */
export type RequestParameters = {
  method: StarknetRpcMethod | string;
  params?: any;
};

/** Request function type */
export type RequestFn = <T = any>(
  params: RequestParameters,
) => Promise<T>;

export type Rpc = {
  hostnames: string[];
  request: <T = any>(
    parameters: RequestParameters,
    context?: { logger?: Logger; retryNullBlockRequest?: boolean },
  ) => Promise<T>;
  subscribe: (params: {
    onBlock: (block: SyncBlock | SyncBlockHeader) => Promise<boolean>;
    onError: (error: Error) => void;
  }) => void;
  unsubscribe: () => Promise<void>;
};

// RPC error classes
class BlockNotFoundError extends Error {
  constructor({ blockNumber }: { blockNumber?: bigint }) {
    super(`Block not found${blockNumber !== undefined ? `: ${blockNumber}` : ""}`);
    this.name = "BlockNotFoundError";
  }
}

class HttpRequestError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
  }
}

class TimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

// RPC error codes
const RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  METHOD_NOT_FOUND: -32601,
  METHOD_NOT_SUPPORTED: -32004,
  JSON_RPC_VERSION_UNSUPPORTED: -32006,
} as const;

const RETRY_COUNT = 9;
const BASE_DURATION = 125;
const INITIAL_REACTIVATION_DELAY = 100;
const MAX_REACTIVATION_DELAY = 5_000;
const BACKOFF_FACTOR = 1.5;
const LATENCY_WINDOW_SIZE = 500;
/** Hurdle rate for switching to a faster bucket. */
const LATENCY_HURDLE_RATE = 0.1;
/** Exploration rate. */
const EPSILON = 0.1;
const INITIAL_MAX_RPS = 100;
const MIN_RPS = 3;
const MAX_RPS = 500;
const RPS_INCREASE_FACTOR = 1.05;
const RPS_DECREASE_FACTOR = 0.95;
const RPS_INCREASE_QUALIFIER = 0.9;
const SUCCESS_MULTIPLIER = 5;

type Bucket = {
  index: number;
  hostname: string;
  reactivationDelay: number;
  activeConnections: number;
  isActive: boolean;
  isWarmingUp: boolean;

  latencyMetadata: {
    latencies: { value: number; success: boolean }[];
    successfulLatencies: number;
    latencySum: number;
  };
  expectedLatency: number;

  rps: { count: number; timestamp: number }[];
  consecutiveSuccessfulRequests: number;
  rpsLimit: number;

  request: RequestFn;
};

const addLatency = (bucket: Bucket, latency: number, success: boolean) => {
  bucket.latencyMetadata.latencies.push({ value: latency, success });
  bucket.latencyMetadata.latencySum += latency;
  if (success) {
    bucket.latencyMetadata.successfulLatencies++;
  }

  if (bucket.latencyMetadata.latencies.length > LATENCY_WINDOW_SIZE) {
    const record = bucket.latencyMetadata.latencies.shift()!;
    bucket.latencyMetadata.latencySum -= record.value;
    if (record.success) {
      bucket.latencyMetadata.successfulLatencies--;
    }
  }

  bucket.expectedLatency =
    bucket.latencyMetadata.latencySum /
    bucket.latencyMetadata.successfulLatencies;
};

const isAvailable = (bucket: Bucket) => {
  if (bucket.isActive === false) return false;

  const now = Math.floor(Date.now() / 1000);
  const currentRPS = bucket.rps.find((r) => r.timestamp === now);

  if (currentRPS && currentRPS.count + 1 > bucket.rpsLimit) {
    return false;
  }

  if (bucket.rps.length > 0 && bucket.rps[0]!.timestamp < now) {
    const elapsed = now - bucket.rps[0]!.timestamp;
    const totalCount = bucket.rps.reduce((acc, rps) => acc + rps.count, 0);

    if (totalCount > bucket.rpsLimit * (1 + elapsed)) {
      return false;
    }
  }

  if (bucket.isWarmingUp && bucket.activeConnections > 3) {
    return false;
  }

  return true;
};

/**
 * Create a request function using direct HTTP fetch for performance
 * Formats params correctly for Starknet JSON-RPC spec
 */
const createRequestFn = (nodeUrl: string, timeout = 10_000): RequestFn => {
  let requestId = 0;

  return async <T>(params: RequestParameters): Promise<T> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const { method, params: rpcParams } = params;

      // Format params based on the method - Starknet RPC uses named params in an object
      let formattedParams: any;

      switch (method) {
        case "starknet_getBlockWithTxs":
        case "starknet_getBlockWithTxHashes":
        case "starknet_getBlockWithReceipts": {
          // These methods take { block_id: BlockIdentifier }
          const blockId = rpcParams?.block_id ?? "latest";
          formattedParams = { block_id: blockId };
          break;
        }
        case "starknet_getTransactionByHash": {
          formattedParams = { transaction_hash: rpcParams?.transaction_hash };
          break;
        }
        case "starknet_getTransactionReceipt": {
          formattedParams = { transaction_hash: rpcParams?.transaction_hash };
          break;
        }
        case "starknet_getEvents": {
          formattedParams = { filter: rpcParams?.filter };
          break;
        }
        case "starknet_call": {
          formattedParams = {
            request: rpcParams?.request,
            block_id: rpcParams?.block_id ?? "latest",
          };
          break;
        }
        case "starknet_getStorageAt": {
          if (Array.isArray(rpcParams)) {
            formattedParams = {
              contract_address: rpcParams[0],
              key: rpcParams[1],
              block_id: rpcParams[2] ?? "latest",
            };
          } else {
            formattedParams = {
              contract_address: rpcParams?.contract_address,
              key: rpcParams?.key,
              block_id: rpcParams?.block_id ?? "latest",
            };
          }
          break;
        }
        case "starknet_getClassAt":
        case "starknet_getClassHashAt": {
          formattedParams = {
            contract_address: rpcParams?.contract_address,
            block_id: rpcParams?.block_id ?? "latest",
          };
          break;
        }
        case "starknet_getNonce": {
          formattedParams = {
            contract_address: rpcParams?.contract_address,
            block_id: rpcParams?.block_id ?? "latest",
          };
          break;
        }
        case "starknet_chainId":
        case "starknet_blockNumber":
        case "starknet_specVersion":
        case "starknet_syncing": {
          // These methods take no params
          formattedParams = {};
          break;
        }
        default: {
          // Pass through as-is for unknown methods
          formattedParams = rpcParams ?? {};
        }
      }

      const response = await fetch(nodeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++requestId,
          method,
          params: formattedParams,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new HttpRequestError(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();

      if (json.error) {
        throw new HttpRequestError(`RPC Error: ${json.error.message || JSON.stringify(json.error)}`);
      }

      return json.result as T;
    } catch (error: any) {
      if (controller.signal.aborted || error.name === "AbortError") {
        throw new TimeoutError();
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  };
};

export const createRpc = ({
  common,
  chain,
  concurrency = 25,
}: { common: Common; chain: Chain; concurrency?: number }): Rpc => {
  let backends: { request: RequestFn; hostname: string }[];

  if (typeof chain.rpc === "string") {
    const protocol = new url.URL(chain.rpc).protocol;
    const hostname = new url.URL(chain.rpc).hostname;
    if (protocol === "https:" || protocol === "http:") {
      backends = [
        {
          request: createRequestFn(chain.rpc),
          hostname,
        },
      ];
    } else if (protocol === "wss:" || protocol === "ws:") {
      // For WebSocket URLs, still use HTTP for requests but note the WS endpoint
      // WebSocket is only used for subscriptions
      const httpUrl = chain.rpc.replace(/^wss?:/, protocol === "wss:" ? "https:" : "http:");
      backends = [
        {
          request: createRequestFn(httpUrl),
          hostname,
        },
      ];
    } else {
      throw new Error(`Unsupported RPC URL protocol: ${protocol}`);
    }
  } else if (Array.isArray(chain.rpc)) {
    backends = chain.rpc.map((rpc) => {
      const protocol = new url.URL(rpc).protocol;
      const hostname = new url.URL(rpc).hostname;

      if (protocol === "https:" || protocol === "http:") {
        return {
          request: createRequestFn(rpc),
          hostname,
        };
      } else if (protocol === "wss:" || protocol === "ws:") {
        const httpUrl = rpc.replace(/^wss?:/, protocol === "wss:" ? "https:" : "http:");
        return {
          request: createRequestFn(httpUrl),
          hostname,
        };
      } else {
        throw new Error(`Unsupported RPC URL protocol: ${protocol}`);
      }
    });
  } else {
    // Custom transport function - create a wrapper
    const customRequest: RequestFn = async (params) => {
      // For custom transports, we need to call them directly
      // This assumes the custom transport follows the same interface
      const transport = chain.rpc as any;
      const client = transport({ chain: chain.viemChain, retryCount: 0, timeout: 10_000 });
      return client.request(params);
    };
    backends = [
      {
        request: customRequest,
        hostname: "custom_transport",
      },
    ];
  }

  if (typeof chain.ws === "string") {
    const protocol = new url.URL(chain.ws).protocol;

    if (protocol !== "wss:" && protocol !== "ws:") {
      throw new Error(
        `Inconsistent RPC URL protocol: ${protocol}. Expected wss or ws.`,
      );
    }
  }

  const buckets: Bucket[] = backends.map(
    ({ request, hostname }, index) =>
      ({
        index,
        hostname,
        reactivationDelay: INITIAL_REACTIVATION_DELAY,

        activeConnections: 0,
        isActive: true,
        isWarmingUp: false,

        latencyMetadata: {
          latencies: [],
          successfulLatencies: 0,
          latencySum: 0,
        },
        expectedLatency: 200,

        rps: [],
        consecutiveSuccessfulRequests: 0,
        rpsLimit: INITIAL_MAX_RPS,

        request,
      }) satisfies Bucket,
  );

  let noAvailableBucketsTimer: NodeJS.Timeout | undefined;
  const timeouts = new Set<NodeJS.Timeout>();

  const scheduleBucketActivation = (bucket: Bucket) => {
    const delay = bucket.reactivationDelay;
    const timeoutId = setTimeout(() => {
      bucket.isActive = true;
      bucket.isWarmingUp = true;
      timeouts.delete(timeoutId);
      common.logger.debug({
        msg: "JSON-RPC provider reactivated after rate limiting",
        chain: chain.name,
        chain_id: chain.id,
        hostname: bucket.hostname,
        retry_delay: Math.round(delay),
      });
    }, delay);

    common.logger.debug({
      msg: "JSON-RPC provider deactivated due to rate limiting",
      chain: chain.name,
      chain_id: chain.id,
      hostname: bucket.hostname,
      retry_delay: Math.round(delay),
    });

    timeouts.add(timeoutId);
  };

  const getBucket = async (): Promise<Bucket> => {
    let availableBuckets: Bucket[];

    await new Promise((resolve) => setImmediate(resolve));

    while (true) {
      const timestamp = Math.floor(Date.now() / 1000);
      for (const bucket of buckets) {
        bucket.rps = bucket.rps.filter((r) => r.timestamp > timestamp - 10);
      }

      availableBuckets = buckets.filter(isAvailable);

      if (availableBuckets.length > 0) {
        break;
      }

      if (noAvailableBucketsTimer === undefined) {
        noAvailableBucketsTimer = setTimeout(() => {
          common.logger.warn({
            msg: "All JSON-RPC providers are inactive due to rate limiting",
            chain: chain.name,
            chain_id: chain.id,
            rate_limits: JSON.stringify(buckets.map((b) => b.rpsLimit)),
          });
        }, 5_000);
      }

      await wait(20);
    }

    clearTimeout(noAvailableBucketsTimer);
    noAvailableBucketsTimer = undefined;

    if (Math.random() < EPSILON) {
      const randomBucket =
        availableBuckets[Math.floor(Math.random() * availableBuckets.length)]!;
      randomBucket.activeConnections++;
      return randomBucket;
    }

    const fastestBucket = availableBuckets.reduce((fastest, current) => {
      const currentLatency = current.expectedLatency;
      const fastestLatency = fastest.expectedLatency;

      if (currentLatency < fastestLatency * (1 - LATENCY_HURDLE_RATE)) {
        return current;
      }

      if (
        currentLatency <= fastestLatency &&
        current.activeConnections < fastest.activeConnections
      ) {
        return current;
      }

      return fastest;
    }, availableBuckets[0]!);

    fastestBucket.activeConnections++;
    return fastestBucket;
  };

  const increaseMaxRPS = (bucket: Bucket) => {
    if (bucket.rps.length < 10) return;

    if (
      bucket.consecutiveSuccessfulRequests <
      bucket.rpsLimit * SUCCESS_MULTIPLIER
    ) {
      return;
    }

    for (const { count } of bucket.rps) {
      if (count < bucket.rpsLimit * RPS_INCREASE_QUALIFIER) {
        return;
      }
    }

    bucket.rpsLimit = Math.min(bucket.rpsLimit * RPS_INCREASE_FACTOR, MAX_RPS);
    bucket.consecutiveSuccessfulRequests = 0;

    common.logger.debug({
      msg: "Increased JSON-RPC provider RPS limit",
      chain: chain.name,
      chain_id: chain.id,
      hostname: bucket.hostname,
      rps_limit: Math.floor(bucket.rpsLimit),
    });
  };

  const queue = createQueue<
    Awaited<ReturnType<Rpc["request"]>>,
    {
      body: Parameters<Rpc["request"]>[0];
      context?: Parameters<Rpc["request"]>[1];
    }
  >({
    initialStart: true,
    concurrency,
    worker: async ({ body, context }) => {
      const logger = context?.logger ?? common.logger;

      for (let i = 0; i <= RETRY_COUNT; i++) {
        let endClock = startClock();
        const t = setTimeout(() => {
          logger.warn({
            msg: "Unable to find available JSON-RPC provider within expected time",
            chain: chain.name,
            chain_id: chain.id,
            rate_limit: JSON.stringify(buckets.map((b) => b.rpsLimit)),
            is_active: JSON.stringify(buckets.map((b) => b.isActive)),
            is_warming_up: JSON.stringify(buckets.map((b) => b.isWarmingUp)),
            duration: 15_000,
          });
        }, 15_000);
        const bucket = await getBucket();
        clearTimeout(t);
        const getBucketDuration = endClock();
        endClock = startClock();
        const id = crypto.randomUUID().slice(0, 8);

        const surpassTimeout = setTimeout(() => {
          logger.warn({
            msg: "JSON-RPC request unexpectedly surpassed timeout",
            chain: chain.name,
            chain_id: chain.id,
            hostname: bucket.hostname,
            request_id: id,
            method: body.method,
            duration: 15_000,
          });
        }, 15_000);

        try {
          logger.trace({
            msg: "Sent JSON-RPC request",
            chain: chain.name,
            chain_id: chain.id,
            hostname: bucket.hostname,
            request_id: id,
            method: body.method,
            duration: getBucketDuration,
          });

          const timestamp = Math.floor(Date.now() / 1000);
          if (
            bucket.rps.length === 0 ||
            bucket.rps[bucket.rps.length - 1]!.timestamp < timestamp
          ) {
            bucket.rps.push({ count: 1, timestamp });
          } else {
            bucket.rps[bucket.rps.length - 1]!.count++;
          }

          const response = await bucket.request(body);

          if (response === undefined) {
            throw new Error("Response is undefined");
          }

          if (
            response === null &&
            (body.method === "starknet_getBlockWithTxs" ||
              body.method === "starknet_getBlockWithReceipts") &&
            context?.retryNullBlockRequest === true
          ) {
            const blockId = (body.params as { block_id?: { block_number?: number } } | undefined)?.block_id;
            const blockNum = blockId?.block_number;
            throw new BlockNotFoundError({
              blockNumber: blockNum !== undefined ? BigInt(blockNum) : undefined,
            });
          }

          const duration = endClock();

          logger.trace({
            msg: "Received JSON-RPC response",
            chain: chain.name,
            chain_id: chain.id,
            hostname: bucket.hostname,
            request_id: id,
            method: body.method,
            duration,
          });

          common.metrics.ponder_rpc_request_duration.observe(
            { method: body.method, chain: chain.name },
            duration,
          );

          addLatency(bucket, duration, true);

          bucket.consecutiveSuccessfulRequests++;
          increaseMaxRPS(bucket);

          bucket.isWarmingUp = false;
          bucket.reactivationDelay = INITIAL_REACTIVATION_DELAY;

          return response;
        } catch (e) {
          const error = e as Error;

          common.metrics.ponder_rpc_request_error_total.inc(
            { method: body.method, chain: chain.name },
            1,
          );

          const filterParams = (body.params as { filter?: { from_block?: { block_number?: number }; to_block?: { block_number?: number }; address?: string; keys?: string[][] } } | undefined)?.filter;
          const fromBlockParam = filterParams?.from_block;
          const toBlockParam = filterParams?.to_block;
          if (
            body.method === "starknet_getEvents" &&
            fromBlockParam?.block_number !== undefined &&
            toBlockParam?.block_number !== undefined
          ) {
            const fromBlock = fromBlockParam.block_number;
            const toBlock = toBlockParam.block_number;
            const getLogsErrorResponse = getLogsRetryHelper({
              params: [
                {
                  fromBlock: fromBlock,
                  toBlock: toBlock,
                  address: filterParams?.address,
                  topics: filterParams?.keys || [],
                },
              ] as unknown as GetLogsRetryHelperParameters["params"],
              error: error as RpcError,
            });

            if (getLogsErrorResponse.shouldRetry) {
              common.logger.trace({
                msg: "Caught starknet_getEvents range error",
                chain: chain.name,
                chain_id: chain.id,
                hostname: bucket.hostname,
                request_id: id,
                method: body.method,
                request: JSON.stringify(body),
                retry_ranges: JSON.stringify(getLogsErrorResponse.ranges),
                error: error as Error,
              });

              throw error;
            }
          }

          addLatency(bucket, endClock(), false);

          if (
            // @ts-ignore
            error.code === 429 ||
            // @ts-ignore
            error.status === 429 ||
            error instanceof TimeoutError
          ) {
            if (bucket.isActive) {
              bucket.isActive = false;
              bucket.isWarmingUp = false;

              bucket.rpsLimit = Math.max(
                bucket.rpsLimit * RPS_DECREASE_FACTOR,
                MIN_RPS,
              );
              bucket.consecutiveSuccessfulRequests = 0;

              common.logger.debug({
                msg: "JSON-RPC provider rate limited",
                chain: chain.name,
                chain_id: chain.id,
                hostname: bucket.hostname,
                rps_limit: Math.floor(bucket.rpsLimit),
              });

              scheduleBucketActivation(bucket);

              if (buckets.every((b) => b.isActive === false)) {
                logger.warn({
                  msg: "All JSON-RPC providers are inactive",
                  chain: chain.name,
                  chain_id: chain.id,
                });
              }

              bucket.reactivationDelay =
                error instanceof TimeoutError
                  ? INITIAL_REACTIVATION_DELAY
                  : Math.min(
                      bucket.reactivationDelay * BACKOFF_FACTOR,
                      MAX_REACTIVATION_DELAY,
                    );
            }
          }

          if (shouldRetry(error) === false) {
            logger.warn({
              msg: "Received JSON-RPC error",
              chain: chain.name,
              chain_id: chain.id,
              hostname: bucket.hostname,
              request_id: id,
              method: body.method,
              request: JSON.stringify(body),
              duration: endClock(),
              error,
            });
            throw error;
          }

          if (i === RETRY_COUNT) {
            logger.warn({
              msg: "Received JSON-RPC error",
              chain: chain.name,
              chain_id: chain.id,
              hostname: bucket.hostname,
              request_id: id,
              method: body.method,
              request: JSON.stringify(body),
              duration: endClock(),
              retry_count: i + 1,
              error,
            });
            throw error;
          }

          const duration = BASE_DURATION * 2 ** i;
          logger.warn({
            msg: "Received JSON-RPC error",
            chain: chain.name,
            chain_id: chain.id,
            hostname: bucket.hostname,
            request_id: id,
            method: body.method,
            request: JSON.stringify(body),
            duration: endClock(),
            retry_count: i + 1,
            retry_delay: duration,
            error,
          });
          await wait(duration);
        } finally {
          bucket.activeConnections--;
          clearTimeout(surpassTimeout);
        }
      }

      throw "unreachable";
    },
  });

  let ws: WebSocket | undefined;
  let isUnsubscribed = false;
  let subscriptionId: string | undefined;
  let webSocketErrorCount = 0;
  let interval: NodeJS.Timeout | undefined;

  const rpc: Rpc = {
    hostnames: backends.map((backend) => backend.hostname),
    request: (parameters, context) => queue.add({ body: parameters, context }) as Promise<any>,
    subscribe({ onBlock, onError }) {
      (async () => {
        while (true) {
          if (isUnsubscribed) return;

          if (chain.ws === undefined || webSocketErrorCount >= RETRY_COUNT) {
            common.logger.debug({
              msg: "Created JSON-RPC polling subscription",
              chain: chain.name,
              chain_id: chain.id,
              polling_interval: chain.pollingInterval,
            });

            interval = setInterval(async () => {
              try {
                const block = await _starknet_getBlockByNumber(rpc, {
                  blockTag: "latest",
                });
                common.logger.trace({
                  msg: "Received successful JSON-RPC polling response",
                  chain: chain.name,
                  chain_id: chain.id,
                  block_number: block.number,
                  block_hash: block.hash,
                });
                await onBlock(block);
              } catch (error) {
                onError(error as Error);
              }
            }, chain.pollingInterval);
            common.shutdown.add(() => {
              clearInterval(interval);
            });

            return;
          }

          await new Promise<void>((resolve) => {
            ws = new WebSocket(chain.ws!);

            ws.on("open", () => {
              common.logger.debug({
                msg: "Created JSON-RPC WebSocket connection",
                chain: chain.name,
                chain_id: chain.id,
              });

              const subscriptionRequest = {
                jsonrpc: "2.0",
                id: 1,
                method: "starknet_subscribeNewHeads",
                params: [],
              };

              ws?.send(JSON.stringify(subscriptionRequest));
            });

            ws.on("message", (data: Buffer) => {
              try {
                const msg = JSON.parse(data.toString());
                if (
                  msg.method === "starknet_subscriptionNewHeads" &&
                  msg.params?.subscription_id === subscriptionId
                ) {
                  const result = msg.params?.result;
                  common.logger.trace({
                    msg: "Received successful JSON-RPC WebSocket subscription data",
                    chain: chain.name,
                    chain_id: chain.id,
                    block_number: result?.block_number,
                    block_hash: result?.block_hash,
                  });
                  webSocketErrorCount = 0;

                  onBlock(standardizeBlock(result, "newHeads", true));
                } else if (msg.result?.subscription_id) {
                  common.logger.debug({
                    msg: "Created JSON-RPC WebSocket subscription",
                    chain: chain.name,
                    chain_id: chain.id,
                    request: JSON.stringify({
                      method: "starknet_subscribeNewHeads",
                      params: [],
                    }),
                    subscription: msg.result.subscription_id,
                  });

                  subscriptionId = msg.result.subscription_id;
                } else if (msg.error) {
                  common.logger.warn({
                    msg: "Failed JSON-RPC WebSocket subscription",
                    chain: chain.name,
                    chain_id: chain.id,
                    request: JSON.stringify({
                      method: "starknet_subscribeNewHeads",
                      params: [],
                    }),
                    retry_count: webSocketErrorCount + 1,
                    error: msg.error as Error,
                  });

                  if (webSocketErrorCount < RETRY_COUNT) {
                    webSocketErrorCount += 1;
                  }

                  ws?.close();
                } else {
                  common.logger.warn({
                    msg: "Received unrecognized JSON-RPC WebSocket message",
                    chain: chain.name,
                    websocket_message: msg,
                  });
                }
              } catch (error) {
                common.logger.warn({
                  msg: "Failed JSON-RPC WebSocket subscription",
                  chain: chain.name,
                  chain_id: chain.id,
                  request: JSON.stringify({
                    method: "starknet_subscribeNewHeads",
                    params: [],
                  }),
                  retry_count: webSocketErrorCount + 1,
                  error: error as Error,
                });

                if (webSocketErrorCount < RETRY_COUNT) {
                  webSocketErrorCount += 1;
                }

                ws?.close();
              }
            });

            ws.on("error", async (error) => {
              common.logger.warn({
                msg: "Failed JSON-RPC WebSocket subscription",
                chain: chain.name,
                chain_id: chain.id,
                request: JSON.stringify({
                  method: "starknet_subscribeNewHeads",
                  params: [],
                }),
                retry_count: webSocketErrorCount + 1,
                error: error as Error,
              });

              if (webSocketErrorCount < RETRY_COUNT) {
                webSocketErrorCount += 1;
              }

              if (ws && ws.readyState === ws.OPEN) {
                ws.close();
              } else {
                resolve();
              }
            });

            ws.on("close", async () => {
              common.logger.debug({
                msg: "Closed JSON-RPC WebSocket connection",
                chain: chain.name,
                chain_id: chain.id,
              });

              ws = undefined;

              if (isUnsubscribed || webSocketErrorCount >= RETRY_COUNT) {
                resolve();
              } else {
                const duration = BASE_DURATION * 2 ** webSocketErrorCount;

                common.logger.debug({
                  msg: "Retrying JSON-RPC WebSocket connection",
                  chain: chain.name,
                  retry_count: webSocketErrorCount + 1,
                  retry_delay: duration,
                });

                await wait(duration);

                resolve();
              }
            });
          });
        }
      })();
    },
    async unsubscribe() {
      clearInterval(interval);
      isUnsubscribed = true;
      if (ws) {
        if (subscriptionId) {
          const unsubscribeRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "starknet_unsubscribe",
            params: { subscription_id: subscriptionId },
          };

          common.logger.debug({
            msg: "Ended JSON-RPC WebSocket subscription",
            chain: chain.name,
            chain_id: chain.id,
            request: JSON.stringify({
              method: "starknet_unsubscribe",
              params: { subscription_id: subscriptionId },
            }),
          });

          ws.send(JSON.stringify(unsubscribeRequest));
        }
        ws.close();
      }
    },
  };

  common.shutdown.add(() => {
    for (const timeoutId of timeouts) {
      clearTimeout(timeoutId);
    }
    timeouts.clear();
  });

  return rpc;
};

function shouldRetry(error: Error) {
  if ("code" in error && typeof error.code === "number") {
    if (error.code === RPC_ERROR_CODES.PARSE_ERROR) return false;
    if (error.code === RPC_ERROR_CODES.METHOD_NOT_FOUND) return false;
    if (error.code === RPC_ERROR_CODES.METHOD_NOT_SUPPORTED) return false;
    if (error.code === RPC_ERROR_CODES.JSON_RPC_VERSION_UNSUPPORTED) return false;
    if (error.message.includes("revert")) return false;
  }
  if (error instanceof HttpRequestError && error.status) {
    if (error.status === 405) return false;
    if (error.status === 404) return false;
    if (error.status === 501) return false;
    if (error.status === 505) return false;
  }
  return true;
}
