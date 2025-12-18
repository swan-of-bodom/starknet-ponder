import type {
  BlockFilter,
  Factory,
  Filter,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  LogFactory,
  LogFilter,
  RequiredBlockColumns,
  RequiredLogColumns,
  RequiredTraceColumns,
  RequiredTransactionColumns,
  RequiredTransactionReceiptColumns,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import type {
  Block,
  Log,
  Trace,
  Transaction,
  TransactionKeys,
  TransactionReceipt,
} from "@/types/starknet.js";
import { toHex64, hexToNumber } from "@/utils/hex.js";
import type { Address } from "@/utils/hex.js";
import { toLowerCase } from "@/utils/lowercase.js";

/** Returns true if `address` is an address filter. */
export const isAddressFactory = (
  address: Address | Address[] | Factory | undefined | null,
): address is LogFactory => {
  if (address === undefined || address === null || typeof address === "string")
    return false;
  return Array.isArray(address) ? isAddressFactory(address[0]) : true;
};

export const getChildAddress = ({
  log,
  factory,
}: { log: SyncLog; factory: Factory }): Address => {
  if (factory.childAddressLocation.startsWith("offset")) {
    const childAddressOffset = Number(
      factory.childAddressLocation.substring(6),
    );

    // In Starknet, log.data is an array of felt252 values, not a concatenated hex string
    // Each parameter is already a separate element in the array
    // The offset tells us the byte offset, so divide by 32 to get the array index
    if (Array.isArray(log.data)) {
      const dataIndex = childAddressOffset / 32;
      let address = log.data[dataIndex] as string;

      // Ensure address is properly padded to 66 characters (0x + 64 hex digits)
      // This is critical for matching, as Starknet addresses can have leading zeros
      if (!address.startsWith("0x")) {
        address = `0x${address}`;
      }
      // Pad to 64 hex characters (66 total with 0x prefix)
      if (address.length < 66) {
        address = `0x${address.slice(2).padStart(64, "0")}`;
      }

      return address as Address;
    } else {
      // EVM format: single hex string
      const start = 2 + 12 * 2 + childAddressOffset * 2;
      const length = 20 * 2;
      return `0x${log.data.substring(start, start + length)}`;
    }
  } else {
    // Extract address from indexed parameter (stored in keys/topics)
    const topicIndex =
      factory.childAddressLocation === "topic1"
        ? 1
        : factory.childAddressLocation === "topic2"
          ? 2
          : 3;

    // Starknet addresses are full felt252 values (not 20-byte EVM addresses)
    // Normalize to 66 characters (0x + 64 hex digits) for matching
    return toHex64(log.keys[topicIndex]!) as Address;
  }
};

export const isAddressMatched = ({
  address,
  blockNumber,
  childAddresses,
}: {
  address: Address | undefined;
  blockNumber: number;
  childAddresses: Map<Address, number>;
}) => {
  if (address === undefined) return false;

  const lowerAddress = toLowerCase(address);
  const hasAddress = childAddresses.has(lowerAddress);
  const createdAt = childAddresses.get(lowerAddress);

  if (
    hasAddress &&
    createdAt! <= blockNumber
  ) {
    return true;
  }

  return false;
};

const isValueMatched = <T extends string>(
  filterValue: T | T[] | null | undefined,
  eventValue: T | undefined,
): boolean => {
  // match all
  if (filterValue === null || filterValue === undefined) return true;

  // missing value
  if (eventValue === undefined) return false;

  // array
  if (
    Array.isArray(filterValue) &&
    filterValue.some((v) => v === toLowerCase(eventValue))
  ) {
    return true;
  }

  // single
  if (filterValue === toLowerCase(eventValue)) return true;

  return false;
};

/**
 * Returns `true` if `log` matches `filter`
 */
export const isLogFactoryMatched = ({
  factory,
  log,
}: { factory: LogFactory; log: InternalLog | SyncLog }): boolean => {
  const addresses = Array.isArray(factory.address)
    ? factory.address
    : [factory.address];

  if (addresses.every((address) => address !== toLowerCase(log.address))) {
    return false;
  }
  if (log.keys.length === 0) return false;
  if (factory.eventSelector !== toLowerCase(log.keys[0]!)) return false;
  if (
    factory.fromBlock !== undefined &&
    (typeof log.blockNumber === "number"
      ? factory.fromBlock > log.blockNumber
      : factory.fromBlock > hexToNumber(log.blockNumber))
  )
    return false;
  if (
    factory.toBlock !== undefined &&
    (typeof log.blockNumber === "number"
      ? factory.toBlock < log.blockNumber
      : factory.toBlock < hexToNumber(log.blockNumber))
  )
    return false;

  return true;
};

/**
 * Returns `true` if `log` matches `filter`
 */
export const isLogFilterMatched = ({
  filter,
  log,
}: {
  filter: LogFilter;
  log: InternalLog | SyncLog;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    Number(log.blockNumber) < (filter.fromBlock ?? 0) ||
    Number(log.blockNumber) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  const topic0Matched = isValueMatched(filter.topic0, log.keys[0]);
  if (topic0Matched === false) return false;
  if (isValueMatched(filter.topic1, log.keys[1]) === false) return false;
  if (isValueMatched(filter.topic2, log.keys[2]) === false) return false;
  if (isValueMatched(filter.topic3, log.keys[3]) === false) return false;

  if (
    isAddressFactory(filter.address) === false &&
    isValueMatched(
      filter.address as Address | Address[] | undefined,
      log.address,
    ) === false
  ) {
    return false;
  }

  return true;
};

/**
 * Returns `true` if `transaction` matches `filter`
 */
export const isTransactionFilterMatched = ({
  filter,
  transaction,
  blockNumber,
}: {
  filter: TransactionFilter;
  transaction: InternalTransaction | SyncTransaction;
  blockNumber?: number;
}): boolean => {
  // Get blockNumber from InternalTransaction or from parameter
  const txBlockNumber =
    "blockNumber" in transaction ? transaction.blockNumber : blockNumber;

  // Return `false` for out of range blocks
  if (
    txBlockNumber !== undefined &&
    (Number(txBlockNumber) < (filter.fromBlock ?? 0) ||
      Number(txBlockNumber) > (filter.toBlock ?? Number.POSITIVE_INFINITY))
  ) {
    return false;
  }

  // Get from address - Starknet Transaction uses senderAddress (only on INVOKE, DECLARE)
  const fromAddress =
    transaction.type === "INVOKE" || transaction.type === "DECLARE"
      ? transaction.senderAddress
      : undefined;

  if (
    isAddressFactory(filter.fromAddress) === false &&
    isValueMatched(
      filter.fromAddress as Address | Address[] | undefined,
      fromAddress as Address | undefined,
    ) === false
  ) {
    return false;
  }

  // Starknet transactions don't have 'to' address - skip toAddress filter if it's a factory
  // For non-factory toAddress filters, we can't match (Starknet doesn't have to field)
  if (
    isAddressFactory(filter.toAddress) === false &&
    filter.toAddress !== undefined
  ) {
    // Starknet doesn't have 'to' address, so we can't match non-factory toAddress filters
    return false;
  }

  // NOTE: `filter.includeReverted` is intentionally ignored

  return true;
};

/**
 * Returns `true` if `trace` matches `filter`
 */
export const isTraceFilterMatched = ({
  filter,
  trace,
  block,
}: {
  filter: TraceFilter;
  trace: InternalTrace | SyncTrace["trace"];
  block: Pick<InternalBlock | SyncBlock, "number">;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    Number(block.number) < (filter.fromBlock ?? 0) ||
    Number(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (
    isAddressFactory(filter.fromAddress) === false &&
    isValueMatched(
      filter.fromAddress as Address | Address[] | undefined,
      trace.from,
    ) === false
  ) {
    return false;
  }

  if (
    isAddressFactory(filter.toAddress) === false &&
    isValueMatched(
      filter.toAddress as Address | Address[] | undefined,
      trace.to ?? undefined,
    ) === false
  ) {
    return false;
  }

  if (
    isValueMatched(filter.functionSelector, trace.input.slice(0, 10)) === false
  ) {
    return false;
  }

  // NOTE: `filter.callType` and `filter.includeReverted` is intentionally ignored

  return true;
};

/**
 * Returns `true` if `trace` matches `filter`
 */
export const isTransferFilterMatched = ({
  filter,
  trace,
  block,
}: {
  filter: TransferFilter;
  trace: InternalTrace | SyncTrace["trace"];
  block: Pick<InternalBlock | SyncBlock, "number">;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    Number(block.number) < (filter.fromBlock ?? 0) ||
    Number(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  if (
    trace.value === undefined ||
    trace.value === null ||
    BigInt(trace.value) === 0n
  ) {
    return false;
  }

  if (
    isAddressFactory(filter.fromAddress) === false &&
    isValueMatched(
      filter.fromAddress as Address | Address[] | undefined,
      trace.from,
    ) === false
  ) {
    return false;
  }

  if (
    isAddressFactory(filter.toAddress) === false &&
    isValueMatched(
      filter.toAddress as Address | Address[] | undefined,
      trace.to ?? undefined,
    ) === false
  ) {
    return false;
  }

  // NOTE: `filter.includeReverted` is intentionally ignored

  return true;
};

/**
 * Returns `true` if `block` matches `filter`
 */
export const isBlockFilterMatched = ({
  filter,
  block,
}: {
  filter: BlockFilter;
  block: InternalBlock | SyncBlock | SyncBlockHeader;
}): boolean => {
  // Return `false` for out of range blocks
  if (
    Number(block.number) < (filter.fromBlock ?? 0) ||
    Number(block.number) > (filter.toBlock ?? Number.POSITIVE_INFINITY)
  ) {
    return false;
  }

  return (Number(block.number) - filter.offset) % filter.interval === 0;
};

// Starknet block include fields
export const defaultBlockInclude: (keyof Block)[] = [
  "hash",
  "number",
  "parentHash",
  "timestamp",
  "newRoot",
  "sequencerAddress",
  "starknetVersion",
  "status",
  "l1DaMode",
  "l1GasPrice",
  "l1DataGasPrice",
];

export const requiredBlockInclude: RequiredBlockColumns[] = [
  "timestamp",
  "number",
  "hash",
];

// Starknet transaction include fields
// Note: Includes all fields that exist in the database schema (ponder_sync.transactions)
export const defaultTransactionInclude: TransactionKeys[] = [
  "hash",
  "type",
  "version",
  "senderAddress",
  "nonce",
  "calldata",
  "signature",
  "resourceBounds",
  "tip",
  "paymasterData",
  "accountDeploymentData",
  "feeDataAvailabilityMode",
  "nonceDataAvailabilityMode",
  // L1_HANDLER specific
  "contractAddress",
  "entryPointSelector",
  // DECLARE specific
  "classHash",
  "compiledClassHash",
  // DEPLOY, DEPLOY_ACCOUNT specific
  "contractAddressSalt",
  "constructorCalldata",
];

export const requiredTransactionInclude: RequiredTransactionColumns[] = [
  "transactionIndex",
  "hash",
  "type",
  "version",
];

// Starknet transaction receipt include fields
export const defaultTransactionReceiptInclude: (keyof TransactionReceipt)[] = [
  "transactionHash",
  "actualFee",
  "executionStatus",
  "finalityStatus",
  "blockHash",
  "blockNumber",
  "transactionIndex",
  "messagesSent",
  "events",
  "executionResources",
  "revertReason",
  "contractAddress",
];

export const requiredTransactionReceiptInclude: RequiredTransactionReceiptColumns[] =
  ["executionStatus", "transactionHash"];

export const defaultTraceInclude: (keyof Trace)[] = [
  "traceIndex",
  "type",
  "from",
  "to",
  "gas",
  "gasUsed",
  "input",
  "output",
  "error",
  "revertReason",
  "value",
  "subcalls",
];

export const requiredTraceInclude: RequiredTraceColumns[] = [
  "traceIndex",
  "type",
  "from",
  "to",
  "input",
  "output",
  "error",
  "value",
];

export const defaultLogInclude: (keyof Log)[] = [
  "address",
  "data",
  "logIndex",
  "removed",
  "keys",
];

export const requiredLogInclude: RequiredLogColumns[] = defaultLogInclude;

export const defaultBlockFilterInclude: BlockFilter["include"] =
  defaultBlockInclude.map((value) => `block.${value}` as const);

export const requiredBlockFilterInclude: BlockFilter["include"] =
  requiredBlockInclude.map((value) => `block.${value}` as const);

export const defaultLogFilterInclude: LogFilter["include"] = [
  ...defaultLogInclude.map((value) => `log.${value}` as const),
  ...defaultTransactionInclude.map((value) => `transaction.${value}` as const),
  ...defaultBlockInclude.map((value) => `block.${value}` as const),
];

export const requiredLogFilterInclude: LogFilter["include"] = [
  ...requiredLogInclude.map((value) => `log.${value}` as const),
  ...requiredTransactionInclude.map((value) => `transaction.${value}` as const),
  ...requiredBlockInclude.map((value) => `block.${value}` as const),
];

export const defaultTransactionFilterInclude: TransactionFilter["include"] = [
  ...defaultTransactionInclude.map((value) => `transaction.${value}` as const),
  ...defaultTransactionReceiptInclude.map(
    (value) => `transactionReceipt.${value}` as const,
  ),
  ...defaultBlockInclude.map((value) => `block.${value}` as const),
];

export const requiredTransactionFilterInclude: TransactionFilter["include"] = [
  ...requiredTransactionInclude.map((value) => `transaction.${value}` as const),
  ...requiredTransactionReceiptInclude.map(
    (value) => `transactionReceipt.${value}` as const,
  ),
  ...requiredBlockInclude.map((value) => `block.${value}` as const),
];

export const defaultTraceFilterInclude: TraceFilter["include"] = [
  ...defaultBlockInclude.map((value) => `block.${value}` as const),
  ...defaultTransactionInclude.map((value) => `transaction.${value}` as const),
  ...defaultTraceInclude.map((value) => `trace.${value}` as const),
];

export const requiredTraceFilterInclude: TraceFilter["include"] = [
  ...requiredBlockInclude.map((value) => `block.${value}` as const),
  ...requiredTransactionInclude.map((value) => `transaction.${value}` as const),
  ...requiredTraceInclude.map((value) => `trace.${value}` as const),
];

export const defaultTransferFilterInclude: TransferFilter["include"] = [
  ...defaultBlockInclude.map((value) => `block.${value}` as const),
  ...defaultTransactionInclude.map((value) => `transaction.${value}` as const),
  ...defaultTraceInclude.map((value) => `trace.${value}` as const),
];

export const requiredTransferFilterInclude: TransferFilter["include"] = [
  ...requiredBlockInclude.map((value) => `block.${value}` as const),
  ...requiredTransactionInclude.map((value) => `transaction.${value}` as const),
  ...requiredTraceInclude.map((value) => `trace.${value}` as const),
];

export const unionFilterIncludeBlock = (filters: Filter[]): (keyof Block)[] => {
  const includeBlock = new Set<keyof Block>();
  for (const filter of filters) {
    for (const include of filter.include) {
      const [data, column] = include.split(".") as [string, keyof Block];
      if (data === "block") {
        includeBlock.add(column);
      }
    }
  }
  return Array.from(includeBlock);
};

export const unionFilterIncludeTransaction = (
  filters: Filter[],
): (keyof Transaction)[] => {
  const includeTransaction = new Set<keyof Transaction>();
  for (const filter of filters) {
    for (const include of filter.include) {
      const [data, column] = include.split(".") as [string, keyof Transaction];
      if (data === "transaction") {
        includeTransaction.add(column);
      }
    }
  }
  return Array.from(includeTransaction);
};

export const unionFilterIncludeTransactionReceipt = (
  filters: Filter[],
): (keyof TransactionReceipt)[] => {
  const includeTransactionReceipt = new Set<keyof TransactionReceipt>();
  for (const filter of filters) {
    for (const include of filter.include) {
      const [data, column] = include.split(".") as [
        string,
        keyof TransactionReceipt,
      ];
      if (data === "transactionReceipt") {
        includeTransactionReceipt.add(column);
      }
    }
  }
  return Array.from(includeTransactionReceipt);
};

export const unionFilterIncludeTrace = (filters: Filter[]): (keyof Trace)[] => {
  const includeTrace = new Set<keyof Trace>();
  for (const filter of filters) {
    for (const include of filter.include) {
      const [data, column] = include.split(".") as [string, keyof Trace];
      if (data === "trace") {
        includeTrace.add(column);
      }
    }
  }
  return Array.from(includeTrace);
};
