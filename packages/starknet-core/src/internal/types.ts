// TODO: Improve:
//       - Major changes compared to /core due to evm vs starknet

import type { SqlStatements } from "@/drizzle/kit/index.js";
import type { Rpc } from "@/rpc/index.js";
import type {
  Block,
  Log,
  Trace,
  TransactionKeys,
  TransactionReceipt,
  Transfer,
} from "@/types/starknet.js";
import type { PartialExcept, Prettify } from "@/types/utils.js";
import type { AbiEvents, AbiFunctions } from "@/utils/abi.js";
import type { Trace as DebugTrace } from "@/utils/debug.js";
import type { PGliteOptions } from "@/utils/pglite.js";
import type { PGlite } from "@electric-sql/pglite";
import type { Hono } from "hono";
import type { PoolConfig } from "pg";
import type {
  Address,
  Hash,
  Hex,
  LogTopic,
  Transport,
  Chain as ViemChain,
} from "viem";
import type { StarknetAbi } from "../types/starknetAbi.js";
import type { RetryableError } from "./errors.js";

// Database

export type DatabaseConfig =
  | { kind: "pglite"; options: PGliteOptions }
  | { kind: "pglite_test"; instance: PGlite }
  | { kind: "postgres"; poolConfig: Prettify<PoolConfig & { max: number }> };

// Indexing

/** Indexing functions as defined in `ponder.on()` */
export type RawIndexingFunctions = {
  /** Name of the event */
  name: string;
  /** Callback function */
  fn: (...args: any) => any;
}[];

/** Indexing functions for event callbacks */
export type IndexingFunctions = {
  [eventName: string]: (...args: any) => any;
};

// Filters

/** Filter definition based on the fundamental data model of the Ethereum blockchain. */
export type Filter =
  | LogFilter
  | BlockFilter
  | TransferFilter
  | TransactionFilter
  | TraceFilter;
export type FilterWithoutBlocks =
  | Omit<BlockFilter, "fromBlock" | "toBlock">
  | Omit<TransactionFilter, "fromBlock" | "toBlock">
  | Omit<TraceFilter, "fromBlock" | "toBlock">
  | Omit<LogFilter, "fromBlock" | "toBlock">
  | Omit<TransferFilter, "fromBlock" | "toBlock">;

/** Filter that matches addresses. */
export type Factory = LogFactory;
export type FilterAddress<
  factory extends Factory | undefined = Factory | undefined,
> = factory extends Factory ? factory : Address | Address[] | undefined;

export type BlockFilter = {
  type: "block";
  chainId: number;
  interval: number;
  offset: number;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: false;
  include: `block.${keyof Block}`[];
};

export type TransactionFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "transaction";
  chainId: number;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: true;
  include: (
    | `block.${keyof Block}`
    | `transaction.${TransactionKeys}`
    | `transactionReceipt.${keyof TransactionReceipt}`
  )[];
};

export type TraceFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "trace";
  chainId: number;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  functionSelector: Hex | Hex[] | undefined;
  callType: Trace["type"] | undefined;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: boolean;
  include: (
    | `block.${keyof Block}`
    | `transaction.${TransactionKeys}`
    | `transactionReceipt.${keyof TransactionReceipt}`
    | `trace.${keyof Trace}`
  )[];
};

export type LogFilter<
  factory extends Factory | undefined = Factory | undefined,
> = {
  type: "log";
  chainId: number;
  address: FilterAddress<factory>;
  topic0: LogTopic;
  topic1: LogTopic;
  topic2: LogTopic;
  topic3: LogTopic;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: boolean;
  include: (
    | `block.${keyof Block}`
    | `transaction.${TransactionKeys}`
    | `transactionReceipt.${keyof TransactionReceipt}`
    | `log.${keyof Log}`
  )[];
};

export type TransferFilter<
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  type: "transfer";
  chainId: number;
  fromAddress: FilterAddress<fromFactory>;
  toAddress: FilterAddress<toFactory>;
  includeReverted: boolean;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  hasTransactionReceipt: boolean;
  include: (
    | `block.${keyof Block}`
    | `transaction.${TransactionKeys}`
    | `transactionReceipt.${keyof TransactionReceipt}`
    | `trace.${keyof Trace}`
  )[];
};

export type FactoryId = string;

export type LogFactory = {
  id: FactoryId;
  type: "log";
  chainId: number;
  address: Address | Address[];
  eventSelector: Hex;
  childAddressLocation: "topic1" | "topic2" | "topic3" | `offset${number}`;
  fromBlock: number | undefined;
  toBlock: number | undefined;
};

// Fragments

export type FragmentAddress =
  | Address
  | {
      address: Address;
      eventSelector: Factory["eventSelector"];
      childAddressLocation: Factory["childAddressLocation"];
    }
  | null;

export type FragmentAddressId =
  | Address
  | `${Address}_${Factory["eventSelector"]}_${Factory["childAddressLocation"]}`
  | null;
export type FragmentTopic = Hex | null;

export type Fragment =
  | {
      type: "block";
      chainId: number;
      interval: number;
      offset: number;
    }
  | {
      type: "transaction";
      chainId: number;
      fromAddress: FragmentAddress;
      toAddress: FragmentAddress;
    }
  | {
      type: "trace";
      chainId: number;
      fromAddress: FragmentAddress;
      toAddress: FragmentAddress;
      functionSelector: Hex | null;
      includeTransactionReceipts: boolean;
    }
  | {
      type: "log";
      chainId: number;
      address: FragmentAddress;
      topic0: FragmentTopic;
      topic1: FragmentTopic;
      topic2: FragmentTopic;
      topic3: FragmentTopic;
      includeTransactionReceipts: boolean;
    }
  | {
      type: "transfer";
      chainId: number;
      fromAddress: FragmentAddress;
      toAddress: FragmentAddress;
      includeTransactionReceipts: boolean;
    };

/** Minimum slice of a {@link Filter} */
export type FragmentId =
  /** block_{chainId}_{interval}_{offset} */
  | `block_${number}_${number}_${number}`
  /** transaction_{chainId}_{fromAddress}_{toAddress} */
  | `transaction_${number}_${FragmentAddressId}_${FragmentAddressId}`
  /** trace_{chainId}_{fromAddress}_{toAddress}_{functionSelector}_{includeReceipts} */
  | `trace_${number}_${FragmentAddressId}_${FragmentAddressId}_${Hex | null}_${0 | 1}`
  /** log_{chainId}_{address}_{topic0}_{topic1}_{topic2}_{topic3}_{includeReceipts} */
  | `log_${number}_${FragmentAddressId}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${FragmentTopic}_${0 | 1}`
  /** transfer_{chainId}_{fromAddress}_{toAddress}_{includeReceipts} */
  | `transfer_${number}_${FragmentAddressId}_${FragmentAddressId}_${0 | 1}`;

// Sources

/** Event source that matches {@link Event}s containing an underlying filter and metadata. */
export type Source = ContractSource | AccountSource | BlockSource;

export type ContractSource<
  filter extends "log" | "trace" = "log" | "trace",
  factory extends Factory | undefined = Factory | undefined,
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  filter: filter extends "log"
    ? LogFilter<factory>
    : TraceFilter<fromFactory, toFactory>;
} & ContractMetadata;

export type AccountSource<
  filter extends "transaction" | "transfer" = "transaction" | "transfer",
  fromFactory extends Factory | undefined = Factory | undefined,
  toFactory extends Factory | undefined = Factory | undefined,
> = {
  filter: filter extends "transaction"
    ? TransactionFilter<fromFactory, toFactory>
    : TransferFilter<fromFactory, toFactory>;
} & AccountMetadata;

export type BlockSource = { filter: BlockFilter } & BlockMetadata;

export type ContractMetadata = {
  type: "contract";
  abi: StarknetAbi;
  abiEvents: AbiEvents;
  abiFunctions: AbiFunctions;
  name: string;
  chain: Chain;
};
export type AccountMetadata = {
  type: "account";
  name: string;
  chain: Chain;
};
export type BlockMetadata = {
  type: "block";
  name: string;
  chain: Chain;
};

// Chain

export type Chain = {
  name: string;
  id: number;
  rpc: string | string[] | Transport;
  ws?: string;
  pollingInterval: number;
  finalityBlockCount: number;
  disableCache: boolean;
  viemChain: ViemChain | undefined;
};

// Schema

/** User-defined tables, enums, and indexes. */
export type Schema = { [name: string]: unknown };

// Build artifacts

/** Database schema name. */
export type NamespaceBuild = {
  schema: string;
  viewsSchema: string | undefined;
};

/** Consolidated CLI, env vars, and config. */
export type PreBuild = {
  /** Database type and configuration */
  databaseConfig: DatabaseConfig;
  /** Ordering of events */
  ordering: "omnichain" | "multichain";
};

export type SchemaBuild = {
  schema: Schema;
  /** SQL statements to create the schema */
  statements: SqlStatements;
};

export type IndexingBuild = {
  /** Ten character hex string identifier. */
  buildId: string;
  /** Sources to index. */
  sources: Source[];
  /** Chains to index. */
  chains: Chain[];
  /** RPCs for all `chains`. */
  rpcs: Rpc[];
  /** Finalized blocks for all `chains`. */
  finalizedBlocks: LightBlock[];
  /** Event callbacks for all `sources`.  */
  indexingFunctions: IndexingFunctions;
};

export type ApiBuild = {
  /** Hostname for server */
  hostname?: string;
  /** Port number for server */
  port: number;
  /** Hono app exported from `ponder/api/index.ts`. */
  app: Hono;
};

// Crash recovery

/**
 * @dev It is not an invariant that `chainId` and `checkpoint.chainId` are the same.
 */
export type CrashRecoveryCheckpoint =
  | {
      chainId: number;
      checkpoint: string;
    }[]
  | undefined;

// Status

export type Status = {
  [chainName: string]: {
    id: number;
    block: { number: number; timestamp: number };
  };
};

// Indexing error handler

export type IndexingErrorHandler = {
  getRetryableError: () => RetryableError | undefined;
  setRetryableError: (error: RetryableError) => void;
  clearRetryableError: () => void;
  error: RetryableError | undefined;
};

// Seconds

export type Seconds = {
  [chain: string]: { start: number; end: number; cached: number };
};

// Blockchain data

// Starknet block type - clean, no EVM compatibility fields
export type StarknetBlock = {
  hash: Hex;
  number: number;
  parentHash: Hex;
  timestamp: number;
  newRoot: Hex;
  sequencerAddress: Hex;
  starknetVersion: string;
  status: "ACCEPTED_ON_L1" | "ACCEPTED_ON_L2" | "PENDING";
  l1DaMode: "BLOB" | "CALLDATA";
  l1GasPrice: {
    priceInFri: Hex;
    priceInWei: Hex;
  };
  l1DataGasPrice: {
    priceInFri: Hex;
    priceInWei: Hex;
  };
  transactions: StarknetTransaction[];
};

// Resource bounds (v3 transactions)
type SyncResourceBounds = {
  l1Gas: { maxAmount: Hex; maxPricePerUnit: Hex };
  l2Gas: { maxAmount: Hex; maxPricePerUnit: Hex };
  l1DataGas?: { maxAmount: Hex; maxPricePerUnit: Hex };
};

// Common fields added by Ponder (not from RPC)
type SyncTransactionBase = {
  hash: Hex;
  transactionIndex: number;
};

// Invoke transaction - initiates a transaction from an account
type SyncInvokeTransaction = SyncTransactionBase & {
  type: "INVOKE";
  version: Hex;
  senderAddress: Hex;
  nonce: Hex;
  calldata: Hex[];
  signature: Hex[];
  resourceBounds?: SyncResourceBounds;
  tip?: Hex;
  paymasterData?: Hex[];
  accountDeploymentData?: Hex[];
  feeDataAvailabilityMode?: "L1" | "L2";
  nonceDataAvailabilityMode?: "L1" | "L2";
};

// L1 handler transaction - a call to an l1_handler induced by a message from L1
type SyncL1HandlerTransaction = SyncTransactionBase & {
  type: "L1_HANDLER";
  version: Hex;
  nonce: Hex;
  contractAddress: Hex;
  entryPointSelector: Hex;
  calldata: Hex[];
};

// Declare transaction - declares a new contract class
type SyncDeclareTransaction = SyncTransactionBase & {
  type: "DECLARE";
  version: Hex;
  senderAddress: Hex;
  nonce: Hex;
  signature: Hex[];
  classHash: Hex;
  compiledClassHash?: Hex;
  resourceBounds?: SyncResourceBounds;
  tip?: Hex;
  paymasterData?: Hex[];
  accountDeploymentData?: Hex[];
  feeDataAvailabilityMode?: "L1" | "L2";
  nonceDataAvailabilityMode?: "L1" | "L2";
};

// Deploy transaction - deploys a contract (deprecated)
type SyncDeployTransaction = SyncTransactionBase & {
  type: "DEPLOY";
  version: Hex;
  classHash: Hex;
  contractAddressSalt: Hex;
  constructorCalldata: Hex[];
};

// Deploy account transaction - deploys an account contract
type SyncDeployAccountTransaction = SyncTransactionBase & {
  type: "DEPLOY_ACCOUNT";
  version: Hex;
  nonce: Hex;
  signature: Hex[];
  classHash: Hex;
  contractAddressSalt: Hex;
  constructorCalldata: Hex[];
  resourceBounds?: SyncResourceBounds;
  tip?: Hex;
  paymasterData?: Hex[];
  accountDeploymentData?: Hex[];
  feeDataAvailabilityMode?: "L1" | "L2";
  nonceDataAvailabilityMode?: "L1" | "L2";
};

// Discriminated union of all transaction types
// Matches `starknet_getTransactionByHash` response
export type StarknetTransaction =
  | SyncInvokeTransaction
  | SyncL1HandlerTransaction
  | SyncDeclareTransaction
  | SyncDeployTransaction
  | SyncDeployAccountTransaction;

// Type aliases
export type SyncBlock = StarknetBlock;
export type SyncBlockHeader = Omit<StarknetBlock, "transactions"> & {
  transactions: undefined;
};
export type SyncTransaction = StarknetTransaction;

// Type guards for transaction types
export const isInvokeTransaction = (
  tx: SyncTransaction,
): tx is SyncInvokeTransaction => tx.type === "INVOKE";

export const isL1HandlerTransaction = (
  tx: SyncTransaction,
): tx is SyncL1HandlerTransaction => tx.type === "L1_HANDLER";

export const isDeclareTransaction = (
  tx: SyncTransaction,
): tx is SyncDeclareTransaction => tx.type === "DECLARE";

export const isDeployTransaction = (
  tx: SyncTransaction,
): tx is SyncDeployTransaction => tx.type === "DEPLOY";

export const isDeployAccountTransaction = (
  tx: SyncTransaction,
): tx is SyncDeployAccountTransaction => tx.type === "DEPLOY_ACCOUNT";

// Check if transaction has senderAddress (INVOKE, DECLARE)
export const hasSenderAddress = (
  tx: SyncTransaction,
): tx is SyncInvokeTransaction | SyncDeclareTransaction =>
  tx.type === "INVOKE" || tx.type === "DECLARE";

// Check if transaction has signature (INVOKE, DECLARE, DEPLOY_ACCOUNT)
export const hasSignature = (
  tx: SyncTransaction,
): tx is SyncInvokeTransaction | SyncDeclareTransaction | SyncDeployAccountTransaction =>
  tx.type === "INVOKE" || tx.type === "DECLARE" || tx.type === "DEPLOY_ACCOUNT";

// Check if transaction has calldata (INVOKE, L1_HANDLER)
export const hasCalldata = (
  tx: SyncTransaction,
): tx is SyncInvokeTransaction | SyncL1HandlerTransaction =>
  tx.type === "INVOKE" || tx.type === "L1_HANDLER";

// Check if transaction has v3 fee fields (INVOKE, DECLARE, DEPLOY_ACCOUNT)
export const hasV3FeeFields = (
  tx: SyncTransaction,
): tx is SyncInvokeTransaction | SyncDeclareTransaction | SyncDeployAccountTransaction =>
  tx.type === "INVOKE" || tx.type === "DECLARE" || tx.type === "DEPLOY_ACCOUNT";

// Export individual transaction types for external use
export type {
  SyncInvokeTransaction,
  SyncL1HandlerTransaction,
  SyncDeclareTransaction,
  SyncDeployTransaction,
  SyncDeployAccountTransaction,
};

// Native Starknet receipt type (no EVM compatibility fields)
export type SyncTransactionReceipt = {
  transactionHash: Hex;
  blockHash: Hex;
  blockNumber: number;
  transactionIndex: number;
  // Starknet-native fields
  actualFee: {
    amount: Hex;
    unit: "WEI" | "FRI";
  };
  executionStatus: "SUCCEEDED" | "REVERTED";
  finalityStatus: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";
  messagesSent: Array<{
    fromAddress: Hex;
    toAddress: Hex; // L1 address as hex
    payload: Hex[];
  }>;
  events: Array<{
    fromAddress: Hex;
    keys: Hex[];
    data: Hex[];
  }>;
  executionResources: {
    /** The data gas consumed by this transaction's data, 0 if it uses gas for DA */
    l1DataGas: number;
    /** The gas consumed by this transaction's data, 0 if it uses data gas for DA */
    l1Gas: number;
    /** L2 gas consumed */
    l2Gas: number;
  };
  revertReason?: string;
  contractAddress?: Hex | null; // For DEPLOY/DEPLOY_ACCOUNT transactions
  messageHash?: Hex; // For L1_HANDLER transactions - hash of the L1 message
  type?: string;
};
export type SyncTrace = {
  trace: DebugTrace["result"] & { index: number; subcalls: number };
  transactionHash: DebugTrace["txHash"];
};

// Starknet log type with keys instead of topics
export type SyncLog = {
  address: Address;
  blockHash: Hex;
  blockNumber: number;
  data: Hex | Hex[];
  logIndex: number;
  transactionHash: Hex;
  transactionIndex: number;
  removed: boolean;
  keys: [Hex, ...Hex[]] | [];
};

export type LightBlock = Pick<
  StarknetBlock,
  "hash" | "parentHash" | "number" | "timestamp"
>;

// Required columns for Starknet types
export type RequiredBlockColumns = "timestamp" | "number" | "hash";
// Only fields common to ALL transaction types (discriminated union)
export type RequiredTransactionColumns =
  | "transactionIndex"
  | "hash"
  | "type"
  | "version";
export type RequiredTransactionReceiptColumns =
  | "executionStatus"
  | "transactionHash";
export type RequiredTraceColumns =
  | "from"
  | "to"
  | "input"
  | "output"
  | "value"
  | "type"
  | "error"
  | "traceIndex";
export type RequiredLogColumns = keyof Log;

export type RequiredInternalBlockColumns = RequiredBlockColumns;
export type RequiredInternalTransactionColumns =
  | RequiredTransactionColumns
  | "blockNumber";
export type RequiredInternalTransactionReceiptColumns =
  | RequiredTransactionReceiptColumns
  | "blockNumber"
  | "transactionIndex";
export type RequiredInternalTraceColumns =
  | RequiredTraceColumns
  | "blockNumber"
  | "transactionIndex";
export type RequiredInternalLogColumns =
  | RequiredLogColumns
  | "blockNumber"
  | "transactionIndex";

export type InternalBlock = PartialExcept<Block, RequiredBlockColumns>;

// InternalTransaction is a flat type that can hold data from any transaction type.
// Since Transaction is a discriminated union, we define this explicitly to work with
// the internal sync pipeline where we don't always know the transaction type.
// Note: nonce is Hex (not bigint) to match the user-facing Transaction type.
export type InternalTransaction = {
  // Required fields (common to all transaction types)
  hash: Hex;
  transactionIndex: number;
  type: "INVOKE" | "L1_HANDLER" | "DECLARE" | "DEPLOY" | "DEPLOY_ACCOUNT";
  version: Hex;
  blockNumber: number;
  // Optional fields that vary by transaction type
  senderAddress?: Address | null;
  nonce?: Hex | null;
  calldata?: Hex[] | null;
  signature?: Hex[] | null;
  resourceBounds?: {
    l1Gas: { maxAmount: Hex; maxPricePerUnit: Hex };
    l2Gas: { maxAmount: Hex; maxPricePerUnit: Hex };
    l1DataGas?: { maxAmount: Hex; maxPricePerUnit: Hex };
  } | null;
  tip?: Hex | null;
  paymasterData?: Hex[] | null;
  accountDeploymentData?: Hex[] | null;
  feeDataAvailabilityMode?: "L1" | "L2" | null;
  nonceDataAvailabilityMode?: "L1" | "L2" | null;
  // L1_HANDLER specific
  contractAddress?: Address | null;
  entryPointSelector?: Hex | null;
  // DECLARE specific
  classHash?: Hex | null;
  compiledClassHash?: Hex | null;
  // DEPLOY, DEPLOY_ACCOUNT specific
  contractAddressSalt?: Hex | null;
  constructorCalldata?: Hex[] | null;
};
export type InternalTransactionReceipt = Omit<
  PartialExcept<TransactionReceipt, RequiredTransactionReceiptColumns>,
  "blockNumber" | "transactionIndex"
> & {
  blockNumber: number;
  transactionIndex: number;
};
export type InternalTrace = PartialExcept<Trace, RequiredTraceColumns> & {
  blockNumber: number;
  transactionIndex: number;
};
export type InternalLog = Omit<Log, "data"> & {
  blockNumber: number;
  transactionIndex: number;
  /** Transaction hash for matching log to transaction (Starknet uses hash-based matching) */
  transactionHash?: `0x${string}`;
  /** Internal data can be stringified JSON or array (gets parsed to Hex[] in user-facing Log) */
  data: Hex | Hex[];
};

export type UserBlock = PartialExcept<Block, RequiredBlockColumns>;

// UserTransaction is a flat type that can hold data from any transaction type.
// This is the type exposed to users in event handlers. It mirrors InternalTransaction
// but without the blockNumber field (which is available on the event context).
export type UserTransaction = {
  // Required fields (common to all transaction types)
  hash: Hash;
  transactionIndex: number;
  type: "INVOKE" | "L1_HANDLER" | "DECLARE" | "DEPLOY" | "DEPLOY_ACCOUNT";
  version: Hex;
  // Optional fields that vary by transaction type
  senderAddress: Address | null;
  nonce: Hex | null;
  calldata: Hex[] | null;
  signature: Hex[] | null;
  resourceBounds: {
    l1Gas: { maxAmount: Hex; maxPricePerUnit: Hex };
    l2Gas: { maxAmount: Hex; maxPricePerUnit: Hex };
    l1DataGas?: { maxAmount: Hex; maxPricePerUnit: Hex };
  } | null;
  tip: Hex | null;
  paymasterData: Hex[] | null;
  accountDeploymentData: Hex[] | null;
  feeDataAvailabilityMode: "L1" | "L2" | null;
  nonceDataAvailabilityMode: "L1" | "L2" | null;
  // L1_HANDLER specific
  contractAddress: Address | null;
  entryPointSelector: Hex | null;
  // DECLARE specific
  classHash: Hex | null;
  compiledClassHash: Hex | null;
  // DEPLOY, DEPLOY_ACCOUNT specific
  contractAddressSalt: Hex | null;
  constructorCalldata: Hex[] | null;
};
export type UserTransactionReceipt = PartialExcept<
  TransactionReceipt,
  RequiredTransactionReceiptColumns
>;
export type UserTrace = PartialExcept<Trace, RequiredTraceColumns>;
export type UserLog = Log;

// Events

export type RawEvent = {
  chainId: number;
  sourceIndex: number;
  checkpoint: string;
  log?: UserLog;
  block: UserBlock;
  transaction?: UserTransaction;
  transactionReceipt?: UserTransactionReceipt;
  trace?: UserTrace;
};

export type Event =
  | BlockEvent
  | TransactionEvent
  | TraceEvent
  | LogEvent
  | TransferEvent;

export type SetupEvent = {
  type: "setup";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:setup` */
  name: string;

  block: bigint;
};

export type BlockEvent = {
  type: "block";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:block` */
  name: string;

  event: {
    id: string;
    block: UserBlock;
  };
};

export type TransactionEvent = {
  type: "transaction";
  chainId: number;
  checkpoint: string;

  /** `${source.name}.{safeName}()` */
  name: string;

  event: {
    id: string;
    block: UserBlock;
    transaction: UserTransaction;
    transactionReceipt?: UserTransactionReceipt;
  };
};

export type TraceEvent = {
  type: "trace";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:transfer:from` | `${source.name}:transfer:to` */
  name: string;

  event: {
    id: string;
    args: { [key: string]: unknown } | readonly unknown[] | undefined;
    result: { [key: string]: unknown } | readonly unknown[] | undefined;
    block: UserBlock;
    transaction: UserTransaction;
    transactionReceipt?: UserTransactionReceipt;
    trace: UserTrace;
  };
};

export type LogEvent = {
  type: "log";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:${safeName}` */
  name: string;

  event: {
    id: string;
    args: { [key: string]: unknown } | readonly unknown[] | undefined;
    block: UserBlock;
    transaction: UserTransaction;
    transactionReceipt?: UserTransactionReceipt;
    log: UserLog;
  };
};

export type TransferEvent = {
  type: "transfer";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:transfer:from` | `${source.name}:transfer:to` */
  name: string;

  event: {
    id: string;
    transfer: Transfer;
    block: UserBlock;
    transaction: UserTransaction;
    transactionReceipt?: UserTransactionReceipt;
    trace: UserTrace;
  };
};
