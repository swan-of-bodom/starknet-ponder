import type { Common } from "@/internal/common.js";
import { ShutdownError } from "@/internal/errors.js";
import type {
  BlockFilter,
  Chain,
  Factory,
  FactoryId,
  Filter,
  LightBlock,
  LogFilter,
  Source,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import {
  _starknet_getBlockByNumber,
  _starknet_getBlockByHash,
  _starknet_getEvents,
  _starknet_getBlockWithReceipts,
  _starknet_getTransactionReceipt,
  _debug_traceBlockByHash,
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
  isBlockFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/runtime/filter.js";
import type { SyncProgress } from "@/runtime/index.js";
import { createLock } from "@/utils/mutex.js";
import { range } from "@/utils/range.js";
import { startClock } from "@/utils/timer.js";
import { type Address, type Hash, zeroHash } from "starkweb2";
import { isFilterInBloom } from "./bloom.js";

export type RealtimeSync = {
  /**
   * Fetch block event data and reconcile it into the local chain.
   *
   * @param block - The block to reconcile.
   */
  sync(
    block: SyncBlock | SyncBlockHeader,
    blockCallback?: (isAccepted: boolean) => void,
  ): AsyncGenerator<RealtimeSyncEvent>;
  onError(error: Error): void;
  /** Local chain of blocks that have not been finalized. */
  unfinalizedBlocks: LightBlock[];
};

export type BlockWithEventData = {
  block: SyncBlock | SyncBlockHeader;
  transactions: SyncTransaction[];
  transactionReceipts: SyncTransactionReceipt[];
  logs: SyncLog[];
  traces: SyncTrace[];
  childAddresses: Map<Factory, Set<Address>>;
};

export type RealtimeSyncEvent =
  | ({
      type: "block";
      hasMatchedFilter: boolean;
      blockCallback?: (isAccepted: boolean) => void;
    } & BlockWithEventData)
  | { type: "finalize"; block: LightBlock }
  | { type: "reorg"; block: LightBlock; reorgedBlocks: LightBlock[] };

type CreateRealtimeSyncParameters = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  sources: Source[];
  syncProgress: Pick<SyncProgress, "finalized">;
  childAddresses: Map<FactoryId, Map<Address, number>>;
};

const MAX_LATEST_BLOCK_ATTEMPT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_QUEUED_BLOCKS = 50;

export const createRealtimeSync = (
  args: CreateRealtimeSyncParameters,
): RealtimeSync => {
  // Batch fetching is more efficient as it fetches all receipts in one RPC call
  let isBlockReceipts = true;
  let finalizedBlock: LightBlock = args.syncProgress.finalized;
  const childAddresses = args.childAddresses;
  /** Annotates `childAddresses` for efficient lookup by block number */
  const childAddressesPerBlock = new Map<
    number,
    BlockWithEventData["childAddresses"]
  >();
  /**
   * Blocks that have been ingested and are
   * waiting to be finalized. It is an invariant that
   * all blocks are linked to each other,
   * `parentHash` => `hash`.
   */
  let unfinalizedBlocks: LightBlock[] = [];
  /** Closest-to-tip block that has been fetched but not yet reconciled. */
  let latestFetchedBlock: LightBlock | undefined;
  let fetchAndReconcileLatestBlockErrorCount = 0;

  const noNewBlockWarning = () => {
    args.common.logger.warn({
      msg: "No new block received within expected time",
      chain: args.chain.name,
      chain_id: args.chain.id,
    });
  };
  let noNewBlockTimer = setTimeout(noNewBlockWarning, 30_000);

  const realtimeSyncLock = createLock();

  const factories: Factory[] = [];
  const logFilters: LogFilter[] = [];
  const traceFilters: TraceFilter[] = [];
  const transactionFilters: TransactionFilter[] = [];
  const transferFilters: TransferFilter[] = [];
  const blockFilters: BlockFilter[] = [];

  for (const source of args.sources) {
    // Collect filters from sources
    if (source.type === "contract") {
      if (source.filter.type === "log") {
        logFilters.push(source.filter);
      } else if (source.filter.type === "trace") {
        traceFilters.push(source.filter);
      }
    } else if (source.type === "account") {
      if (source.filter.type === "transaction") {
        transactionFilters.push(source.filter);
      } else if (source.filter.type === "transfer") {
        transferFilters.push(source.filter);
      }
    } else if (source.type === "block") {
      blockFilters.push(source.filter);
    }

    // Collect factories from sources
    switch (source.filter.type) {
      case "trace":
      case "transaction":
      case "transfer": {
        const { fromAddress, toAddress } = source.filter;

        if (isAddressFactory(fromAddress)) {
          factories.push(fromAddress);
        }
        if (isAddressFactory(toAddress)) {
          factories.push(toAddress);
        }
        break;
      }
      case "log": {
        const { address } = source.filter;
        if (isAddressFactory(address)) {
          factories.push(address);
        }
        break;
      }
    }
  }

  /**
   * Fetch Starknet logs for a given block using starknet_getEvents.
   * Unlike EVM's eth_getLogs which can fetch all logs by blockHash,
   * Starknet requires specifying contract addresses.
   */
  const syncStarknetLogs = async (
    blockNumber: number,
    _context?: Parameters<Rpc["request"]>[1],
  ): Promise<SyncLog[]> => {
    const allLogs: SyncLog[] = [];

    // Collect all addresses we need to fetch events from
    for (const filter of logFilters) {
      let addresses: Address[] = [];

      // Handle factory patterns
      if (isAddressFactory(filter.address)) {
        // Get discovered child addresses for this factory
        const factoryChildAddresses = childAddresses.get(filter.address.id);
        if (factoryChildAddresses) {
          addresses = Array.from(factoryChildAddresses.keys()).filter(
            (addr) => {
              const createdAt = factoryChildAddresses.get(addr)!;
              return createdAt <= blockNumber;
            },
          );
        }
      } else if (filter.address) {
        // Regular address or address array
        addresses = Array.isArray(filter.address)
          ? filter.address
          : [filter.address];
      } else {
        // No address filter - skip (Starknet requires address)
        continue;
      }

      // Fetch events for each address
      for (const address of addresses) {
        try {
          // Build event selector filter from topics
          const keys: string[][] = [];
          if (filter.topic0) {
            const topic0Array = Array.isArray(filter.topic0)
              ? filter.topic0
              : [filter.topic0];
            keys.push(topic0Array);
          }

          const logs = await _starknet_getEvents(args.rpc, {
            address,
            fromBlock: blockNumber,
            toBlock: blockNumber,
            keys,
            logger: args.common.logger,
          });

          allLogs.push(...logs);
        } catch (error) {
          // Log error but continue with other addresses
          args.common.logger.warn({
            msg: "Failed to fetch Starknet events for address",
            chain: args.chain.name,
            chain_id: args.chain.id,
            address,
            blockNumber,
            error: (error as Error).message,
          });
        }
      }
    }

    return allLogs;
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
        Array.from(transactionHashes).map(async (hash) =>
          _starknet_getTransactionReceipt(args.rpc, { hash }, context),
        ),
      );

      validateReceiptsAndBlock(
        transactionReceipts,
        block,
        "starknet_getTransactionReceipt" as any,
        "hash",
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      // _starknet_getBlockWithReceipts returns { block, receipts } - extract just receipts
      const result = await _starknet_getBlockWithReceipts(
        args.rpc,
        { blockHash: block.hash },
        context,
      );
      blockReceipts = result.receipts;
    } catch (_error) {
      const error = _error as Error;
      args.common.logger.warn({
        msg: "Caught starknet_getBlockWithReceipts error, switching to starknet_getTransactionReceipt method",
        action: "fetch block data",
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
      "hash",
    );

    const transactionReceipts = blockReceipts.filter((receipt) =>
      transactionHashes.has(receipt.transactionHash),
    );

    return transactionReceipts;
  };

  const getLatestUnfinalizedBlock = () => {
    if (unfinalizedBlocks.length === 0) {
      return finalizedBlock;
    } else return unfinalizedBlocks[unfinalizedBlocks.length - 1]!;
  };

  /**
   * Fetch all data (logs, traces, receipts) for the specified block required by `args.sources`
   *
   * @dev The data returned by this function may include false positives. This
   * is due to the fact that factory addresses are unknown and are always
   * treated as "matched".
   */
  const fetchBlockEventData = async (
    maybeBlockHeader: SyncBlock | SyncBlockHeader,
  ): Promise<BlockWithEventData> => {
    const context = {
      logger: args.common.logger.child({ action: "fetch_block_data" }),
    };
    const endClock = startClock();

    let block: SyncBlock | undefined;

    if (maybeBlockHeader.transactions !== undefined) {
      block = maybeBlockHeader;
    }

    ////////
    // Logs
    ////////

    // Starknet doesn't have logsBloom, so check block range with isFilterInBloom
    const shouldRequestLogs = logFilters.some((filter) =>
      isFilterInBloom({ block: maybeBlockHeader, filter }),
    );

    let logs: SyncLog[] = [];
    if (shouldRequestLogs) {
      // block.number is now a plain number, not hex
      const blockNumber = maybeBlockHeader.number;

      if (block === undefined) {
        [block, logs] = await Promise.all([
          _starknet_getBlockByHash(
            args.rpc,
            { hash: maybeBlockHeader.hash },
            context,
          ),
          syncStarknetLogs(blockNumber, context),
        ]);
      } else {
        logs = await syncStarknetLogs(blockNumber, context);
      }

      // Use Starknet-specific validation (not EVM validateLogsAndBlock which checks tx hash matching)
      validateEventsAndBlock(block, logs);

      // Starknet doesn't have logsBloom, skip bloom filter validation

      // For Starknet: Fix transactionIndex for logs since starknet_getEvents doesn't provide it
      // Build a map of transaction hash -> transaction index from the block
      const txHashToIndex = new Map<string, number>();
      for (const tx of block.transactions) {
        // tx.transactionIndex is now a plain number, not hex
        txHashToIndex.set(tx.hash, tx.transactionIndex);
      }

      for (const log of logs) {
        if (log.transactionHash === zeroHash) {
          args.common.logger.warn({
            msg: "Detected log with empty transaction hash. This is expected for some chains like ZKsync.",
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
          }
        }
      }
    }

    if (
      shouldRequestLogs === false &&
      args.sources.some((s) => s.filter.type === "log")
    ) {
      args.common.logger.trace({
        msg: "Skipped eth_getLogs request due to bloom filter result",
        action: "fetch_block_data",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: maybeBlockHeader.number,
        hash: maybeBlockHeader.hash,
      });
    }

    ////////
    // Traces
    ////////

    const shouldRequestTraces =
      traceFilters.length > 0 || transferFilters.length > 0;

    let traces: SyncTrace[] = [];
    if (shouldRequestTraces) {
      if (block === undefined) {
        [block, traces] = await Promise.all([
          _starknet_getBlockByHash(
            args.rpc,
            { hash: maybeBlockHeader.hash },
            context,
          ),
          _debug_traceBlockByHash(
            args.rpc,
            { hash: maybeBlockHeader.hash },
            context,
          ),
        ]);
      } else {
        traces = await _debug_traceBlockByHash(
          args.rpc,
          { hash: block.hash },
          context,
        );
      }

      validateTracesAndBlock(traces, block, "hash");
    }

    ////////
    // Get Matched
    ////////

    // Record `blockChildAddresses` that contain factory child addresses
    const blockChildAddresses = new Map<Factory, Set<Address>>();
    for (const factory of factories) {
      blockChildAddresses.set(factory, new Set<Address>());
      for (const log of logs) {
        if (isLogFactoryMatched({ factory, log })) {
          const address = getChildAddress({ log, factory });
          blockChildAddresses.get(factory)!.add(address);
        }
      }
    }

    const requiredTransactions = new Set<Hash>();
    const requiredTransactionReceipts = new Set<Hash>();

    // Remove logs that don't match a filter, recording required transactions
    logs = logs.filter((log) => {
      let isMatched = false;

      for (const filter of logFilters) {
        if (isLogFilterMatched({ filter, log })) {
          isMatched = true;
          if (log.transactionHash !== zeroHash) {
            requiredTransactions.add(log.transactionHash);
            if (filter.hasTransactionReceipt) {
              requiredTransactionReceipts.add(log.transactionHash);

              // skip to next log
              break;
            }
          }
        }
      }

      return isMatched;
    });

    // Initial weak trace filtering before full filtering with factory addresses in handleBlock
    traces = traces.filter((trace) => {
      let isMatched = false;
      for (const filter of transferFilters) {
        if (
          isTransferFilterMatched({
            filter,
            trace: trace.trace,
            block: maybeBlockHeader,
          })
        ) {
          requiredTransactions.add(trace.transactionHash);
          isMatched = true;
          if (filter.hasTransactionReceipt) {
            requiredTransactionReceipts.add(trace.transactionHash);
            // skip to next trace
            break;
          }
        }
      }

      for (const filter of traceFilters) {
        if (
          isTraceFilterMatched({
            filter,
            trace: trace.trace,
            block: maybeBlockHeader,
          })
        ) {
          requiredTransactions.add(trace.transactionHash);
          isMatched = true;
          if (filter.hasTransactionReceipt) {
            requiredTransactionReceipts.add(trace.transactionHash);
            // skip to next trace
            break;
          }
        }
      }

      return isMatched;
    });

    ////////
    // Transactions
    ////////

    // exit early if no logs or traces were requested and no transactions are required
    if (block === undefined && transactionFilters.length === 0) {
      args.common.logger.debug(
        {
          msg: "Fetched block data",
          chain: args.chain.name,
          chain_id: args.chain.id,
          number: maybeBlockHeader.number,
          hash: maybeBlockHeader.hash,
          transaction_count: 0,
          receipt_count: 0,
          trace_count: 0,
          log_count: 0,
          child_address_count: 0,
          duration: endClock(),
        },
        ["chain", "number", "hash"],
      );

      return {
        block: maybeBlockHeader,
        transactions: [],
        transactionReceipts: [],
        logs: [],
        traces: [],
        childAddresses: blockChildAddresses,
      };
    }

    if (block === undefined) {
      block = await _starknet_getBlockByHash(
        args.rpc,
        { hash: maybeBlockHeader.hash },
        context,
      );
    }
    validateTransactionsAndBlock(block, "hash");

    // Debug: Log required transaction hashes and block transaction hashes
    if (requiredTransactions.size > 0) {
      args.common.logger.debug({
        msg: "Transaction matching debug",
        requiredTransactions: Array.from(requiredTransactions),
        blockTxHashes: block.transactions.map((tx) => tx.hash),
        blockNumber: block.number,
      });
    }

    const transactions = block.transactions.filter((transaction) => {
      let isMatched = requiredTransactions.has(transaction.hash);
      for (const filter of transactionFilters) {
        if (isTransactionFilterMatched({ filter, transaction })) {
          requiredTransactions.add(transaction.hash);
          requiredTransactionReceipts.add(transaction.hash);
          isMatched = true;
        }
      }
      return isMatched;
    });

    ////////
    // Transaction Receipts
    ////////

    const transactionReceipts = await syncTransactionReceipts(
      block,
      requiredTransactionReceipts,
      context,
    );

    let childAddressCount = 0;
    for (const childAddresses of blockChildAddresses.values()) {
      childAddressCount += childAddresses.size;
    }

    args.common.logger.debug(
      {
        msg: "Fetched block data",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: block.number,
        hash: block.hash,
        transaction_count: transactions.length,
        log_count: logs.length,
        trace_count: traces.length,
        receipt_count: transactionReceipts.length,
        child_address_count: childAddressCount,
        duration: endClock(),
      },
      ["chain", "number", "hash"],
    );

    return {
      block,
      transactions,
      transactionReceipts,
      logs,
      traces,
      childAddresses: blockChildAddresses,
    };
  };

  /**
   * Filter the block event data using the filters and child addresses.
   */
  const filterBlockEventData = ({
    block,
    logs,
    traces,
    transactions,
    transactionReceipts,
    childAddresses: blockChildAddresses,
  }: BlockWithEventData): BlockWithEventData & {
    matchedFilters: Set<Filter>;
  } => {
    // Update `childAddresses`
    for (const factory of factories) {
      const factoryId = factory.id;
      for (const address of blockChildAddresses.get(factory)!) {
        if (childAddresses.get(factoryId)!.has(address) === false) {
          childAddresses
            .get(factoryId)!
            .set(address, block.number);
        } else {
          blockChildAddresses.get(factory)!.delete(address);
        }
      }
    }

    // Save per block child addresses so that they can be undone in the event of a reorg.
    childAddressesPerBlock.set(block.number, blockChildAddresses);

    /**
     * `logs` and `callTraces` must be filtered again (already filtered in `extract`)
     *  because `extract` doesn't have factory address information.
     */

    const matchedFilters = new Set<Filter>();

    // Remove logs that don't match a filter, accounting for factory addresses
    logs = logs.filter((log) => {
      let isMatched = false;

      for (const filter of logFilters) {
        if (
          isLogFilterMatched({ filter, log }) &&
          (isAddressFactory(filter.address)
            ? isAddressMatched({
                address: log.address,
                blockNumber: block.number,
                childAddresses: childAddresses.get(filter.address.id)!,
              })
            : true)
        ) {
          matchedFilters.add(filter);
          isMatched = true;
        }
      }

      return isMatched;
    });

    traces = traces.filter((trace) => {
      let isMatched = false;
      for (const filter of transferFilters) {
        if (
          isTransferFilterMatched({
            filter,
            trace: trace.trace,
            block,
          }) &&
          (isAddressFactory(filter.fromAddress)
            ? isAddressMatched({
                address: trace.trace.from,
                blockNumber: block.number,
                childAddresses: childAddresses.get(filter.fromAddress.id)!,
              })
            : true) &&
          (isAddressFactory(filter.toAddress)
            ? isAddressMatched({
                address: trace.trace.to,
                blockNumber: block.number,
                childAddresses: childAddresses.get(filter.toAddress.id)!,
              })
            : true)
        ) {
          matchedFilters.add(filter);
          isMatched = true;
        }
      }

      for (const filter of traceFilters) {
        if (
          isTraceFilterMatched({
            filter,
            trace: trace.trace,
            block,
          }) &&
          (isAddressFactory(filter.fromAddress)
            ? isAddressMatched({
                address: trace.trace.from,
                blockNumber: block.number,
                childAddresses: childAddresses.get(filter.fromAddress.id)!,
              })
            : true) &&
          (isAddressFactory(filter.toAddress)
            ? isAddressMatched({
                address: trace.trace.to,
                blockNumber: block.number,
                childAddresses: childAddresses.get(filter.toAddress.id)!,
              })
            : true)
        ) {
          matchedFilters.add(filter);
          isMatched = true;
        }
      }

      return isMatched;
    });

    // Remove transactions and transaction receipts that may have been filtered out

    const transactionHashes = new Set<Hash>();
    for (const log of logs) {
      transactionHashes.add(log.transactionHash);
    }
    for (const trace of traces) {
      transactionHashes.add(trace.transactionHash);
    }

    transactions = transactions.filter((transaction) => {
      let isMatched = transactionHashes.has(transaction.hash);
      // Get from address (only on INVOKE, DECLARE)
      const fromAddress =
        transaction.type === "INVOKE" || transaction.type === "DECLARE"
          ? transaction.senderAddress
          : undefined;

      for (const filter of transactionFilters) {
        if (
          isTransactionFilterMatched({
            filter,
            transaction,
            blockNumber: block.number,
          }) &&
          (isAddressFactory(filter.fromAddress)
            ? isAddressMatched({
                address: fromAddress,
                blockNumber: block.number,
                childAddresses: childAddresses.get(filter.fromAddress.id)!,
              })
            : true) &&
          // Starknet transactions don't have 'to' address
          (isAddressFactory(filter.toAddress) ? false : true)
        ) {
          matchedFilters.add(filter);
          isMatched = true;
        }
      }
      return isMatched;
    });

    for (const transaction of transactions) {
      transactionHashes.add(transaction.hash);
    }

    transactionReceipts = transactionReceipts.filter((t) =>
      transactionHashes.has(t.transactionHash),
    );

    // Record matched block filters
    for (const filter of blockFilters) {
      if (isBlockFilterMatched({ filter, block })) {
        matchedFilters.add(filter);
      }
    }

    return {
      matchedFilters,
      block,
      logs,
      transactions,
      transactionReceipts,
      traces,
      childAddresses: blockChildAddresses,
    };
  };

  /**
   * Traverse the remote chain until we find a block that is
   * compatible with our local chain.
   *
   * @param block Block that caused reorg to be detected.
   * Must be at most 1 block ahead of the local chain.
   */
  const reconcileReorg = async (
    block: SyncBlock | SyncBlockHeader,
  ): Promise<Extract<RealtimeSyncEvent, { type: "reorg" }>> => {
    const context = {
      logger: args.common.logger.child({ action: "reconcile_reorg" }),
    };
    const endClock = startClock();

    args.common.logger.debug({
      msg: "Detected reorg in local chain",
      chain: args.chain.name,
      chain_id: args.chain.id,
      number: block.number,
      hash: block.hash,
    });

    // Record blocks that have been removed from the local chain.
    const reorgedBlocks = unfinalizedBlocks.filter(
      (lb) => lb.number >= block.number,
    );

    // Prune the local chain of blocks that have been reorged out
    unfinalizedBlocks = unfinalizedBlocks.filter(
      (lb) => lb.number < block.number,
    );

    // Block we are attempting to fit into the local chain.
    let remoteBlock = block;

    while (true) {
      const parentBlock = getLatestUnfinalizedBlock();

      if (parentBlock.hash === remoteBlock.parentHash) break;

      if (unfinalizedBlocks.length === 0) {
        // No compatible block was found in the local chain, must be a deep reorg.

        // Note: reorgedBlocks aren't removed from `unfinalizedBlocks` because we are "bailing"
        // from this attempt to reconcile the reorg, we need to reset the local chain state back
        // to what it was before we started.
        unfinalizedBlocks = reorgedBlocks;

        args.common.logger.warn({
          msg: "Encountered unrecoverable reorg",
          chain: args.chain.name,
          chain_id: args.chain.id,
          finalized_block: finalizedBlock.number,
          duration: endClock(),
        });

        throw new Error(
          `Encountered unrecoverable '${args.chain.name}' reorg beyond finalized block ${finalizedBlock.number}`,
        );
      } else {
        remoteBlock = await _starknet_getBlockByHash(
          args.rpc,
          { hash: remoteBlock.parentHash },
          context,
        );
        // Add tip to `reorgedBlocks`
        reorgedBlocks.unshift(unfinalizedBlocks.pop()!);
      }
    }

    const commonAncestor = getLatestUnfinalizedBlock();

    args.common.logger.debug({
      msg: "Reconciled reorg in local chain",
      chain: args.chain.name,
      chain_id: args.chain.id,
      reorg_depth: reorgedBlocks.length,
      common_ancestor_block: commonAncestor.number,
      duration: endClock(),
    });

    // remove reorged blocks from `childAddresses`
    for (const block of reorgedBlocks) {
      for (const factory of factories) {
        const addresses = childAddressesPerBlock
          .get(block.number)!
          .get(factory)!;
        for (const address of addresses) {
          childAddresses.get(factory.id)!.delete(address);
        }
      }
      childAddressesPerBlock.delete(block.number);
    }

    return {
      type: "reorg",
      block: commonAncestor,
      reorgedBlocks,
    };
  };

  /**
   * Finish syncing a block.
   *
   * The four cases are:
   * 1) Block is the same as the one just processed, no-op.
   * 2) Block is behind the last processed. This is a sign that
   *    a reorg has occurred.
   * 3) Block is more than one ahead of the last processed,
   *    fetch all intermediate blocks and enqueue them again.
   * 4) Block is exactly one block ahead of the last processed,
   *    handle this new block (happy path).
   *
   * @dev `blockCallback` is guaranteed to be called exactly once or an error is thrown.
   * @dev It is an invariant that the correct events are generated or an error is thrown.
   */
  const reconcileBlock = async function* (
    blockWithEventData: BlockWithEventData,
    blockCallback?: (isAccepted: boolean) => void,
  ): AsyncGenerator<RealtimeSyncEvent> {
    const endClock = startClock();

    const latestBlock = getLatestUnfinalizedBlock();
    const block = blockWithEventData.block;

    // We already saw and handled this block. No-op.
    if (latestBlock.hash === block.hash) {
      args.common.logger.trace({
        msg: "Detected duplicate block",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: block.number,
        hash: block.hash,
      });

      blockCallback?.(false);
      return;
    }

    // Quickly check for a reorg by comparing block numbers. If the block
    // number has not increased, a reorg must have occurred.
    if (latestBlock.number >= block.number) {
      const reorgEvent = await reconcileReorg(block);

      blockCallback?.(false);
      yield reorgEvent;
      return;
    }

    // Blocks are missing. They should be fetched and enqueued.
    if (latestBlock.number + 1 < block.number) {
      args.common.logger.trace({
        msg: "Missing blocks from local chain",
        chain: args.chain.name,
        chain_id: args.chain.id,
        block_range: JSON.stringify([
          latestBlock.number + 1,
          block.number - 1,
        ]),
      });

      // Retrieve missing blocks, but only fetch a certain amount.
      const missingBlockRange = range(
        latestBlock.number + 1,
        Math.min(
          block.number,
          latestBlock.number + MAX_QUEUED_BLOCKS,
        ),
      );

      const pendingBlocks = await Promise.all(
        missingBlockRange.map((blockNumber) =>
          _starknet_getBlockByNumber(
            args.rpc,
            { blockNumber },
          ).then((block) => fetchBlockEventData(block)),
        ),
      );

      args.common.logger.debug({
        msg: "Fetched missing blocks",
        chain: args.chain.name,
        chain_id: args.chain.id,
        block_range: JSON.stringify([
          latestBlock.number + 1,
          Math.min(
            block.number - 1,
            latestBlock.number + MAX_QUEUED_BLOCKS,
          ),
        ]),
      });

      for (const pendingBlock of pendingBlocks) {
        yield* reconcileBlock(pendingBlock);
      }

      if (
        block.number - latestBlock.number >
        MAX_QUEUED_BLOCKS
      ) {
        args.common.logger.trace({
          msg: "Latest block too far ahead of local chain",
          chain: args.chain.name,
          chain_id: args.chain.id,
          number: block.number,
          hash: block.hash,
        });

        blockCallback?.(false);
      } else {
        yield* reconcileBlock(blockWithEventData, blockCallback);
      }
      return;
    }

    // Check if a reorg occurred by validating the chain of block hashes.
    if (block.parentHash !== latestBlock.hash) {
      const reorgEvent = await reconcileReorg(block);

      blockCallback?.(false);
      yield reorgEvent;
      return;
    }

    // New block is exactly one block ahead of the local chain.
    // Attempt to ingest it.

    const blockWithFilteredEventData = filterBlockEventData(blockWithEventData);

    let childAddressCount = 0;
    for (const childAddresses of blockWithFilteredEventData.childAddresses.values()) {
      childAddressCount += childAddresses.size;
    }

    args.common.logger.debug(
      {
        msg: "Added block to local chain",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: block.number,
        hash: block.hash,
        transaction_count: blockWithFilteredEventData.transactions.length,
        log_count: blockWithFilteredEventData.logs.length,
        trace_count: blockWithFilteredEventData.traces.length,
        receipt_count: blockWithFilteredEventData.transactionReceipts.length,
        child_address_count: childAddressCount,
        duration: endClock(),
      },
      ["chain", "number", "hash"],
    );

    unfinalizedBlocks.push({
      hash: block.hash,
      parentHash: block.parentHash,
      number: block.number,
      timestamp: block.timestamp,
    });

    // Make sure `transactions` can be garbage collected
    blockWithEventData.block.transactions =
      blockWithFilteredEventData.block.transactions;

    yield {
      type: "block",
      hasMatchedFilter: blockWithFilteredEventData.matchedFilters.size > 0,
      block: blockWithFilteredEventData.block,
      logs: blockWithFilteredEventData.logs,
      transactions: blockWithFilteredEventData.transactions,
      transactionReceipts: blockWithFilteredEventData.transactionReceipts,
      traces: blockWithFilteredEventData.traces,
      childAddresses: blockWithFilteredEventData.childAddresses,
      blockCallback,
    };

    // Determine if a new range has become finalized by evaluating if the
    // latest block number is 2 * finalityBlockCount >= finalized block number.
    // Essentially, there is a range the width of finalityBlockCount that is entirely
    // finalized.

    const blockMovesFinality =
      block.number >=
      finalizedBlock.number + 2 * args.chain.finalityBlockCount;
    if (blockMovesFinality) {
      const pendingFinalizedBlock = unfinalizedBlocks.find(
        (lb) =>
          lb.number ===
          block.number - args.chain.finalityBlockCount,
      )!;

      args.common.logger.debug({
        msg: "Removed finalized blocks from local chain",
        chain: args.chain.name,
        chain_id: args.chain.id,
        block_count:
          pendingFinalizedBlock.number -
          finalizedBlock.number,
        block_range: JSON.stringify([
          finalizedBlock.number + 1,
          pendingFinalizedBlock.number,
        ]),
      });

      const finalizedBlocks = unfinalizedBlocks.filter(
        (lb) =>
          lb.number <= pendingFinalizedBlock.number,
      );

      unfinalizedBlocks = unfinalizedBlocks.filter(
        (lb) =>
          lb.number > pendingFinalizedBlock.number,
      );

      for (const block of finalizedBlocks) {
        childAddressesPerBlock.delete(block.number);
      }

      finalizedBlock = pendingFinalizedBlock;

      yield {
        type: "finalize",
        block: pendingFinalizedBlock,
      };
    }
  };

  const onError = (error: Error, block?: SyncBlock | SyncBlockHeader) => {
    if (args.common.shutdown.isKilled) {
      throw new ShutdownError();
    }

    if (block) {
      args.common.logger.warn({
        msg: "Failed to fetch latest block",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: block.number,
        hash: block.hash,
        retry_count: fetchAndReconcileLatestBlockErrorCount,
        error,
      });
    } else {
      args.common.logger.warn({
        msg: "Failed to fetch latest block",
        chain: args.chain.name,
        chain_id: args.chain.id,
        retry_count: fetchAndReconcileLatestBlockErrorCount,
        error,
      });
    }

    fetchAndReconcileLatestBlockErrorCount += 1;

    // Number of retries is max(10, `MAX_LATEST_BLOCK_ATTEMPT_MS` / `args.chain.pollingInterval`)
    if (
      fetchAndReconcileLatestBlockErrorCount >= 10 &&
      fetchAndReconcileLatestBlockErrorCount * args.chain.pollingInterval >
        MAX_LATEST_BLOCK_ATTEMPT_MS
    ) {
      throw error;
    }
  };

  return {
    async *sync(block, blockCallback) {
      try {
        args.common.logger.debug({
          msg: "Received new head block",
          chain: args.chain.name,
          chain_id: args.chain.id,
          number: block.number,
          hash: block.hash,
        });

        const latestBlock = getLatestUnfinalizedBlock();

        // We already saw and handled this block. No-op.
        if (
          latestBlock.hash === block.hash ||
          latestFetchedBlock?.hash === block.hash
        ) {
          args.common.logger.trace({
            msg: "Detected duplicate block",
            chain: args.chain.name,
            chain_id: args.chain.id,
            number: block.number,
            hash: block.hash,
          });
          blockCallback?.(false);

          return;
        }

        // Register a warning timer if no new block is received within expected time
        clearTimeout(noNewBlockTimer);
        noNewBlockTimer = setTimeout(noNewBlockWarning, 30_000);

        // Note: It's possible that a block with the same hash as `block` is
        // currently being fetched but hasn't been fully reconciled. `latestFetchedBlock`
        // is used to handle this case.

        latestFetchedBlock = block;

        const blockWithEventData = await fetchBlockEventData(block);

        // Note: `reconcileBlock` must be called serially.

        await realtimeSyncLock.lock();

        try {
          yield* reconcileBlock(blockWithEventData, blockCallback);
        } finally {
          realtimeSyncLock.unlock();
        }

        latestFetchedBlock = undefined;

        fetchAndReconcileLatestBlockErrorCount = 0;
      } catch (_error) {
        blockCallback?.(false);
        onError(_error as Error, block);
      }
    },
    onError,
    get unfinalizedBlocks() {
      return unfinalizedBlocks;
    },
  };
};
