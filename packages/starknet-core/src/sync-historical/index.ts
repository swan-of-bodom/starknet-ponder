import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
  Chain,
  Factory,
  FactoryId,
  FilterWithoutBlocks,
  Fragment,
  LogFactory,
  LogFilter,
  Source,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import {
  _debug_traceBlockByNumber,
  _starknet_getBlockByNumber,
  _starknet_getBlockWithReceipts,
  _starknet_getEvents,
  _starknet_getTransactionReceipt,
  validateEventsAndBlock,
  validateReceiptsAndBlock,
  validateTracesAndBlock,
  validateTransactionsAndBlock,
} from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
import {
  getChildAddress,
  isAddressFactory,
  isAddressMatched,
  isLogFactoryMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/runtime/filter.js";
import { recoverFilter } from "@/runtime/fragments.js";
import type { CachedIntervals } from "@/runtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  type Interval,
  getChunks,
  intervalBounds,
  intervalDifference,
  intervalRange,
  intervalUnion,
} from "@/utils/interval.js";
import { toHex64 } from "@/utils/hex.js";
import { startClock } from "@/utils/timer.js";
import { getLogsRetryHelper } from "@ponder/utils";
import {
  type Address,
  type Hash,
  type RpcError,
  toHex,
  zeroHash,
} from "starkweb2";

export type HistoricalSync = {
  /**
   * Extract raw data for `interval` and return the closest-to-tip block
   * that is synced.
   */
  sync(interval: Interval): Promise<SyncBlock | undefined>;
};

type CreateHistoricalSyncParameters = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  sources: Source[];
  childAddresses: Map<FactoryId, Map<Address, number>>;
  cachedIntervals: CachedIntervals;
  syncStore: SyncStore;
};

export const createHistoricalSync = (
  args: CreateHistoricalSyncParameters,
): HistoricalSync => {
  /**
   * Flag to fetch transaction receipts through _starknet_getBlockWithReceipts (true) or _starknet_getTransactionReceipt (false)
   * Batch fetching is more efficient as it fetches all receipts in one RPC call
   */
  let isBlockReceipts = true;
  /**
   * Blocks that have already been extracted.
   * Note: All entries are deleted at the end of each call to `sync()`.
   * OPTIMIZATION: Store pre-normalized hashes to avoid repeated toHex64 calls
   */
  const blockCache = new Map<number, Promise<SyncBlock>>();
  /**
   * OPTIMIZATION: Combined block + receipts cache for filters that need both.
   * Uses starknet_getBlockWithReceipts which returns everything in one RPC call.
   */
  const blockWithReceiptsCache = new Map<number, Promise<{ block: SyncBlock; receipts: SyncTransactionReceipt[] }>>();
  /**
   * Traces that have already been fetched.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const traceCache = new Map<number, Promise<SyncTrace[]>>();
  /**
   * Transactions that should be saved to the sync-store.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const transactionsCache = new Set<Hash>();
  /**
   * Block transaction receipts that have already been fetched.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const blockReceiptsCache = new Map<Hash, Promise<SyncTransactionReceipt[]>>();
  /**
   * Transaction receipts that have already been fetched.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const transactionReceiptsCache = new Map<
    Hash,
    Promise<SyncTransactionReceipt>
  >();

  const childAddressesCache = new Map<LogFactory, Map<Address, number>>();

  /**
   * Data about the range passed to "starknet_getEvents" shared among all log
   * filters and log factories.
   */
  let logsRequestMetadata: {
    /** Estimate optimal range to use for "starknet_getEvents" requests */
    estimatedRange: number;
    /** Range suggested by an error message */
    confirmedRange?: number;
  } = {
    estimatedRange: 2000,
  };

  // Closest-to-tip block that has been synced.
  let latestBlock: SyncBlock | undefined;

  ////////
  // Helper functions for sync tasks
  ////////

  /**
   * Split "starknet_getEvents" requests into ranges inferred from errors
   * and batch requests.
   */
  const syncLogsDynamic = async (
    {
      filter,
      address,
      interval,
    }: {
      filter: LogFilter | LogFactory;
      interval: Interval;
      /** Explicitly set because of the complexity of factory contracts. */
      address: Address | Address[] | undefined;
    },
    context?: Parameters<Rpc["request"]>[1],
  ): Promise<SyncLog[]> => {
    // Use the recommended range if available, else use estimated range
    const intervals = getChunks({
      interval,
      maxChunkSize:
        logsRequestMetadata.confirmedRange ??
        logsRequestMetadata.estimatedRange,
    });

    const topics =
      "eventSelector" in filter
        ? [filter.eventSelector]
        : [
            filter.topic0 ?? null,
            filter.topic1 ?? null,
            filter.topic2 ?? null,
            filter.topic3 ?? null,
          ];

    // Remove trailing null topics (required by RPC)
    while (topics.length > 0 && topics[topics.length - 1] === null) {
      topics.pop();
    }

    // Pre-compute keys array once
    const filteredTopics = topics.filter((t) => t !== null).flat() as string[];
    const keys = filteredTopics.length > 0 ? [filteredTopics] : [];

    // Batch large arrays of addresses, handling arrays that are empty
    let addressBatches: (Address | Address[] | undefined)[];

    if (address === undefined) {
      // no address (match all)
      addressBatches = [undefined];
    } else if (typeof address === "string") {
      // single address
      addressBatches = [address];
    } else if (address.length === 0) {
      // no address (factory with no children)
      return [];
    } else {
      // many addresses
      // Note: it is assumed that `address` is deduplicated
      addressBatches = [];
      for (let i = 0; i < address.length; i += 50) {
        addressBatches.push(address.slice(i, i + 50));
      }
    }

    const logs = await Promise.all(
      intervals.flatMap((interval) =>
        addressBatches.map((address) =>
          _starknet_getEvents(args.rpc, {
            address: address as any,
            keys,
            fromBlock: interval[0],
            toBlock: interval[1],
            logger: args.common.logger,
          }).catch((error) => {
            const getLogsErrorResponse = getLogsRetryHelper({
              params: [
                {
                  address,
                  topics,
                  fromBlock: toHex(interval[0]),
                  toBlock: toHex(interval[1]),
                },
              ],
              error: error as RpcError,
            });

            if (getLogsErrorResponse.shouldRetry === false) throw error;

            const range =
              Number(getLogsErrorResponse.ranges[0]!.toBlock) -
              Number(getLogsErrorResponse.ranges[0]!.fromBlock);

            args.common.logger.debug({
              msg: "Updated starknet_getEvents range",
              chain: args.chain.name,
              chain_id: args.chain.id,
              range,
            });

            logsRequestMetadata = {
              estimatedRange: range,
              confirmedRange: getLogsErrorResponse.isSuggestedRange
                ? range
                : undefined,
            };

            return syncLogsDynamic({ address, interval, filter }, context);
          }),
        ),
      ),
    ).then((logs) => logs.flat());

    /**
     * Dynamically increase the range used in "starknet_getEvents" if an
     * error has been received but the error didn't suggest a range.
     */
    if (logsRequestMetadata.confirmedRange === undefined) {
      logsRequestMetadata.estimatedRange = Math.round(
        logsRequestMetadata.estimatedRange * 1.05,
      );
    }

    return logs;
  };

  /**
   * Extract block, using `blockCache` to avoid fetching
   * the same block twice. Also, update `latestBlock`.
   *
   * @param number Block to be extracted
   *
   * OPTIMIZATION: Pre-normalizes hashes when caching to avoid repeated toHex64 calls.
   */
  const syncBlock = async (
    number: number,
    _context?: Parameters<Rpc["request"]>[1],
  ): Promise<SyncBlock> => {
    // Check if we already have this block from a combined fetch
    if (blockWithReceiptsCache.has(number)) {
      const { block } = await blockWithReceiptsCache.get(number)!;
      return block;
    }

    if (blockCache.has(number)) {
      return blockCache.get(number)!;
    }

    // Fetch and cache the block
    const blockPromise = _starknet_getBlockByNumber(args.rpc, {
      blockNumber: number,
    }).then((block) => {
      // OPTIMIZATION: Pre-normalize hash when caching
      block.hash = toHex64(block.hash) as Hash;
      // Update `latestBlock` if `block` is closer to tip.
      if (block.number >= (latestBlock?.number ?? 0)) latestBlock = block;
      return block;
    });

    blockCache.set(number, blockPromise);
    return blockPromise;
  };

  /**
   * OPTIMIZATION: Fetch block AND receipts in a single RPC call.
   * Use this when you need both block data and transaction receipts.
   * This is ~50% more efficient than separate getBlockWithTxs + getBlockReceipts calls.
   */
  const syncBlockWithReceipts = async (
    number: number,
    _context?: Parameters<Rpc["request"]>[1],
  ): Promise<{ block: SyncBlock; receipts: SyncTransactionReceipt[] }> => {
    if (blockWithReceiptsCache.has(number)) {
      return blockWithReceiptsCache.get(number)!;
    }

    // Check if we already have the block cached separately
    if (blockCache.has(number)) {
      const block = await blockCache.get(number)!;
      // Still need to fetch receipts
      const receipts = await syncBlockReceipts(block, _context);
      return { block, receipts };
    }

    // Fetch both in a single RPC call
    const resultPromise = _starknet_getBlockWithReceipts(args.rpc, {
      blockNumber: number,
    }).then((result) => {
      // OPTIMIZATION: Pre-normalize hashes
      result.block.hash = toHex64(result.block.hash) as Hash;
      for (const tx of result.block.transactions) {
        tx.hash = toHex64(tx.hash) as Hash;
      }
      for (const receipt of result.receipts) {
        receipt.transactionHash = toHex64(receipt.transactionHash) as Hash;
        receipt.blockHash = toHex64(receipt.blockHash) as Hash;
      }
      // Update latestBlock
      if (result.block.number >= (latestBlock?.number ?? 0)) {
        latestBlock = result.block;
      }
      return result;
    });

    blockWithReceiptsCache.set(number, resultPromise);

    // Also populate the regular block cache for consistency
    const result = await resultPromise;
    blockCache.set(number, Promise.resolve(result.block));

    return result;
  };

  const syncTrace = async (
    block: number,
    context?: Parameters<Rpc["request"]>[1],
  ) => {
    if (traceCache.has(block)) {
      return traceCache.get(block)!;
    } else {
      const traces = _debug_traceBlockByNumber(
        args.rpc,
        { blockNumber: block },
        context,
      );
      traceCache.set(block, traces);
      return traces;
    }
  };

  const syncTransactionReceipts = async (
    block: SyncBlock,
    transactionHashes: Set<Hash>,
    context?: Parameters<Rpc["request"]>[1],
  ): Promise<SyncTransactionReceipt[]> => {
    if (transactionHashes.size === 0) {
      return [];
    }

    if (isBlockReceipts === false) {
      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map((hash) =>
          syncTransactionReceipt(hash, context),
        ),
      );

      validateReceiptsAndBlock(
        transactionReceipts,
        block,
        "starknet_getTransactionReceipt",
        "number",
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      blockReceipts = await syncBlockReceipts(block, context);
    } catch (_error) {
      const error = _error as Error;
      args.common.logger.warn({
        msg: "Caught starknet_getBlockWithReceipts error, switching to starknet_getTransactionReceipt method",
        action: "fetch_block_data",
        chain: args.chain.name,
        chain_id: args.chain.id,
        error,
      });

      isBlockReceipts = false;
      return syncTransactionReceipts(block, transactionHashes, context);
    }

    validateReceiptsAndBlock(
      blockReceipts,
      block,
      "starknet_getBlockWithReceipts" as any,
      "number",
    );

    // OPTIMIZATION: With pre-normalized hashes, direct comparison is possible
    // But keep normalization as safety for any edge cases
    const transactionReceipts = blockReceipts.filter((receipt) =>
      transactionHashes.has(receipt.transactionHash) ||
      transactionHashes.has(toHex64(receipt.transactionHash) as Hash),
    );

    return transactionReceipts;
  };

  const syncTransactionReceipt = async (
    transaction: Hash,
    context?: Parameters<Rpc["request"]>[1],
  ) => {
    if (transactionReceiptsCache.has(transaction)) {
      return transactionReceiptsCache.get(transaction)!;
    } else {
      const receipt = _starknet_getTransactionReceipt(
        args.rpc,
        { hash: transaction },
        context,
      );
      transactionReceiptsCache.set(transaction, receipt);
      return receipt;
    }
  };

  const syncBlockReceipts = async (
    block: SyncBlock,
    context?: Parameters<Rpc["request"]>[1],
  ) => {
    if (blockReceiptsCache.has(block.hash)) {
      return blockReceiptsCache.get(block.hash)!;
    } else {
      // _starknet_getBlockWithReceipts returns { block, receipts } - extract just receipts
      const blockReceiptsPromise = _starknet_getBlockWithReceipts(
        args.rpc,
        { blockHash: block.hash },
        context,
      ).then((result) => result.receipts);
      blockReceiptsCache.set(block.hash, blockReceiptsPromise);
      return blockReceiptsPromise;
    }
  };

  /** Extract and insert the log-based addresses that match `filter` + `interval`. */
  const syncLogFactory = async (
    factory: LogFactory,
    interval: Interval,
    context?: Parameters<Rpc["request"]>[1],
  ) => {
    const logs = await syncLogsDynamic(
      {
        filter: factory,
        interval,
        address: factory.address,
      },
      context,
    );

    const childAddresses =
      childAddressesCache.get(factory) ?? new Map<Address, number>();

    const childAddressesRecord = args.childAddresses.get(factory.id)!;

    for (const log of logs) {
      if (isLogFactoryMatched({ factory, log })) {
        const address = getChildAddress({ log, factory });
        const existingBlockNumber = childAddressesRecord.get(address);

        if (
          existingBlockNumber === undefined ||
          existingBlockNumber > log.blockNumber
        ) {
          childAddresses.set(address, log.blockNumber);
          childAddressesRecord.set(address, log.blockNumber);
        }
      }
    }

    // Note: `factory` must refer to the same original `factory` in `filter`
    // and not be a recovered factory from `recoverFilter`.
    childAddressesCache.set(factory, childAddresses);
  };

  /**
   * Return all addresses that match `filter` after extracting addresses
   * that match `filter` and `interval`.
   */
  const syncAddressFactory = async (
    factory: Factory,
    interval: Interval,
    context?: Parameters<Rpc["request"]>[1],
  ): Promise<Map<Address, number>> => {
    const factoryInterval: Interval = [
      Math.max(factory.fromBlock ?? 0, interval[0]),
      Math.min(factory.toBlock ?? Number.POSITIVE_INFINITY, interval[1]),
    ];

    if (factoryInterval[0] <= factoryInterval[1]) {
      await syncLogFactory(factory, factoryInterval, context);
    }

    // Note: `factory` must refer to the same original `factory` in `filter`
    // and not be a recovered factory from `recoverFilter`.
    return args.childAddresses.get(factory.id)!;
  };

  ////////
  // Helper function for filter types
  ////////

  /**
   * Sync log filter with optimizations:
   * - Uses combined block+receipts fetch when hasTransactionReceipt is true
   * - Pre-normalizes hashes to avoid repeated toHex64 calls
   * - Parallel block fetching
   */
  const syncLogFilter = async (
    filter: LogFilter,
    interval: Interval,
    context?: Parameters<Rpc["request"]>[1],
  ) => {
    let logs: SyncLog[];
    if (isAddressFactory(filter.address)) {
      const childAddresses = await syncAddressFactory(
        filter.address,
        interval,
        context,
      );

      // Note: Exit early when only the factory needs to be synced
      if ((filter.fromBlock ?? 0) > interval[1]) return;

      logs = await syncLogsDynamic(
        {
          filter,
          interval,
          address:
            childAddresses.size >=
            args.common.options.factoryAddressCountThreshold
              ? undefined
              : Array.from(childAddresses.keys()),
        },
        context,
      );

      logs = logs.filter((log) =>
        isAddressMatched({
          address: log.address,
          blockNumber: log.blockNumber,
          childAddresses,
        }),
      );
    } else {
      logs = await syncLogsDynamic(
        {
          filter,
          interval,
          address: filter.address,
        },
        context,
      );
    }

    // Early return if no logs found
    if (logs.length === 0) return;

    // Group logs by block number
    const logsPerBlock = new Map<number, SyncLog[]>();
    for (const log of logs) {
      // OPTIMIZATION: Pre-normalize transaction hash
      log.transactionHash = toHex64(log.transactionHash) as Hash;
      log.blockHash = toHex64(log.blockHash) as Hash;
      log.address = toHex64(log.address) as Address;

      if (logsPerBlock.has(log.blockNumber) === false)
        logsPerBlock.set(log.blockNumber, []);
      logsPerBlock.get(log.blockNumber)!.push(log);
    }

    const blockNumbers = Array.from(logsPerBlock.keys());

    // OPTIMIZATION: Use combined block+receipts fetch when receipts are needed
    // This saves one RPC call per block
    let blocks: SyncBlock[];
    let allReceipts: SyncTransactionReceipt[] = [];

    if (filter.hasTransactionReceipt) {
      // Fetch blocks and receipts together in parallel
      const results = await Promise.all(
        blockNumbers.map((number) => syncBlockWithReceipts(number, context)),
      );
      blocks = results.map((r) => r.block);
      allReceipts = results.flatMap((r) => r.receipts);
    } else {
      // Just fetch blocks (no receipts needed)
      blocks = await Promise.all(
        blockNumbers.map((number) => syncBlock(number, context)),
      );
    }

    // Validate and fix transactionIndex for logs
    for (const block of blocks) {
      const blockLogs = logsPerBlock.get(block.number)!;

      validateTransactionsAndBlock(block, "number");
      validateEventsAndBlock(block, blockLogs);

      // Build txHash -> index map (hashes already normalized in syncBlock)
      const txHashToIndex = new Map<string, number>();
      for (const tx of block.transactions)
        txHashToIndex.set(tx.hash, tx.transactionIndex);

      for (const log of blockLogs) {
        if (log.transactionHash === zeroHash) {
          args.common.logger.warn({
            msg: "Detected log with empty transaction hash.",
            action: "fetch_block_data",
            chain: args.chain.name,
            chain_id: args.chain.id,
            number: block.number,
            hash: block.hash,
            logIndex: log.logIndex,
          });
        } else {
          // Fix the transactionIndex using the block's transaction list
          const correctIndex = txHashToIndex.get(log.transactionHash);
          if (correctIndex !== undefined) {
            (log as any).transactionIndex = correctIndex;
          } else {
            // Try with normalized hash (in case log hash wasn't normalized)
            const normalizedHash = toHex64(log.transactionHash);
            const normalizedIndex = txHashToIndex.get(normalizedHash);
            if (normalizedIndex !== undefined) {
              (log as any).transactionIndex = normalizedIndex;
            } else {
              args.common.logger.warn({
                msg: "Could not find transactionIndex for log.",
                action: "fetch_block_data",
                chain: args.chain.name,
                chain_id: args.chain.id,
                blockNumber: block.number,
                transactionHash: log.transactionHash,
              });
            }
          }
        }
      }
    }

    await args.syncStore.insertLogs({ logs, chainId: args.chain.id }, context);

    // Add transaction hashes to cache (already normalized)
    for (const log of logs) {
      if (log.transactionHash !== zeroHash) {
        transactionsCache.add(log.transactionHash);
      }
    }

    // Insert receipts if we fetched them
    if (filter.hasTransactionReceipt && allReceipts.length > 0) {
      // Filter to only receipts for transactions we care about
      const relevantTxHashes = new Set(
        logs
          .filter((l) => l.transactionHash !== zeroHash)
          .map((l) => l.transactionHash),
      );
      const relevantReceipts = allReceipts.filter((r) =>
        relevantTxHashes.has(r.transactionHash),
      );

      await args.syncStore.insertTransactionReceipts(
        {
          transactionReceipts: relevantReceipts,
          chainId: args.chain.id,
        },
        context,
      );
    }
  };

  const syncBlockFilter = async (
    filter: BlockFilter,
    interval: Interval,
    context?: Parameters<Rpc["request"]>[1],
  ) => {
    const baseOffset = (interval[0] - filter.offset) % filter.interval;
    const offset = baseOffset === 0 ? 0 : filter.interval - baseOffset;

    // Determine which blocks are matched by the block filter.
    const requiredBlocks: number[] = [];
    for (let b = interval[0] + offset; b <= interval[1]; b += filter.interval) {
      requiredBlocks.push(b);
    }

    await Promise.all(
      requiredBlocks.map(async (number) => {
        const block = await syncBlock(number, context);
        validateTransactionsAndBlock(block, "number");
        return block;
      }),
    );
  };

  const syncTransactionFilter = async (
    filter: TransactionFilter,
    interval: Interval,
    context?: Parameters<Rpc["request"]>[1],
  ) => {
    const fromChildAddresses = isAddressFactory(filter.fromAddress)
      ? await syncAddressFactory(filter.fromAddress, interval, context)
      : undefined;

    // Starknet transactions don't have 'to' address, so toChildAddresses is not used
    // but we still sync the factory addresses for completeness
    if (isAddressFactory(filter.toAddress)) {
      await syncAddressFactory(filter.toAddress, interval, context);
    }

    // Note: Exit early when only the factory needs to be synced
    if ((filter.fromBlock ?? 0) > interval[1]) return;

    const blocks = await Promise.all(
      intervalRange(interval).map((number) => syncBlock(number, context)),
    );

    const transactionHashes: Set<Hash> = new Set();
    const requiredBlocks: Set<SyncBlock> = new Set();

    for (const block of blocks) {
      validateTransactionsAndBlock(block, "number");

      for (const transaction of block.transactions) {
        // Need to pass blockNumber for since txns dont have blockNumber
        if (
          isTransactionFilterMatched({
            filter,
            transaction,
            blockNumber: block.number,
          }) === false
        ) {
          continue;
        }

        // Get senderAddress if present (only on INVOKE, DECLARE)
        const fromAddress =
          transaction.type === "INVOKE" || transaction.type === "DECLARE"
            ? transaction.senderAddress
            : undefined;
        if (
          isAddressFactory(filter.fromAddress) &&
          isAddressMatched({
            address: fromAddress,
            blockNumber: block.number,
            childAddresses: fromChildAddresses!,
          }) === false
        ) {
          continue;
        }

        // NOTE: Skip toAddress factory check for now since no to address from tx
        if (isAddressFactory(filter.toAddress)) continue;

        // OPTIMIZATION: Hash already normalized in syncBlock
        transactionHashes.add(transaction.hash);
        requiredBlocks.add(block);
      }
    }

    for (const hash of transactionHashes) {
      transactionsCache.add(hash);
    }

    const transactionReceipts = await Promise.all(
      Array.from(requiredBlocks).map((block) => {
        // OPTIMIZATION: Direct hash comparison - already normalized
        const blockTransactionHashes = new Set(
          block.transactions
            .filter((t) => transactionHashes.has(t.hash))
            .map((t) => t.hash),
        );
        return syncTransactionReceipts(block, blockTransactionHashes, context);
      }),
    ).then((receipts) => receipts.flat());

    await args.syncStore.insertTransactionReceipts(
      {
        transactionReceipts,
        chainId: args.chain.id,
      },
      context,
    );
  };

  const syncTraceOrTransferFilter = async (
    filter: TraceFilter | TransferFilter,
    interval: Interval,
    context?: Parameters<Rpc["request"]>[1],
  ) => {
    const fromChildAddresses = isAddressFactory(filter.fromAddress)
      ? await syncAddressFactory(filter.fromAddress, interval, context)
      : undefined;

    const toChildAddresses = isAddressFactory(filter.toAddress)
      ? await syncAddressFactory(filter.toAddress, interval, context)
      : undefined;

    // Note: Exit early when only the factory needs to be synced
    if ((filter.fromBlock ?? 0) > interval[1]) return;

    const requiredBlocks: Set<SyncBlock> = new Set();
    const traces = await Promise.all(
      intervalRange(interval).map(async (number) => {
        let traces = await syncTrace(number, context);

        // remove unmatched traces
        traces = traces.filter((trace) => {
          if (
            filter.type === "trace" &&
            isTraceFilterMatched({
              filter,
              trace: trace.trace,
              block: { number: BigInt(number) },
            }) === false
          ) {
            return false;
          }

          if (
            filter.type === "transfer" &&
            isTransferFilterMatched({
              filter,
              trace: trace.trace,
              block: { number: BigInt(number) },
            }) === false
          ) {
            return false;
          }

          if (
            isAddressFactory(filter.fromAddress) &&
            isAddressMatched({
              address: trace.trace.from,
              blockNumber: number,
              childAddresses: fromChildAddresses!,
            }) === false
          ) {
            return false;
          }

          if (
            isAddressFactory(filter.toAddress) &&
            isAddressMatched({
              address: trace.trace.to,
              blockNumber: number,
              childAddresses: toChildAddresses!,
            }) === false
          ) {
            return false;
          }

          return true;
        });

        if (traces.length === 0) return [];

        const block = await syncBlock(number, context);

        validateTransactionsAndBlock(block, "number");
        validateTracesAndBlock(traces, block, "number");

        requiredBlocks.add(block);

        // OPTIMIZATION: Hashes already normalized in syncBlock
        const transactionsByHash = new Map<Hash, SyncTransaction>();
        for (const transaction of block.transactions) {
          transactionsByHash.set(transaction.hash, transaction);
        }

        return traces.map((trace) => {
          // OPTIMIZATION: Normalize trace hash once and reuse
          const traceHash = toHex64(trace.transactionHash) as Hash;
          const transaction = transactionsByHash.get(traceHash)!;
          transactionsCache.add(traceHash);

          return { trace, transaction, block };
        });
      }),
    ).then((traces) => traces.flat());

    await args.syncStore.insertTraces(
      {
        traces,
        chainId: args.chain.id,
      },
      context,
    );

    if (filter.hasTransactionReceipt) {
      const transactionReceipts = await Promise.all(
        Array.from(requiredBlocks).map((block) => {
          const blockTransactionHashes = new Set(
            traces
              .filter((t) => t.block.hash === block.hash)
              .map((t) => t.transaction.hash),
          );
          return syncTransactionReceipts(
            block,
            blockTransactionHashes,
            context,
          );
        }),
      ).then((receipts) => receipts.flat());

      await args.syncStore.insertTransactionReceipts(
        {
          transactionReceipts,
          chainId: args.chain.id,
        },
        context,
      );
    }
  };

  return {
    async sync(_interval) {
      const context = {
        logger: args.common.logger.child({ action: "fetch_block_data" }),
      };
      const endClock = startClock();

      const intervalsToSync: {
        interval: Interval;
        filter: FilterWithoutBlocks;
      }[] = [];

      // Determine the requests that need to be made, and which intervals need to be inserted.
      // Fragments are used to create a minimal filter, to avoid refetching data even if a filter
      // is only partially synced.

      for (const { filter } of args.sources) {
        let filterIntervals: Interval[] = [
          [
            Math.max(filter.fromBlock ?? 0, _interval[0]),
            Math.min(filter.toBlock ?? Number.POSITIVE_INFINITY, _interval[1]),
          ],
        ];

        switch (filter.type) {
          case "log":
            if (isAddressFactory(filter.address)) {
              filterIntervals.push([
                Math.max(filter.address.fromBlock ?? 0, _interval[0]),
                Math.min(
                  filter.address.toBlock ?? Number.POSITIVE_INFINITY,
                  _interval[1],
                ),
              ]);
            }
            break;
          case "trace":
          case "transaction":
          case "transfer":
            if (isAddressFactory(filter.fromAddress)) {
              filterIntervals.push([
                Math.max(filter.fromAddress.fromBlock ?? 0, _interval[0]),
                Math.min(
                  filter.fromAddress.toBlock ?? Number.POSITIVE_INFINITY,
                  _interval[1],
                ),
              ]);
            }

            if (isAddressFactory(filter.toAddress)) {
              filterIntervals.push([
                Math.max(filter.toAddress.fromBlock ?? 0, _interval[0]),
                Math.min(
                  filter.toAddress.toBlock ?? Number.POSITIVE_INFINITY,
                  _interval[1],
                ),
              ]);
            }
        }

        filterIntervals = filterIntervals.filter(
          ([start, end]) => start <= end,
        );

        if (filterIntervals.length === 0) {
          continue;
        }

        filterIntervals = intervalUnion(filterIntervals);

        const completedIntervals = args.cachedIntervals.get(filter)!;
        const requiredIntervals: {
          fragment: Fragment;
          intervals: Interval[];
        }[] = [];

        for (const {
          fragment,
          intervals: fragmentIntervals,
        } of completedIntervals) {
          const requiredFragmentIntervals = intervalDifference(
            filterIntervals,
            fragmentIntervals,
          );

          if (requiredFragmentIntervals.length > 0) {
            requiredIntervals.push({
              fragment,
              intervals: requiredFragmentIntervals,
            });
          }
        }

        if (requiredIntervals.length > 0) {
          const requiredInterval = intervalBounds(
            requiredIntervals.flatMap(({ intervals }) => intervals),
          );

          const requiredFilter = recoverFilter(
            filter,
            requiredIntervals.map(({ fragment }) => fragment),
          );

          intervalsToSync.push({
            filter: requiredFilter,
            interval: requiredInterval,
          });
        }
      }

      await Promise.all(
        intervalsToSync.map(async ({ filter, interval }) => {
          // Request last block of interval
          const blockPromise = syncBlock(interval[1], context);

          switch (filter.type) {
            case "log": {
              await syncLogFilter(filter as LogFilter, interval, context);
              break;
            }

            case "block": {
              await syncBlockFilter(filter as BlockFilter, interval, context);
              break;
            }

            case "transaction": {
              await syncTransactionFilter(
                filter as TransactionFilter,
                interval,
                context,
              );
              break;
            }

            case "trace":
            case "transfer": {
              await syncTraceOrTransferFilter(
                filter as TraceFilter | TransferFilter,
                interval,
                context,
              );
              break;
            }
          }

          await blockPromise;
        }),
      );

      const blocks = await Promise.all(blockCache.values());

      await Promise.all([
        args.syncStore.insertBlocks(
          { blocks, chainId: args.chain.id },
          context,
        ),
        args.syncStore.insertTransactions(
          {
            // OPTIMIZATION: Hashes are already normalized in caches, direct comparison
            transactions: blocks.flatMap((block) =>
              block.transactions
                .filter(({ hash }) => transactionsCache.has(hash))
                // NOTE: we need to add block number here since starknet tx log doesnt return block number
                .map((tx) => ({ ...tx, blockNumber: block.number })),
            ),
            chainId: args.chain.id,
          },
          context,
        ),
        ...Array.from(childAddressesCache.entries()).map(
          ([factory, childAddresses]) =>
            args.syncStore.insertChildAddresses(
              {
                factory,
                childAddresses,
                chainId: args.chain.id,
              },
              context,
            ),
        ),
      ]);

      // Add corresponding intervals to the sync-store
      // Note: this should happen after so the database doesn't become corrupted
      if (args.chain.disableCache === false) {
        await args.syncStore.insertIntervals(
          {
            intervals: intervalsToSync,
            chainId: args.chain.id,
          },
          context,
        );
      }

      let childAddressCount = 0;
      for (const childAddresses of childAddressesCache.values()) {
        childAddressCount += childAddresses.size;
      }

      args.common.logger.debug(
        {
          msg: "Fetched block data",
          chain: args.chain.name,
          chain_id: args.chain.id,
          block_range: JSON.stringify(_interval),
          block_count: blockCache.size,
          transaction_count: transactionsCache.size,
          trace_count: traceCache.size,
          child_address_count: childAddressCount,
          duration: endClock(),
        },
        ["chain", "block_range"],
      );

      // Clear all caches
      blockCache.clear();
      blockWithReceiptsCache.clear();
      traceCache.clear();
      transactionsCache.clear();
      blockReceiptsCache.clear();
      transactionReceiptsCache.clear();
      childAddressesCache.clear();

      return latestBlock;
    },
  };
};
