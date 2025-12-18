// TODO: Improve:
//       - Trace/Trace types not implemented yet
//       - Match transactions by index instead of `transactionHash` like in /core.
//         Waiting until this https://github.com/starkware-libs/starknet-specs/pull/327 to re-do logic
//       - Align with /core

import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
  Event,
  FactoryId,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  LogFactory,
  LogFilter,
  RawEvent,
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
  UserTransaction,
  UserTransactionReceipt,
} from "@/internal/types.js";
import type {
  Block,
  Log,
  Trace,
  TransactionReceipt,
} from "@/types/starknet.js";
import {
  EVENT_TYPES,
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { decodeEventLog } from "@/utils/decodeEventLog.js";
import { toHex64, hexToBigInt } from "@/utils/hex.js";
import type { Address, Hash, Hex } from "@/utils/hex.js";
import { never } from "@/utils/never.js";
import {
  isAddressMatched,
  isBlockFilterMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "./filter.js";
import { isAddressFactory } from "./filter.js";

/**
 * Create `RawEvent`s from raw data types
 */
export const buildEvents = ({
  sources,
  blocks,
  logs,
  transactions,
  transactionReceipts,
  traces,
  childAddresses,
  chainId,
}: {
  sources: Source[];
  blocks: InternalBlock[];
  logs: InternalLog[];
  transactions: InternalTransaction[];
  transactionReceipts: InternalTransactionReceipt[];
  traces: InternalTrace[];
  childAddresses: Map<FactoryId, Map<Address, number>>;
  chainId: number;
}) => {
  const events: RawEvent[] = [];

  const blockSourceIndexes: number[] = [];
  const transactionSourceIndexes: number[] = [];
  const logSourceIndexes: number[] = [];
  const traceSourceIndexes: number[] = [];
  const transferSourceIndexes: number[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    if (chainId !== source.filter.chainId) continue;
    if (source.filter.type === "block") {
      blockSourceIndexes.push(i);
    } else if (source.filter.type === "transaction") {
      transactionSourceIndexes.push(i);
    } else if (source.filter.type === "log") {
      logSourceIndexes.push(i);
    } else if (source.filter.type === "trace") {
      traceSourceIndexes.push(i);
    } else if (source.filter.type === "transfer") {
      transferSourceIndexes.push(i);
    }
  }

  let blocksIndex = 0;
  let transactionsIndex = 0;
  let transactionReceiptsIndex = 0;

  for (const block of blocks) {
    for (const blockSourceIndex of blockSourceIndexes) {
      const filter = sources[blockSourceIndex]!.filter as BlockFilter;
      if (isBlockFilterMatched({ filter, block })) {
        events.push({
          chainId: filter.chainId,
          sourceIndex: blockSourceIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber: block.number,
            transactionIndex: MAX_CHECKPOINT.transactionIndex,
            eventType: EVENT_TYPES.blocks,
            eventIndex: ZERO_CHECKPOINT.eventIndex,
          }),
          block,
          log: undefined,
          trace: undefined,
          transaction: undefined,
          transactionReceipt: undefined,
        });
      }
    }
  }

  for (const transaction of transactions) {
    const blockNumber = transaction.blockNumber;
    const transactionIndex = transaction.transactionIndex;

    while (
      blocksIndex < blocks.length &&
      Number(blocks[blocksIndex]!.number) < blockNumber
    ) {
      blocksIndex++;
    }

    const block = blocks[blocksIndex]!;

    if (block === undefined) {
      throw new Error(
        `Failed to build events from block data. Missing block ${blockNumber} for chain ID ${chainId}`,
      );
    }

    while (
      transactionReceiptsIndex < transactionReceipts.length &&
      (transactionReceipts[transactionReceiptsIndex]!.blockNumber <
        blockNumber ||
        (transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
          blockNumber &&
          transactionReceipts[transactionReceiptsIndex]!.transactionIndex <
            transactionIndex))
    ) {
      transactionReceiptsIndex++;
    }

    const transactionReceipt = transactionReceipts[transactionReceiptsIndex]!;

    for (const transactionSourceIndex of transactionSourceIndexes) {
      const filter = sources[transactionSourceIndex]!
        .filter as TransactionFilter;
      // Get senderAddress if present (only on INVOKE, DECLARE)
      const txSenderAddress =
        transaction.type === "INVOKE" || transaction.type === "DECLARE"
          ? transaction.senderAddress ?? undefined
          : undefined;

      if (
        isTransactionFilterMatched({ filter, transaction }) &&
        (isAddressFactory(filter.fromAddress)
          ? isAddressMatched({
              // Starknet uses senderAddress instead of from
              address: txSenderAddress,
              blockNumber,
              childAddresses: childAddresses.get(filter.fromAddress.id)!,
            })
          : true) &&
        // Starknet transactions don't have 'to' - skip factory check
        (isAddressFactory(filter.toAddress) ? false : true) &&
        (filter.includeReverted
          ? true
          : transactionReceipt.executionStatus === "SUCCEEDED")
      ) {
        if (filter.hasTransactionReceipt && transactionReceipt === undefined) {
          throw new Error(
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
          );
        }

        events.push({
          chainId: filter.chainId,
          sourceIndex: transactionSourceIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber,
            transactionIndex,
            eventType: EVENT_TYPES.transactions,
            eventIndex: 0n,
          }),
          log: undefined,
          trace: undefined,
          block,
          transaction: transaction
            ? internalTransactionToUserTransaction({ transaction })
            : undefined,
          // Cast needed: internal uses number for blockNumber, user type uses bigint
          transactionReceipt: transactionReceipt as unknown as UserTransactionReceipt | undefined,
        });
      }
    }
  }

  blocksIndex = 0;
  transactionReceiptsIndex = 0;

  for (const trace of traces) {
    const blockNumber = trace.blockNumber;
    const transactionIndex = trace.transactionIndex;
    const traceIndex = trace.traceIndex;

    while (
      blocksIndex < blocks.length &&
      Number(blocks[blocksIndex]!.number) < blockNumber
    ) {
      blocksIndex++;
    }

    const block = blocks[blocksIndex]!;

    if (block === undefined) {
      throw new Error(
        `Failed to build events from block data. Missing block ${blockNumber} for chain ID ${chainId}`,
      );
    }

    while (
      transactionsIndex < transactions.length &&
      (transactions[transactionsIndex]!.blockNumber < blockNumber ||
        (transactions[transactionsIndex]!.blockNumber === blockNumber &&
          transactions[transactionsIndex]!.transactionIndex < transactionIndex))
    ) {
      transactionsIndex++;
    }

    let transaction: InternalTransaction | undefined;
    if (
      transactionsIndex < transactions.length &&
      transactions[transactionsIndex]!.blockNumber === blockNumber &&
      transactions[transactionsIndex]!.transactionIndex === transactionIndex
    ) {
      transaction = transactions[transactionsIndex]!;
    }

    if (transaction === undefined) {
      throw new Error(
        `Failed to build events from block data. Missing transaction for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
      );
    }

    while (
      transactionReceiptsIndex < transactionReceipts.length &&
      (transactionReceipts[transactionReceiptsIndex]!.blockNumber <
        blockNumber ||
        (transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
          blockNumber &&
          transactionReceipts[transactionReceiptsIndex]!.transactionIndex <
            transactionIndex))
    ) {
      transactionReceiptsIndex++;
    }

    let transactionReceipt: InternalTransactionReceipt | undefined;
    if (
      transactionReceiptsIndex < transactionReceipts.length &&
      transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
        blockNumber &&
      transactionReceipts[transactionReceiptsIndex]!.transactionIndex ===
        transactionIndex
    ) {
      transactionReceipt = transactionReceipts[transactionReceiptsIndex]!;
    }

    for (const traceSourceIndex of traceSourceIndexes) {
      const filter = sources[traceSourceIndex]!.filter as TraceFilter;

      if (
        isTraceFilterMatched({ filter, trace, block }) &&
        (isAddressFactory(filter.fromAddress)
          ? isAddressMatched({
              address: trace.from,
              blockNumber,
              childAddresses: childAddresses.get(filter.fromAddress.id)!,
            })
          : true) &&
        (isAddressFactory(filter.toAddress)
          ? isAddressMatched({
              address: trace.to ?? undefined,
              blockNumber,
              childAddresses: childAddresses.get(filter.toAddress.id)!,
            })
          : true) &&
        (filter.callType === undefined
          ? true
          : filter.callType === trace.type) &&
        (filter.includeReverted ? true : trace.error === undefined)
      ) {
        if (filter.hasTransactionReceipt && transactionReceipt === undefined) {
          throw new Error(
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
          );
        }

        events.push({
          chainId: filter.chainId,
          sourceIndex: traceSourceIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber,
            transactionIndex,
            eventType: EVENT_TYPES.traces,
            eventIndex: traceIndex,
          }),
          log: undefined,
          trace,
          block,
          transaction: transaction
            ? internalTransactionToUserTransaction({ transaction })
            : undefined,
          transactionReceipt: (filter.hasTransactionReceipt
            ? transactionReceipt
            : undefined) as unknown as UserTransactionReceipt | undefined,
        });
      }
    }

    for (const transferSourceIndex of transferSourceIndexes) {
      const filter = sources[transferSourceIndex]!.filter as TransferFilter;

      if (
        isTransferFilterMatched({ filter, trace, block }) &&
        (isAddressFactory(filter.fromAddress)
          ? isAddressMatched({
              address: trace.from,
              blockNumber,
              childAddresses: childAddresses.get(filter.fromAddress.id)!,
            })
          : true) &&
        (isAddressFactory(filter.toAddress)
          ? isAddressMatched({
              address: trace.to ?? undefined,
              blockNumber,
              childAddresses: childAddresses.get(filter.toAddress.id)!,
            })
          : true) &&
        (filter.includeReverted ? true : trace.error === undefined)
      ) {
        if (filter.hasTransactionReceipt && transactionReceipt === undefined) {
          throw new Error(
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
          );
        }

        events.push({
          chainId: filter.chainId,
          sourceIndex: transferSourceIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber,
            transactionIndex,
            eventType: EVENT_TYPES.traces,
            eventIndex: trace.traceIndex,
          }),
          log: undefined,
          trace,
          block,
          transaction: transaction
            ? internalTransactionToUserTransaction({ transaction })
            : undefined,
          transactionReceipt: (filter.hasTransactionReceipt
            ? transactionReceipt
            : undefined) as unknown as UserTransactionReceipt | undefined,
        });
      }
    }
  }

  blocksIndex = 0;
  transactionsIndex = 0;
  transactionReceiptsIndex = 0;

  for (const log of logs) {
    const blockNumber = log.blockNumber;
    const transactionIndex = log.transactionIndex;

    while (
      blocksIndex < blocks.length &&
      Number(blocks[blocksIndex]!.number) < blockNumber
    ) {
      blocksIndex++;
    }

    const block = blocks[blocksIndex]!;

    if (block === undefined) {
      throw new Error(
        `Failed to build events from block data. Missing block ${blockNumber} for chain ID ${chainId}`,
      );
    }

    // For Starknet, match by transactionHash since starknet_getEvents
    // doesn't return accurate transactionIndex
    let transaction: InternalTransaction | undefined;
    if (log.transactionHash) {
      transaction = transactions.find(
        (tx) =>
          tx.blockNumber === blockNumber && tx.hash === log.transactionHash,
      );
    }

    // Note: transaction can be undefined if the transaction wasn't fetched.

    while (
      transactionReceiptsIndex < transactionReceipts.length &&
      (transactionReceipts[transactionReceiptsIndex]!.blockNumber <
        blockNumber ||
        (transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
          blockNumber &&
          transactionReceipts[transactionReceiptsIndex]!.transactionIndex <
            transactionIndex))
    ) {
      transactionReceiptsIndex++;
    }

    let transactionReceipt: InternalTransactionReceipt | undefined;
    if (
      transactionReceiptsIndex < transactionReceipts.length &&
      transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
        blockNumber &&
      transactionReceipts[transactionReceiptsIndex]!.transactionIndex ===
        transactionIndex
    ) {
      transactionReceipt = transactionReceipts[transactionReceiptsIndex]!;
    }

    for (const logSourceIndex of logSourceIndexes) {
      const filter = sources[logSourceIndex]!.filter as LogFilter;
      const filterMatched = isLogFilterMatched({ filter, log });

      const isFactory = isAddressFactory(filter.address);
      const addressMatched = isFactory
        ? isAddressMatched({
            address: log.address,
            blockNumber,
            childAddresses: childAddresses.get((filter.address as LogFactory).id)!,
          })
        : true;

      if (filterMatched && addressMatched) {
        if (filter.hasTransactionReceipt && transactionReceipt === undefined) {
          throw new Error(
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
          );
        }

        events.push({
          chainId: filter.chainId,
          sourceIndex: logSourceIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber,
            transactionIndex: log.transactionIndex,
            eventType: EVENT_TYPES.logs,
            eventIndex: log.logIndex,
          }),
          log: internalLogToLog({ log }),
          block,
          transaction: transaction
            ? internalTransactionToUserTransaction({ transaction })
            : undefined,
          transactionReceipt: (filter.hasTransactionReceipt
            ? transactionReceipt
            : undefined) as unknown as UserTransactionReceipt | undefined,
          trace: undefined,
        });
      }
    }
  }

  const sorted = events.sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
  return sorted;
};

export const splitEvents = (
  events: Event[],
): { events: Event[]; chainId: number; checkpoint: string }[] => {
  let hash: Hash | undefined;
  const result: { events: Event[]; chainId: number; checkpoint: string }[] = [];

  for (const event of events) {
    if (hash === undefined || hash !== event.event.block.hash) {
      result.push({
        events: [],
        chainId: event.chainId,
        checkpoint: encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: event.event.block.timestamp,
          chainId: BigInt(event.chainId),
          blockNumber: event.event.block.number,
        }),
      });
      hash = event.event.block.hash;
    }

    result[result.length - 1]!.events.push(event);
  }

  return result;
};

export const decodeEvents = (
  common: Common,
  sources: Source[],
  rawEvents: RawEvent[],
): Event[] => {
  const events: Event[] = [];

  const logDecodeFailureSelectors = new Set<Hex>();
  let logDecodeFailureCount = 0;
  let logDecodeSuccessCount = 0;

  for (const event of rawEvents) {
    const source = sources[event.sourceIndex]!;

    switch (source.type) {
      case "contract": {
        switch (source.filter.type) {
          case "log": {
            const selector = event.log!.keys[0];
            if (selector === undefined) {
              break;
            }

            const abiItem = (source.abiEvents.bySelector as any)[selector];
            if (abiItem === undefined) {
              break;
            }

            const { safeName, item } = abiItem;

            let args: any;
            try {
              // event.log.data is already parsed to Hex[] by internalLogToLog
              args = decodeEventLog({
                abiItem: item,
                data: event.log!.data,
                keys: event.log!.keys,
                fullAbi: source.abi,
              });
              logDecodeSuccessCount++;
            } catch (err) {
              logDecodeFailureCount++;
              if (!logDecodeFailureSelectors.has(selector)) {
                logDecodeFailureSelectors.add(selector);
                common.logger.debug({
                  msg: "Failed to decode matched event log using provided ABI item",
                  chain: source.chain.name,
                  chain_id: source.chain.id,
                  event: safeName,
                  block_number: event?.block?.number ?? "unknown",
                  log_index: event.log?.logIndex,
                  data: event.log?.data,
                  keys: JSON.stringify(event.log?.keys),
                });
              }
              break;
            }

            events.push({
              type: "log",
              chainId: event.chainId,
              checkpoint: event.checkpoint,

              name: `${source.name}:${safeName}`,

              event: {
                id: event.checkpoint,
                args,
                log: event.log!,
                block: event.block as Block,
                transaction: event.transaction!,
                transactionReceipt: event.transactionReceipt as TransactionReceipt,
              },
            });
            break;
          }

          case "trace": {
            // TODO: Trace decoding not implemented for Starknet
            // Cairo function calls use a different calldata format than EVM ABI encoding
            // Need to implement proper Starknet trace decoding using starknet.js
            break;
          }

          default:
            never(source.filter);
        }
        break;
      }

      case "account": {
        switch (source.filter.type) {
          case "transaction": {
            const isFrom = source.filter.toAddress === undefined;

            events.push({
              type: "transaction",
              chainId: event.chainId,
              checkpoint: event.checkpoint,

              name: `${source.name}:transaction:${isFrom ? "from" : "to"}`,

              event: {
                id: event.checkpoint,
                block: event.block as Block,
                transaction: event.transaction!,
                transactionReceipt:
                  event.transactionReceipt as TransactionReceipt,
              },
            });

            break;
          }

          case "transfer": {
            const isFrom = source.filter.toAddress === undefined;

            events.push({
              type: "transfer",
              chainId: event.chainId,
              checkpoint: event.checkpoint,

              name: `${source.name}:transfer:${isFrom ? "from" : "to"}`,

              event: {
                id: event.checkpoint,
                transfer: {
                  from: event.trace!.from,
                  to: event.trace!.to!,
                  value: event.trace!.value!,
                },
                block: event.block as Block,
                transaction: event.transaction!,
                transactionReceipt:
                  event.transactionReceipt as TransactionReceipt,
                trace: event.trace! as Trace,
              },
            });

            break;
          }
        }
        break;
      }

      case "block": {
        events.push({
          type: "block",
          chainId: event.chainId,
          checkpoint: event.checkpoint,
          name: `${source.name}:block`,
          event: {
            id: event.checkpoint,
            block: event.block as Block,
          },
        });
        break;
      }

      default:
        never(source);
    }
  }

  if (logDecodeFailureCount > 0) {
    common.logger.debug({
      msg: "Event batch contained logs that could not be decoded",
      failure_count: logDecodeFailureCount,
      success_count: logDecodeSuccessCount,
    });
  }


  return events;
};

export const syncBlockToInternal = ({
  block,
}: { block: SyncBlock | SyncBlockHeader }): InternalBlock => ({
  // Required fields from StarknetBlock
  hash: block.hash,
  number: BigInt(block.number),
  parentHash: block.parentHash,
  timestamp: BigInt(block.timestamp),

  // Starknet-specific fields
  newRoot: block.newRoot,
  sequencerAddress: toHex64(block.sequencerAddress) as Address,
  starknetVersion: block.starknetVersion,
  status: block.status,
  l1DaMode: block.l1DaMode,
  l1GasPrice: block.l1GasPrice,
  l1DataGasPrice: block.l1DataGasPrice,
});

export const syncLogToInternal = ({ log }: { log: SyncLog }): InternalLog => ({
  blockNumber: log.blockNumber,
  logIndex: log.logIndex,
  transactionIndex: log.transactionIndex,
  transactionHash: log.transactionHash,
  address: toHex64(log.address!) as Address,
  data: log.data,
  removed: false,
  keys: log.keys,
});

export const internalLogToLog = ({ log }: { log: InternalLog }): Log => {
  // Parse JSON string back to array (Starknet data is array of felts)
  // Internal storage stringifies the array, so we need to parse it back
  let parsedData: Hex[];
  if (typeof log.data === "string" && log.data.startsWith("[")) {
    parsedData = JSON.parse(log.data);
  } else if (Array.isArray(log.data)) {
    parsedData = log.data;
  } else {
    parsedData = [log.data];
  }

  return {
    address: log.address,
    data: parsedData,
    logIndex: log.logIndex,
    removed: log.removed,
    keys: log.keys,
  };
};

/**
 * Convert InternalTransaction to user-facing UserTransaction.
 * Creates a fresh object with all properties enumerable to ensure
 * they show up in console.log (Drizzle query results can have
 * non-enumerable properties that don't display).
 */
export const internalTransactionToUserTransaction = ({
  transaction,
}: {
  transaction: InternalTransaction;
}): UserTransaction => ({
  hash: transaction.hash,
  type: transaction.type,
  version: transaction.version,
  senderAddress: transaction.senderAddress ?? null,
  nonce: transaction.nonce ?? null,
  calldata: transaction.calldata ?? null,
  signature: transaction.signature ?? null,
  transactionIndex: transaction.transactionIndex,
  resourceBounds: transaction.resourceBounds ?? null,
  tip: transaction.tip ?? null,
  paymasterData: transaction.paymasterData ?? null,
  accountDeploymentData: transaction.accountDeploymentData ?? null,
  feeDataAvailabilityMode: transaction.feeDataAvailabilityMode ?? null,
  nonceDataAvailabilityMode: transaction.nonceDataAvailabilityMode ?? null,
  // L1_HANDLER specific
  contractAddress: transaction.contractAddress ?? null,
  entryPointSelector: transaction.entryPointSelector ?? null,
  // DECLARE specific
  classHash: transaction.classHash ?? null,
  compiledClassHash: transaction.compiledClassHash ?? null,
  // DEPLOY, DEPLOY_ACCOUNT specific
  contractAddressSalt: transaction.contractAddressSalt ?? null,
  constructorCalldata: transaction.constructorCalldata ?? null,
});

export const syncTransactionToInternal = ({
  transaction,
  blockNumber,
}: {
  transaction: SyncTransaction;
  blockNumber: number;
}): InternalTransaction => {
  // Get senderAddress (only on INVOKE, DECLARE)
  const senderAddress =
    transaction.type === "INVOKE" || transaction.type === "DECLARE"
      ? toHex64(transaction.senderAddress) as Address
      : null;

  // Get nonce (not on DEPLOY)
  const nonce =
    transaction.type !== "DEPLOY"
      ? transaction.nonce
      : null;

  // Get calldata (INVOKE, L1_HANDLER have calldata; DEPLOY, DEPLOY_ACCOUNT have constructorCalldata)
  const calldata =
    transaction.type === "INVOKE" || transaction.type === "L1_HANDLER"
      ? transaction.calldata
      : transaction.type === "DEPLOY" || transaction.type === "DEPLOY_ACCOUNT"
        ? transaction.constructorCalldata
        : null;

  // Get signature (not on L1_HANDLER, DEPLOY)
  const signature =
    transaction.type === "L1_HANDLER" || transaction.type === "DEPLOY"
      ? null
      : transaction.signature;

  // Get v3 fee fields (not on L1_HANDLER, DEPLOY)
  const hasV3Fields = transaction.type !== "L1_HANDLER" && transaction.type !== "DEPLOY";
  const resourceBounds = hasV3Fields ? transaction.resourceBounds ?? null : null;
  const tip = hasV3Fields ? transaction.tip ?? null : null;
  const paymasterData = hasV3Fields ? transaction.paymasterData ?? null : null;
  const accountDeploymentData = hasV3Fields ? transaction.accountDeploymentData ?? null : null;
  const feeDataAvailabilityMode = hasV3Fields ? transaction.feeDataAvailabilityMode ?? null : null;
  const nonceDataAvailabilityMode = hasV3Fields ? transaction.nonceDataAvailabilityMode ?? null : null;

  // L1_HANDLER specific fields
  const contractAddress =
    transaction.type === "L1_HANDLER"
      ? toHex64(transaction.contractAddress) as Address
      : null;
  const entryPointSelector =
    transaction.type === "L1_HANDLER"
      ? toHex64(transaction.entryPointSelector) as Hex
      : null;

  // DECLARE specific fields
  const classHash =
    transaction.type === "DECLARE" || transaction.type === "DEPLOY" || transaction.type === "DEPLOY_ACCOUNT"
      ? toHex64(transaction.classHash) as Hex
      : null;
  const compiledClassHash =
    transaction.type === "DECLARE"
      ? transaction.compiledClassHash ? toHex64(transaction.compiledClassHash) as Hex : null
      : null;

  // DEPLOY, DEPLOY_ACCOUNT specific fields
  const contractAddressSalt =
    transaction.type === "DEPLOY" || transaction.type === "DEPLOY_ACCOUNT"
      ? toHex64(transaction.contractAddressSalt) as Hex
      : null;
  const constructorCalldata =
    transaction.type === "DEPLOY" || transaction.type === "DEPLOY_ACCOUNT"
      ? transaction.constructorCalldata
      : null;

  return {
    // Required fields
    blockNumber,
    transactionIndex: transaction.transactionIndex,
    hash: transaction.hash,

    // Starknet-specific fields
    senderAddress,
    nonce,
    version: transaction.version,

    // Map Starknet transaction type to uppercase (matching the discriminated union)
    type: transaction.type,

    // Transaction data
    calldata,
    signature,
    resourceBounds,
    tip,
    paymasterData,
    accountDeploymentData,
    feeDataAvailabilityMode,
    nonceDataAvailabilityMode,

    // L1_HANDLER specific
    contractAddress,
    entryPointSelector,

    // DECLARE specific
    classHash,
    compiledClassHash,

    // DEPLOY, DEPLOY_ACCOUNT specific
    contractAddressSalt,
    constructorCalldata,
  };
};

export const syncTransactionReceiptToInternal = ({
  transactionReceipt,
}: {
  transactionReceipt: SyncTransactionReceipt;
}): InternalTransactionReceipt => {
  return {
    // Required Starknet receipt fields
    transactionHash: transactionReceipt.transactionHash,
    executionStatus: transactionReceipt.executionStatus,
    finalityStatus: transactionReceipt.finalityStatus,
    blockHash: transactionReceipt.blockHash,
    blockNumber: transactionReceipt.blockNumber,
    transactionIndex: transactionReceipt.transactionIndex,

    actualFee: transactionReceipt.actualFee,
    events: transactionReceipt.events.map((event) => ({
      fromAddress: toHex64(event.fromAddress) as Address,
      keys: event.keys,
      data: event.data,
    })),
    executionResources: {
      l1DataGas: transactionReceipt.executionResources.l1DataGas,
      l1Gas: transactionReceipt.executionResources.l1Gas,
      l2Gas: transactionReceipt.executionResources.l2Gas,
    },
    messagesSent: transactionReceipt.messagesSent.map((msg) => ({
      fromAddress: toHex64(msg.fromAddress) as Address,
      toAddress: msg.toAddress,
      payload: msg.payload,
    })),
    contractAddress: transactionReceipt.contractAddress
      ? toHex64(transactionReceipt.contractAddress) as Address
      : undefined,
    revertReason: transactionReceipt.revertReason,
  };
};

// Map EVM trace type to Starknet trace type
const mapTraceType = (evmType: string): "CALL" | "LIBRARY_CALL" | "DELEGATE" | "CONSTRUCTOR" => {
  switch (evmType) {
    case "CALL":
    case "STATICCALL":
      return "CALL";
    case "DELEGATECALL":
    case "CALLCODE":
      return "DELEGATE";
    case "CREATE":
    case "CREATE2":
      return "CONSTRUCTOR";
    default:
      return "CALL";
  }
};

export const syncTraceToInternal = ({
  trace,
  block,
  transaction,
}: {
  trace: SyncTrace;
  block: Pick<SyncBlock, "number">;
  transaction: Pick<SyncTransaction, "transactionIndex">;
}): InternalTrace => ({
  blockNumber: block.number,
  traceIndex: trace.trace.index,
  transactionIndex: transaction.transactionIndex,
  type: mapTraceType(trace.trace.type),
  from: toHex64(trace.trace.from) as Address,
  to: trace.trace.to ? toHex64(trace.trace.to) as Address : null,
  gas: hexToBigInt(trace.trace.gas),
  gasUsed: hexToBigInt(trace.trace.gasUsed),
  input: trace.trace.input,
  output: trace.trace.output,
  error: trace.trace.error,
  revertReason: trace.trace.revertReason,
  value: trace.trace.value ? hexToBigInt(trace.trace.value) : null,
  subcalls: trace.trace.subcalls,
});
