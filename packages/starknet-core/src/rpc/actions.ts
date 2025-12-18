// TODO: Improve:
//       - Major rewrite, completely different RPC API
//       - Align with /core
//       - No TX Index on logs, See here: https://github.com/starkware-libs/starknet-specs/pull/327
//         If included in next rpc update we will need to re-write some logic

import type {
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import { RpcProviderError } from "@/internal/errors.js";
import type {
  Rpc,
  StarknetEvent,
  StarknetGetEventsResponse,
} from "@/rpc/index.js";
import type { Logger } from "@/internal/logger.js";
import { toHex64, hexToBigInt, zeroHash } from "@/utils/hex.js";
import type { Hash, Hex } from "@/utils/hex.js";
import { PG_BIGINT_MAX, PG_INTEGER_MAX } from "@/utils/pg.js";

/**
 * Replaces `eth_getBlockByNumber`.
 * Starknet does not have a `getBlockByNumber` endpoint,
 * so we use `starknet_getBlockWithTxns` with `blockTag` arg as an equivalent to `_eth_getBlockByNumber`
 * Allows to pass `latest`, `pending` unlike getBlcokByHash
 */
export const _starknet_getBlockByNumber = async (
  rpc: Rpc,
  {
    blockNumber,
    blockTag,
  }:
    | { blockNumber: number; blockTag?: never }
    | { blockNumber?: never; blockTag: "latest" | "pending" },
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncBlock> => {
  try {
    const blockIdentifier =
      blockNumber !== undefined ? { block_number: blockNumber } : blockTag;

    const block = await rpc.request(
      {
        method: "starknet_getBlockWithTxs",
        params: { block_id: blockIdentifier },
      },
      context,
    );

    // Debug logging
    if (process.env.DEBUG_RPC) {
      console.log(`[DEBUG] _starknet_getBlockByNumber requested: ${blockNumber ?? blockTag}`);
      console.log(`[DEBUG] Response block_number: ${block?.block_number}, blockNumber: ${block?.blockNumber}`);
    }

    return standardizeStarknetBlock(block);
  } catch (error: any) {
    throw new RpcProviderError(
      `Failed to fetch block ${blockNumber || blockTag}: ${error.message}`,
    );
  }
};

/**
 * Replaces `eth_getBlockByHash`.
 * Starknet does not have a `getBlockByHash` endpoint,
 * so we use `getBlockWithTxns` with `block_hash` arg as an equivalent to `_eth_getBlockByHash`
 * Allows to pass `latest`, `pending` unlike getBlcokByHash
 */
export const _starknet_getBlockByHash = async (
  rpc: Rpc,
  { hash }: { hash: string },
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncBlock> => {
  try {
    const block = await rpc.request(
      {
        method: "starknet_getBlockWithTxs",
        params: { block_id: { block_hash: hash } },
      },
      context,
    );

    return standardizeStarknetBlock(block);
  } catch (error: any) {
    throw new RpcProviderError(
      `Failed to fetch block ${hash}: ${error.message}`,
    );
  }
};

/**
 * Replaces `eth_getLogs`.
 * Unlike `eth_getLogs`, `starknet_getEvents` uses pagination with continuation_token.
 */
export const _starknet_getEvents = async (
  rpc: Rpc,
  {
    address,
    fromBlock,
    toBlock,
    keys,
    logger,
  }: {
    address: string;
    fromBlock: number;
    toBlock: number;
    keys?: string[][];
    logger?: Logger;
  },
): Promise<SyncLog[]> => {
  try {
    const allEvents: SyncLog[] = [];
    let continuationToken: string | undefined = undefined;
    let pageCount = 0;
    const blockLogIndexMap = new Map<number, number>();

    // Handles pagination between block ranges
    do {
      const result: StarknetGetEventsResponse = await rpc.request({
        method: "starknet_getEvents",
        params: {
          filter: {
            from_block: { block_number: fromBlock },
            to_block: { block_number: toBlock },
            address,
            keys: keys || [],
            chunk_size: 1000,
            continuation_token: continuationToken,
          },
        },
      });

      // NOTE: Response does not have logIndex! We need to manually generate unique logIndex per block
      const processedEvents = result.events.map((event) => {
        const blockNum = event.block_number;
        const logIndex = blockLogIndexMap.get(blockNum) ?? 0;
        blockLogIndexMap.set(blockNum, logIndex + 1);
        return adaptStarknetEventToSyncLog(event, logIndex);
      });
      allEvents.push(...processedEvents);
      pageCount++;
      continuationToken = result.continuation_token;
    } while (continuationToken);

    logger;
    // DEBUG: Log pagination stats if any
    // if (pageCount > 1 && allEvents.length > 0 && logger) {
    //   logger.info({
    //     msg: "Fetched events with pagination",
    //     event_count: allEvents.length,
    //     page_count: pageCount,
    //     block_range: `[${fromBlock},${toBlock}]`,
    //   });
    // }
    return allEvents;
  } catch (error: any) {
    throw new RpcProviderError(`Failed to fetch events: ${error.message}`);
  }
};

/**
 * Replaces `eth_getBlockReceipts`.
 * Fetches block WITH transactions AND receipts in a single RPC call.
 * This is more efficient than calling getBlockWithTxs + getBlockReceipts separately.
 *
 * Returns both the standardized block and all transaction receipts.
 */
export const _starknet_getBlockWithReceipts = async (
  rpc: Rpc,
  params: { blockNumber: number } | { blockHash: Hex },
  context?: Parameters<Rpc["request"]>[1],
): Promise<{ block: SyncBlock; receipts: SyncTransactionReceipt[] }> => {
  try {
    const blockId =
      "blockNumber" in params
        ? { block_number: params.blockNumber }
        : { block_hash: params.blockHash };

    const blockWithReceipts = (await rpc.request(
      {
        method: "starknet_getBlockWithReceipts",
        params: { block_id: blockId },
      },
      context,
    )) as any; // Use any since the response structure varies

    if (!blockWithReceipts || !blockWithReceipts.transactions) {
      throw new Error(
        "Received invalid empty starknet_getBlockWithReceipts response.",
      );
    }

    // Validate required block fields
    if (!blockWithReceipts.block_hash) {
      throw new Error("Response missing block_hash");
    }

    // block_number can be a hex string or number depending on RPC provider
    const blockNumber =
      typeof blockWithReceipts.block_number === "string"
        ? Number.parseInt(
            blockWithReceipts.block_number,
            blockWithReceipts.block_number.startsWith("0x") ? 16 : 10,
          )
        : blockWithReceipts.block_number;

    // Helper to safely convert to hex64, returning default for null/undefined
    const safeToHex64 = (value: any, defaultValue: Hex = "0x0" as Hex): Hex => {
      if (value === null || value === undefined) return defaultValue;
      return toHex64(value) as Hex;
    };

    // Extract transactions from the combined response
    // The structure is: transactions: [{ transaction: {...}, receipt: {...} }]
    // The transaction_hash might be in the receipt, not the transaction object itself
    const transactions: SyncTransaction[] = blockWithReceipts.transactions.map(
      (txWithReceipt: any, index: number) => {
        // The transaction object is nested under 'transaction' key
        const tx = txWithReceipt.transaction;
        if (!tx) {
          throw new Error(
            `Transaction at index ${index} missing transaction object`,
          );
        }
        // transaction_hash might be in the receipt instead of the transaction
        // (starknet_getBlockWithReceipts puts it in receipt, starknet_getBlockWithTxs puts it in tx)
        const txHash =
          tx.transaction_hash || txWithReceipt.receipt?.transaction_hash;
        if (!txHash) {
          throw new Error(
            `Transaction at index ${index} missing transaction_hash in both tx and receipt`,
          );
        }
        // Inject transaction_hash into tx object for convertRpcTransaction
        return convertRpcTransaction(
          { ...tx, transaction_hash: txHash },
          index,
        );
      },
    );

    // Build the block object - starknet_getBlockWithReceipts includes full block header
    const block: SyncBlock = {
      hash: safeToHex64(blockWithReceipts.block_hash),
      number: blockNumber,
      parentHash: safeToHex64(blockWithReceipts.parent_hash),
      timestamp: blockWithReceipts.timestamp ?? 0,
      newRoot: safeToHex64(blockWithReceipts.new_root),
      sequencerAddress: safeToHex64(blockWithReceipts.sequencer_address),
      starknetVersion: blockWithReceipts.starknet_version || "",
      status: blockWithReceipts.status || "ACCEPTED_ON_L2",
      l1DaMode: blockWithReceipts.l1_da_mode || "BLOB",
      l1GasPrice: blockWithReceipts.l1_gas_price || {
        priceInFri: "0x0",
        priceInWei: "0x0",
      },
      l1DataGasPrice: blockWithReceipts.l1_data_gas_price || {
        priceInFri: "0x0",
        priceInWei: "0x0",
      },
      transactions,
    };

    // Extract receipts
    const receipts = blockWithReceipts.transactions.map(
      (txWithReceipt: any, index: number) => {
        const receipt = txWithReceipt.receipt;
        if (!receipt) {
          throw new Error(
            `Transaction at index ${index} missing receipt object`,
          );
        }
        const transactionHash = receipt.transaction_hash;
        if (!transactionHash) {
          throw new Error(
            `Transaction at index ${index} missing transaction_hash in receipt`,
          );
        }
        return standardizeStarknetReceipt(
          {
            ...receipt,
            block_number: blockNumber,
            block_hash: blockWithReceipts.block_hash,
          },
          index,
        );
      },
    );

    return { block, receipts };
  } catch (error: any) {
    throw new RpcProviderError(
      `Failed to fetch block with receipts: ${error.message}`,
    );
  }
};

/**
 * Replaces to `eth_getTransactionReceipt`
 * Helper function for "starknet_getTransactionReceipt" request.
 */
export const _starknet_getTransactionReceipt = async (
  rpc: Rpc,
  { hash }: { hash: string },
  context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTransactionReceipt> => {
  try {
    const receipt = await rpc.request(
      {
        method: "starknet_getTransactionReceipt",
        params: { transaction_hash: hash },
      },
      context,
    );

    return standardizeStarknetReceipt(receipt);
  } catch (error: any) {
    throw new RpcProviderError(
      `Failed to fetch transaction receipt ${hash}: ${error.message}`,
    );
  }
};

/**
 * Adapt Starknet event from RPC response to SyncLog format
 * @param event - Raw event from Starknet RPC
 * @param logIndex - Unique index for this event within its block (for checkpoint/event.id)
 */
function adaptStarknetEventToSyncLog(
  event: StarknetEvent,
  logIndex: number,
): SyncLog {
  return {
    address: toHex64(event.from_address) as Hex,
    keys:
      event.keys.length > 0
        ? (event.keys.map((k) => toHex64(k) as Hex) as [Hex, ...Hex[]])
        : [],
    data: event.data.map((d) => toHex64(d) as Hex),
    blockNumber: event.block_number,
    blockHash: toHex64(event.block_hash) as Hex,
    transactionHash: toHex64(event.transaction_hash) as Hex,
    logIndex: logIndex,
    transactionIndex: 0,
    removed: false,
  };
}

/**
 * Standardize Starknet block to SyncBlock format
 * Returns pure Starknet types with number (not hex) for numeric fields
 */
/**
 * Resource bounds type for v3 transactions
 */
type ResourceBounds = {
  l1Gas: { maxAmount: Hex; maxPricePerUnit: Hex };
  l2Gas: { maxAmount: Hex; maxPricePerUnit: Hex };
  l1DataGas?: { maxAmount: Hex; maxPricePerUnit: Hex };
};

/**
 * Convert snake_case resource_bounds to camelCase resourceBounds
 */
function convertResourceBounds(
  resourceBounds: any,
): ResourceBounds | undefined {
  if (!resourceBounds) return undefined;

  const result: ResourceBounds = {
    l1Gas: {
      maxAmount: resourceBounds.l1_gas?.max_amount || "0x0",
      maxPricePerUnit: resourceBounds.l1_gas?.max_price_per_unit || "0x0",
    },
    l2Gas: {
      maxAmount: resourceBounds.l2_gas?.max_amount || "0x0",
      maxPricePerUnit: resourceBounds.l2_gas?.max_price_per_unit || "0x0",
    },
  };

  // Add l1DataGas if present
  if (resourceBounds.l1_data_gas) {
    result.l1DataGas = {
      maxAmount: resourceBounds.l1_data_gas.max_amount || "0x0",
      maxPricePerUnit: resourceBounds.l1_data_gas.max_price_per_unit || "0x0",
    };
  }

  return result;
}

/**
 * Convert raw RPC transaction to SyncTransaction discriminated union
 */
function convertRpcTransaction(tx: any, index: number): SyncTransaction {
  if (!tx.transaction_hash) {
    throw new Error(`Transaction at index ${index} missing transaction_hash`);
  }
  const hash = toHex64(tx.transaction_hash) as Hex;
  const version = tx.version || "0x0";
  const type = tx.type || "INVOKE";

  switch (type) {
    case "INVOKE":
      return {
        hash,
        transactionIndex: index,
        type: "INVOKE",
        version,
        senderAddress: tx.sender_address
          ? (toHex64(tx.sender_address) as Hex)
          : "0x0",
        nonce: tx.nonce || "0x0",
        calldata: tx.calldata || [],
        signature: tx.signature || [],
        resourceBounds: convertResourceBounds(tx.resource_bounds),
        tip: tx.tip,
        paymasterData: tx.paymaster_data,
        accountDeploymentData: tx.account_deployment_data,
        feeDataAvailabilityMode: tx.fee_data_availability_mode,
        nonceDataAvailabilityMode: tx.nonce_data_availability_mode,
      };
    case "L1_HANDLER":
      return {
        hash,
        transactionIndex: index,
        type: "L1_HANDLER",
        version,
        nonce: tx.nonce || "0x0",
        contractAddress: tx.contract_address
          ? (toHex64(tx.contract_address) as Hex)
          : "0x0",
        entryPointSelector: tx.entry_point_selector
          ? (toHex64(tx.entry_point_selector) as Hex)
          : "0x0",
        calldata: tx.calldata || [],
      };
    case "DECLARE":
      return {
        hash,
        transactionIndex: index,
        type: "DECLARE",
        version,
        senderAddress: tx.sender_address
          ? (toHex64(tx.sender_address) as Hex)
          : "0x0",
        nonce: tx.nonce || "0x0",
        signature: tx.signature || [],
        classHash: tx.class_hash ? (toHex64(tx.class_hash) as Hex) : "0x0",
        compiledClassHash: tx.compiled_class_hash
          ? (toHex64(tx.compiled_class_hash) as Hex)
          : undefined,
        resourceBounds: convertResourceBounds(tx.resource_bounds),
        tip: tx.tip,
        paymasterData: tx.paymaster_data,
        accountDeploymentData: tx.account_deployment_data,
        feeDataAvailabilityMode: tx.fee_data_availability_mode,
        nonceDataAvailabilityMode: tx.nonce_data_availability_mode,
      };
    case "DEPLOY":
      return {
        hash,
        transactionIndex: index,
        type: "DEPLOY",
        version,
        classHash: tx.class_hash ? (toHex64(tx.class_hash) as Hex) : "0x0",
        contractAddressSalt: tx.contract_address_salt
          ? (toHex64(tx.contract_address_salt) as Hex)
          : "0x0",
        constructorCalldata: tx.constructor_calldata || [],
      };
    case "DEPLOY_ACCOUNT":
      return {
        hash,
        transactionIndex: index,
        type: "DEPLOY_ACCOUNT",
        version,
        nonce: tx.nonce || "0x0",
        signature: tx.signature || [],
        classHash: tx.class_hash ? (toHex64(tx.class_hash) as Hex) : "0x0",
        contractAddressSalt: tx.contract_address_salt
          ? (toHex64(tx.contract_address_salt) as Hex)
          : "0x0",
        constructorCalldata: tx.constructor_calldata || [],
        resourceBounds: convertResourceBounds(tx.resource_bounds),
        tip: tx.tip,
        paymasterData: tx.paymaster_data,
        accountDeploymentData: tx.account_deployment_data,
        feeDataAvailabilityMode: tx.fee_data_availability_mode,
        nonceDataAvailabilityMode: tx.nonce_data_availability_mode,
      };
    default:
      // Default to INVOKE for unknown types
      return {
        hash,
        transactionIndex: index,
        type: "INVOKE",
        version,
        senderAddress: tx.sender_address
          ? (toHex64(tx.sender_address) as Hex)
          : "0x0",
        nonce: tx.nonce || "0x0",
        calldata: tx.calldata || [],
        signature: tx.signature || [],
        resourceBounds: convertResourceBounds(tx.resource_bounds),
        tip: tx.tip,
        paymasterData: tx.paymaster_data,
        accountDeploymentData: tx.account_deployment_data,
        feeDataAvailabilityMode: tx.fee_data_availability_mode,
        nonceDataAvailabilityMode: tx.nonce_data_availability_mode,
      };
  }
}

function standardizeStarknetBlock(block: any): SyncBlock {
  // Handle both snake_case (raw RPC) and camelCase (starknetjs normalized) field names
  const blockHash = block.block_hash ?? block.blockHash;
  const blockNumber = block.block_number ?? block.blockNumber;
  const parentHash = block.parent_hash ?? block.parentHash;
  const newRoot = block.new_root ?? block.newRoot;
  const sequencerAddress = block.sequencer_address ?? block.sequencerAddress;
  const starknetVersion = block.starknet_version ?? block.starknetVersion;
  const l1DaMode = block.l1_da_mode ?? block.l1DaMode;
  const l1GasPrice = block.l1_gas_price ?? block.l1GasPrice;
  const l1DataGasPrice = block.l1_data_gas_price ?? block.l1DataGasPrice;

  // Transform Starknet transactions to pure Starknet format
  const transactions: SyncTransaction[] = (block.transactions || []).map(
    (tx: any, index: number) => convertRpcTransaction(tx, index),
  );

  return {
    hash: toHex64(blockHash) as Hex,
    number: blockNumber,
    parentHash: toHex64(parentHash) as Hex,
    timestamp: block.timestamp,
    newRoot: newRoot ? (toHex64(newRoot) as Hex) : "0x0",
    sequencerAddress: sequencerAddress
      ? (toHex64(sequencerAddress) as Hex)
      : "0x0",
    starknetVersion: starknetVersion || "",
    status: block.status || "ACCEPTED_ON_L2",
    l1DaMode: l1DaMode || "BLOB",
    l1GasPrice: l1GasPrice || { priceInFri: "0x0", priceInWei: "0x0" },
    l1DataGasPrice: l1DataGasPrice || {
      priceInFri: "0x0",
      priceInWei: "0x0",
    },
    transactions,
  };
}

/**
 * Standardize Starknet receipt to SyncTransactionReceipt format
 * Native Starknet types - no EVM compatibility fields
 * @param receipt - The Starknet receipt object (snake_case from RPC)
 * @param transactionIndex - Transaction index (used when fetching via getBlockWithReceipts)
 */
function standardizeStarknetReceipt(
  receipt: any,
  transactionIndex = 0,
): SyncTransactionReceipt {
  if (!receipt) {
    throw new Error("Receipt is undefined or null");
  }

  if (!receipt.transaction_hash) {
    throw new Error(
      `Receipt missing transaction_hash. Receipt: ${JSON.stringify(receipt)}`,
    );
  }

  // Parse actual_fee - can be string (old format) or object (new format)
  const actualFee: SyncTransactionReceipt["actualFee"] =
    typeof receipt.actual_fee === "string"
      ? { amount: receipt.actual_fee, unit: "WEI" as const }
      : {
          amount: receipt.actual_fee?.amount || "0x0",
          unit: (receipt.actual_fee?.unit || "FRI") as "WEI" | "FRI",
        };

  // Convert execution_resources from snake_case to camelCase
  // Note: RPC can return gas values in different formats depending on Starknet version:
  // 1. Direct: execution_resources.l1_gas, l1_data_gas, l2_gas (newer, post v0.13.0)
  // 2. Nested: execution_resources.data_availability.l1_gas, l1_data_gas
  // 3. Inside computation: execution_resources.total_gas_consumed.l1_gas, etc.
  // Note: Old blocks (pre-v0.13.0) will have 0 for gas fields - this is expected
  const er = receipt.execution_resources || {};
  const da = er.data_availability || {};
  const totalGas = er.total_gas_consumed || {};

  const executionResources: SyncTransactionReceipt["executionResources"] = {
    l1DataGas: er.l1_data_gas ?? da.l1_data_gas ?? totalGas.l1_data_gas ?? 0,
    l1Gas: er.l1_gas ?? da.l1_gas ?? totalGas.l1_gas ?? 0,
    l2Gas: er.l2_gas ?? totalGas.l2_gas ?? 0,
  };

  // Convert messages_sent from snake_case to camelCase
  const messagesSent: SyncTransactionReceipt["messagesSent"] = (
    receipt.messages_sent || []
  ).map((msg: any) => ({
    fromAddress: toHex64(msg.from_address) as Hex,
    toAddress: msg.to_address as Hex, // L1 address is also 0x-prefixed
    payload: msg.payload?.map((p: string) => toHex64(p) as Hex) || [],
  }));

  // Convert events from snake_case to camelCase
  const events: SyncTransactionReceipt["events"] = (receipt.events || []).map(
    (event: any) => ({
      fromAddress: toHex64(event.from_address) as Hex,
      keys: event.keys?.map((k: string) => toHex64(k) as Hex) || [],
      data: event.data?.map((d: string) => toHex64(d) as Hex) || [],
    }),
  );

  return {
    transactionHash: toHex64(receipt.transaction_hash) as Hex,
    blockHash: toHex64(receipt.block_hash) as Hex,
    blockNumber:
      typeof receipt.block_number === "number"
        ? receipt.block_number
        : Number.parseInt(receipt.block_number, 16),
    transactionIndex,
    actualFee,
    executionStatus: receipt.execution_status || "SUCCEEDED",
    finalityStatus: receipt.finality_status || "ACCEPTED_ON_L2",
    messagesSent,
    events,
    executionResources,
    revertReason: receipt.revert_reason,
    contractAddress: receipt.contract_address
      ? (toHex64(receipt.contract_address) as Hex)
      : null,
    // L1_HANDLER specific - hash of the L1 message that triggered this transaction
    messageHash: receipt.message_hash
      ? (toHex64(receipt.message_hash) as Hex)
      : undefined,
    type: receipt.type,
  };
}

/**
 * Validate that the events are consistent with the block.
 */
export function validateEventsAndBlock(block: SyncBlock, events: SyncLog[]) {
  for (const event of events) {
    if (event.blockNumber !== block.number) {
      throw new Error(
        `Event block number ${event.blockNumber} does not match expected block ${block.number}`,
      );
    }
    if (toHex64(event.blockHash) !== toHex64(block.hash)) {
      throw new Error(
        `Event block hash ${event.blockHash} does not match expected hash ${block.hash}`,
      );
    }
  }
}

/**
 * Validate receipts and block - ensures all receipts belong to the specified block
 */
export function validateReceiptsAndBlock(
  receipts: SyncTransactionReceipt[],
  block: SyncBlock,
  _method: "starknet_getBlockReceipts" | "starknet_getTransactionReceipt",
  _blockIdentifier: "number" | "hash",
): void {
  const receiptIds = new Set<string>();

  for (const [index, receipt] of receipts.entries()) {
    const id = receipt.transactionHash;
    if (receiptIds.has(id)) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The receipts array contains two objects with a 'transactionHash' of ${receipt.transactionHash}. The duplicate was found at array index ${index}.`,
      );
    } else {
      receiptIds.add(id);
    }
  }

  // Use number for transactionIndex (Starknet types)
  const transactionByIndex = new Map<number, SyncTransaction>(
    block.transactions.map((transaction) => [
      transaction.transactionIndex,
      transaction,
    ]),
  );

  for (const [index, receipt] of receipts.entries()) {
    // Normalize hashes with toHex64 for comparison (handles different padding)
    if (toHex64(block.hash) !== toHex64(receipt.blockHash)) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The receipt at array index ${index} has a 'receipt.blockHash' of ${receipt.blockHash}, but the associated block has a 'block.hash' of ${block.hash}.`,
      );
    }

    // Both block.number and receipt.blockNumber are now native numbers
    if (block.number !== receipt.blockNumber) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The receipt at array index ${index} has a 'receipt.blockNumber' of ${receipt.blockNumber}, but the associated block has a 'block.number' of ${block.number}.`,
      );
    }

    // Both are native numbers now
    const transaction = transactionByIndex.get(receipt.transactionIndex);
    if (transaction === undefined) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The receipt at array index ${index} has a 'receipt.transactionIndex' of ${receipt.transactionIndex}, but the associated 'block.transactions' array does not contain a transaction matching that 'transactionIndex'.`,
      );
    } else if (toHex64(transaction.hash) !== toHex64(receipt.transactionHash)) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The receipt at array index ${index} matches a transaction in the associated 'block.transactions' array by 'transactionIndex' ${receipt.transactionIndex}, but the receipt has a 'receipt.transactionHash' of ${receipt.transactionHash} while the transaction has a 'transaction.hash' of ${transaction.hash}.`,
      );
    }
  }
}

/**
 * Validate that the transactions are consistent with the block.
 * Note: Starknet transactions don't have blockHash/blockNumber fields - they're part of the block itself.
 */
export const validateTransactionsAndBlock = (
  block: SyncBlock,
  _blockIdentifier: "number" | "hash",
) => {
  // Use number for transactionIndex (Starknet types)
  const transactionIds = new Set<number>();
  for (const [index, transaction] of block.transactions.entries()) {
    // Validate transaction hash exists
    if (!transaction.hash) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The transaction at index ${index} of the 'block.transactions' array is missing 'transaction.hash'.`,
      );
    }

    // Validate transactionIndex matches array position
    if (transaction.transactionIndex !== index) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The transaction at array index ${index} has a 'transaction.transactionIndex' of ${transaction.transactionIndex}, but expected ${index}.`,
      );
    }

    if (transactionIds.has(transaction.transactionIndex)) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The 'block.transactions' array contains two objects with a 'transactionIndex' of ${transaction.transactionIndex}. The duplicate was found at array index ${index}.`,
      );
    } else {
      transactionIds.add(transaction.transactionIndex);
    }
  }
};

/**
 * Validate that the traces are consistent with the block.
 * Note: Starknet doesn't have native trace support like EVM debug_traceBlock.
 * This is kept for interface compatibility but may have limited validation.
 */
export const validateTracesAndBlock = (
  traces: SyncTrace[],
  block: SyncBlock,
  _blockIdentifier: "number" | "hash",
) => {
  const transactionHashes = new Set(block.transactions.map((t) => t.hash));
  for (const [index, trace] of traces.entries()) {
    if (transactionHashes.has(trace.transactionHash) === false) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The top-level trace at array index ${index} has a 'transactionHash' of ${trace.transactionHash}, but the associated 'block.transactions' array does not contain a transaction matching that hash.`,
      );
    }
  }

  // Use the fact that any transaction produces a trace to validate.
  if (block.transactions.length !== 0 && traces.length === 0) {
    throw new RpcProviderError(
      `Inconsistent RPC response data. The traces array has length 0, but the associated 'block.transactions' array has length ${block.transactions.length}.`,
    );
  }
};

/**
 * Validate that the logs are consistent with the block.
 * Note: Starknet doesn't have logsBloom - removed that check.
 */
export const validateLogsAndBlock = (
  logs: SyncLog[],
  block: SyncBlock,
  _blockIdentifier: "number" | "hash",
) => {
  const logIndexes = new Set<number>();
  // Use number for transactionIndex (Starknet types)
  const transactionByIndex = new Map<number, SyncTransaction>(
    block.transactions.map((transaction) => [
      transaction.transactionIndex,
      transaction,
    ]),
  );

  for (const [_index, log] of logs.entries()) {
    if (toHex64(block.hash) !== toHex64(log.blockHash)) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} has a 'log.blockHash' of ${log.blockHash}, but the associated block has a 'block.hash' of ${block.hash}.`,
      );
    }

    // Direct number comparison (Starknet types)
    if (block.number !== log.blockNumber) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} has a 'log.blockNumber' of ${log.blockNumber}, but the associated block has a 'block.number' of ${block.number}.`,
      );
    }

    if (log.transactionHash !== zeroHash) {
      const transaction = transactionByIndex.get(log.transactionIndex);
      if (transaction === undefined) {
        throw new RpcProviderError(
          `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} has a 'log.transactionIndex' of ${log.transactionIndex}, but the associated 'block.transactions' array does not contain a transaction matching that 'transactionIndex'.`,
        );
      } else if (toHex64(transaction.hash) !== toHex64(log.transactionHash)) {
        throw new RpcProviderError(
          `Inconsistent RPC response data. The log with 'logIndex' ${log.logIndex} matches a transaction in the associated 'block.transactions' array by 'transactionIndex' ${log.transactionIndex}, but the log has a 'log.transactionHash' of ${log.transactionHash} while the transaction has a 'transaction.hash' of ${transaction.hash}.`,
        );
      }
    }

    if (logIndexes.has(log.logIndex)) {
      throw new RpcProviderError(
        `Inconsistent RPC response data. The logs array contains two objects with 'logIndex' ${log.logIndex}.`,
      );
    } else {
      logIndexes.add(log.logIndex);
    }
  }
};

/**
 * Debug trace block by number - stub for Starknet
 * Note: Starknet doesn't have native debug_traceBlock support.
 * Returns empty traces array.
 */
export const _debug_traceBlockByNumber = (
  _rpc: Rpc,
  _params: { blockNumber: Hex | number },
  _context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTrace[]> => {
  // Starknet doesn't support debug traces
  return Promise.resolve([]);
};

/**
 * Debug trace block by hash - stub for Starknet
 * Note: Starknet doesn't have native debug_traceBlock support.
 * Returns empty traces array.
 */
export const _debug_traceBlockByHash = (
  _rpc: Rpc,
  _params: { hash: Hash },
  _context?: Parameters<Rpc["request"]>[1],
): Promise<SyncTrace[]> => {
  // Starknet doesn't support debug traces
  return Promise.resolve([]);
};

/**
 * Export standardizeBlock for WebSocket subscription handling
 * Pure Starknet types - no EVM compatibility fields
 */
export const standardizeBlock = <
  block extends
    | SyncBlock
    | (Omit<SyncBlock, "transactions"> & {
        transactions: string[] | undefined;
      }),
>(
  block: block,
  blockIdentifier: "number" | "hash" | "newHeads",
  isBlockHeader = false,
): block extends SyncBlock ? SyncBlock : SyncBlockHeader => {
  // For Starknet blocks coming from WebSocket, we need to handle the raw format
  // If it's already standardized (has Starknet fields), return as-is
  if (
    block.hash &&
    block.number !== undefined &&
    block.timestamp !== undefined
  ) {
    // Validate/set required Starknet properties with defaults
    if ((block as any).parentHash === undefined) {
      (block as any).parentHash = zeroHash;
    }
    if ((block as any).newRoot === undefined) {
      (block as any).newRoot = "0x0";
    }
    if ((block as any).sequencerAddress === undefined) {
      (block as any).sequencerAddress = "0x0";
    }
    if ((block as any).starknetVersion === undefined) {
      (block as any).starknetVersion = "";
    }
    if ((block as any).status === undefined) {
      (block as any).status = "ACCEPTED_ON_L2";
    }
    if ((block as any).l1DaMode === undefined) {
      (block as any).l1DaMode = "BLOB";
    }
    if ((block as any).l1GasPrice === undefined) {
      (block as any).l1GasPrice = { priceInFri: "0x0", priceInWei: "0x0" };
    }
    if ((block as any).l1DataGasPrice === undefined) {
      (block as any).l1DataGasPrice = { priceInFri: "0x0", priceInWei: "0x0" };
    }

    if (isBlockHeader) {
      (block as any).transactions = undefined;
      return block as unknown as block extends SyncBlock
        ? SyncBlock
        : SyncBlockHeader;
    }

    if ((block as SyncBlock).transactions) {
      (block as SyncBlock).transactions = (block as SyncBlock).transactions.map(
        (transaction) =>
          standardizeTransaction(
            transaction,
            blockIdentifier as "number" | "hash",
          ),
      );
    }

    return block as unknown as block extends SyncBlock
      ? SyncBlock
      : SyncBlockHeader;
  }

  // Handle Starknet raw block format (snake_case from RPC)
  const rawBlock = block as any;
  if (rawBlock.block_number !== undefined) {
    const standardized = standardizeStarknetBlock(rawBlock);
    if (isBlockHeader) {
      (standardized as any).transactions = undefined;
    }
    return standardized as block extends SyncBlock
      ? SyncBlock
      : SyncBlockHeader;
  }

  throw new RpcProviderError(
    "Invalid block format: missing required properties",
  );
};

/**
 * Standardize transaction - validates Starknet transaction fields
 * Note: Starknet transactions don't have blockHash/blockNumber fields - they're part of the block itself.
 */
export const standardizeTransaction = (
  transaction: SyncTransaction,
  _blockIdentifier: "number" | "hash",
): SyncTransaction => {
  // Validate required Starknet properties
  if (transaction.hash === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'transaction.hash' is a required property",
    );
  }
  if (transaction.transactionIndex === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'transaction.transactionIndex' is a required property",
    );
  }
  if (transaction.type === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'transaction.type' is a required property",
    );
  }

  // Set defaults for optional Starknet fields
  if (transaction.version === undefined) {
    transaction.version = "0x0";
  }

  // Validate numeric ranges (transactionIndex is a number in Starknet types)
  if (transaction.transactionIndex > PG_INTEGER_MAX) {
    throw new RpcProviderError(
      `Invalid RPC response: 'transaction.transactionIndex' (${transaction.transactionIndex}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
    );
  }

  // If nonce is present (not on DEPLOY transactions), validate its range
  if (transaction.type !== "DEPLOY") {
    const nonceValue = hexToBigInt(transaction.nonce);
    if (nonceValue > BigInt(PG_INTEGER_MAX)) {
      throw new RpcProviderError(
        `Invalid RPC response: 'transaction.nonce' (${nonceValue}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
      );
    }
  }

  return transaction;
};

/**
 * Standardize log
 */
export const standardizeLog = (
  log: SyncLog,
  _blockIdentifier: number | Hash,
): SyncLog => {
  // Required properties
  if (log.blockNumber === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'log.blockNumber' is a required property",
    );
  }
  if (log.logIndex === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'log.logIndex' is a required property",
    );
  }
  if (log.blockHash === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'log.blockHash' is a required property",
    );
  }
  if (log.address === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'log.address' is a required property",
    );
  }
  if (log.keys === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'log.keys' is a required property",
    );
  }
  if (log.data === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'log.data' is a required property",
    );
  }
  if (log.transactionHash === undefined) {
    log.transactionHash = zeroHash;
  }
  if (log.transactionIndex === undefined) {
    log.transactionIndex = 0;
  }

  // Non-required properties
  if (log.removed === undefined) {
    log.removed = false;
  }

  // Validate numeric ranges
  if (BigInt(log.blockNumber) > PG_BIGINT_MAX) {
    throw new RpcProviderError(
      `Invalid RPC response: 'log.blockNumber' (${log.blockNumber}) is larger than the maximum allowed value (${PG_BIGINT_MAX}).`,
    );
  }
  if (log.transactionIndex > PG_INTEGER_MAX) {
    throw new RpcProviderError(
      `Invalid RPC response: 'log.transactionIndex' (${log.transactionIndex}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
    );
  }
  if (log.logIndex > PG_INTEGER_MAX) {
    throw new RpcProviderError(
      `Invalid RPC response: 'log.logIndex' (${log.logIndex}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
    );
  }

  return log;
};

/**
 * Standardize trace
 */
export const standardizeTrace = (
  trace: SyncTrace,
  _blockIdentifier: number | Hash,
): SyncTrace => {
  // Required properties
  if (trace.transactionHash === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'trace.transactionHash' is a required property",
    );
  }
  if (trace.trace.type === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'trace.type' is a required property",
    );
  }
  if (trace.trace.from === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'trace.from' is a required property",
    );
  }
  if (trace.trace.input === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'trace.input' is a required property",
    );
  }

  // Non-required properties
  if (trace.trace.gas === undefined) {
    trace.trace.gas = "0x0";
  }
  if (trace.trace.gasUsed === undefined) {
    trace.trace.gasUsed = "0x0";
  }

  return trace;
};

/**
 * Standardize transaction receipt
 */
export const standardizeTransactionReceipt = (
  receipt: SyncTransactionReceipt,
  _method: "starknet_getBlockReceipts" | "starknet_getTransactionReceipt",
): SyncTransactionReceipt => {
  // Required properties
  if (receipt.blockHash === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'receipt.blockHash' is a required property",
    );
  }
  if (receipt.blockNumber === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'receipt.blockNumber' is a required property",
    );
  }
  if (receipt.transactionHash === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'receipt.transactionHash' is a required property",
    );
  }
  if (receipt.transactionIndex === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'receipt.transactionIndex' is a required property",
    );
  }
  if (receipt.executionStatus === undefined) {
    throw new RpcProviderError(
      "Invalid RPC response: 'receipt.executionStatus' is a required property",
    );
  }

  // Set defaults for optional properties
  if (receipt.actualFee === undefined) {
    receipt.actualFee = { amount: "0x0", unit: "FRI" };
  }
  if (receipt.finalityStatus === undefined) {
    receipt.finalityStatus = "ACCEPTED_ON_L2";
  }
  if (receipt.messagesSent === undefined) {
    receipt.messagesSent = [];
  }
  if (receipt.events === undefined) {
    receipt.events = [];
  }
  if (receipt.executionResources === undefined) {
    receipt.executionResources = { l1DataGas: 0, l1Gas: 0, l2Gas: 0 };
  }

  // Validate numeric ranges
  if (BigInt(receipt.blockNumber) > PG_BIGINT_MAX) {
    throw new RpcProviderError(
      `Invalid RPC response: 'receipt.blockNumber' (${receipt.blockNumber}) is larger than the maximum allowed value (${PG_BIGINT_MAX}).`,
    );
  }
  if (receipt.transactionIndex > PG_INTEGER_MAX) {
    throw new RpcProviderError(
      `Invalid RPC response: 'receipt.transactionIndex' (${receipt.transactionIndex}) is larger than the maximum allowed value (${PG_INTEGER_MAX}).`,
    );
  }

  return receipt;
};
