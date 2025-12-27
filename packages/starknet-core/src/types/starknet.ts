import type { Address, Hash, Hex } from "viem";

// NOTE: All types/definitions taken from Alchemy docs: 
//       https://www.alchemy.com/docs/chains/starknet/starknet-api-endpoints

// ----------------
// Block
// ----------------

/**
 * A confirmed Starknet block.
 *
 * @link https://www.alchemy.com/docs/chains/starknet/starknet-api-endpoints/starknet-get-block-with-txs
 */
export type Block = {
  /** Block hash */
  hash: Hash;
  /** Block number */
  number: bigint;
  /** Parent block hash */
  parentHash: Hash;
  /** Unix timestamp of when this block was created */
  timestamp: bigint;
  /** The new global state root after this block */
  newRoot: Hex;
  /** The Starknet address of the sequencer who created this block */
  sequencerAddress: Address;
  /** The version of the Starknet protocol used when creating this block */
  starknetVersion: string;
  /** The status of the block */
  status: "ACCEPTED_ON_L1" | "ACCEPTED_ON_L2" | "PENDING";
  /** The mode of data availability for L1 */
  l1DaMode: "BLOB" | "CALLDATA";
  /** The price of L1 gas in the block */
  l1GasPrice: {
    /** Price in FRI (the smallest unit of STRK) */
    priceInFri: Hex;
    /** Price in Wei */
    priceInWei: Hex;
  };
  /** The price of L1 data gas in the block */
  l1DataGasPrice: {
    /** Price in FRI (the smallest unit of STRK) */
    priceInFri: Hex;
    /** Price in Wei */
    priceInWei: Hex;
  };
};

/**
 * Resource bounds for v3 transactions.
 */
export type ResourceBounds = {
  /** L1 gas resource bounds */
  l1Gas: {
    /** Maximum amount of resource */
    maxAmount: Hex;
    /** Maximum price per unit */
    maxPricePerUnit: Hex;
  };
  /** L2 gas resource bounds */
  l2Gas: {
    /** Maximum amount of resource */
    maxAmount: Hex;
    /** Maximum price per unit */
    maxPricePerUnit: Hex;
  };
  /** L1 data gas resource bounds (optional, for newer versions) */
  l1DataGas?: {
    /** Maximum amount of resource */
    maxAmount: Hex;
    /** Maximum price per unit */
    maxPricePerUnit: Hex;
  };
};

// ----------------
// Transaction
// ----------------

type TransactionBase = {
  /** Transaction hash */
  hash: Hash;
  /** Index of this transaction in the block (added by Ponder) */
  transactionIndex: number;
};

/**
 * `INVOKE` transaction type
 *
 * @link https://www.alchemy.com/docs/chains/starknet/starknet-api-endpoints/starknet-get-transaction-by-hash
 */
export type InvokeTransaction = TransactionBase & {
  /** Transaction type */
  type: "INVOKE";
  /** Transaction version */
  version: Hex;
  /** The address of the account that initiated the transaction */
  senderAddress: Address;
  /** The nonce of the transaction */
  nonce: Hex;
  /** The calldata for the transaction */
  calldata: Hex[];
  /** The signature of the transaction */
  signature: Hex[];
  /** Resource bounds for the transaction (v3 transactions) */
  resourceBounds: ResourceBounds | null;
  /** Tip for the sequencer (v3 transactions) */
  tip: Hex | null;
  /** Paymaster data (v3 transactions) */
  paymasterData: Hex[] | null;
  /** Account deployment data (v3 transactions) */
  accountDeploymentData: Hex[] | null;
  /** Fee data availability mode */
  feeDataAvailabilityMode: "L1" | "L2" | null;
  /** Nonce data availability mode */
  nonceDataAvailabilityMode: "L1" | "L2" | null;
};

/**
 * `L1_HANDLER` transaction type
 *
 * @link https://www.alchemy.com/docs/chains/starknet/starknet-api-endpoints/starknet-get-transaction-by-hash
 */
export type L1HandlerTransaction = TransactionBase & {
  /** Transaction type */
  type: "L1_HANDLER";
  /** Transaction version (always 0x0 for L1 handlers) */
  version: Hex;
  /** The nonce of the transaction */
  nonce: Hex;
  /** The address of the contract handling the message */
  contractAddress: Address;
  /** The selector of the l1_handler function */
  entryPointSelector: Hex;
  /** The calldata for the transaction */
  calldata: Hex[];
};

/**
 * `DECLARE` transaction type
 *
 * @link https://www.alchemy.com/docs/chains/starknet/starknet-api-endpoints/starknet-get-transaction-by-hash
 */
export type DeclareTransaction = TransactionBase & {
  /** Transaction type */
  type: "DECLARE";
  /** Transaction version */
  version: Hex;
  /** The address of the account that initiated the transaction */
  senderAddress: Address;
  /** The nonce of the transaction */
  nonce: Hex;
  /** The signature of the transaction */
  signature: Hex[];
  /** The hash of the declared class */
  classHash: Hex;
  /** The hash of the compiled class (for Cairo 1 contracts) */
  compiledClassHash: Hex | null;
  /** Resource bounds for the transaction (v3 transactions) */
  resourceBounds: ResourceBounds | null;
  /** Tip for the sequencer (v3 transactions) */
  tip: Hex | null;
  /** Paymaster data (v3 transactions) */
  paymasterData: Hex[] | null;
  /** Account deployment data (v3 transactions) */
  accountDeploymentData: Hex[] | null;
  /** Fee data availability mode */
  feeDataAvailabilityMode: "L1" | "L2" | null;
  /** Nonce data availability mode */
  nonceDataAvailabilityMode: "L1" | "L2" | null;
};

/**
 * `DEPLOY` tx type
 *
 * Note: This transaction type is deprecated and will no longer be supported in future versions.
 *
 * @link https://www.alchemy.com/docs/chains/starknet/starknet-api-endpoints/starknet-get-transaction-by-hash
 */
export type DeployTransaction = TransactionBase & {
  /** Transaction type */
  type: "DEPLOY";
  /** Transaction version */
  version: Hex;
  /** The hash of the class to deploy */
  classHash: Hex;
  /** The salt for the contract address computation */
  contractAddressSalt: Hex;
  /** Constructor calldata */
  constructorCalldata: Hex[];
};

/**
 * A deploy account transaction - deploys an account contract.
 *
 * @link https://www.alchemy.com/docs/chains/starknet/starknet-api-endpoints/starknet-get-transaction-by-hash
 */
export type DeployAccountTransaction = TransactionBase & {
  /** Transaction type */
  type: "DEPLOY_ACCOUNT";
  /** Transaction version */
  version: Hex;
  /** The nonce of the transaction */
  nonce: Hex;
  /** The signature of the transaction */
  signature: Hex[];
  /** The hash of the class to deploy */
  classHash: Hex;
  /** The salt for the contract address computation */
  contractAddressSalt: Hex;
  /** Constructor calldata */
  constructorCalldata: Hex[];
  /** Resource bounds for the transaction (v3 transactions) */
  resourceBounds: ResourceBounds | null;
  /** Tip for the sequencer (v3 transactions) */
  tip: Hex | null;
  /** Paymaster data (v3 transactions) */
  paymasterData: Hex[] | null;
  /** Account deployment data (v3 transactions) */
  accountDeploymentData: Hex[] | null;
  /** Fee data availability mode */
  feeDataAvailabilityMode: "L1" | "L2" | null;
  /** Nonce data availability mode */
  nonceDataAvailabilityMode: "L1" | "L2" | null;
};

/** Ponder Starknet transaction */
export type Transaction =
  | InvokeTransaction
  | L1HandlerTransaction
  | DeclareTransaction
  | DeployTransaction
  | DeployAccountTransaction;

export type TransactionKeys =
  | keyof InvokeTransaction
  | keyof L1HandlerTransaction
  | keyof DeclareTransaction
  | keyof DeployTransaction
  | keyof DeployAccountTransaction;

// ----------------
// Event Log
// ----------------

/**
 * A confirmed Starknet log (event).
 *
 * @link https://docs.starknet.io/documentation/architecture_and_concepts/Smart_Contracts/starknet-events/
 */
export type Log = {
  /** The address from which this log originated */
  address: Address;
  /** Contains the non-indexed arguments of the log (array of felts in Starknet) */
  data: Hex[];
  /** Index of this log within its block */
  logIndex: number;
  /** `true` if this log has been removed in a chain reorganization */
  removed: boolean;
  /** List of order-dependent keys (Starknet's event keys) */
  keys: [Hex, ...Hex[]] | [];
};

// ----------------
// Transaction Receipts
// ----------------

/**
 * Common fields for all Starknet transaction receipts.
 */
type TransactionReceiptBase = {
  /** The hash identifying the transaction */
  transactionHash: Hash;
  /** The fee that was charged by the sequencer */
  actualFee: {
    /** Amount paid */
    amount: Hex;
    /** Units in which the fee is given */
    unit: "WEI" | "FRI";
  };
  /** The execution status of the transaction */
  executionStatus: "SUCCEEDED" | "REVERTED";
  /** Finality status of the transaction */
  finalityStatus: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";
  /** The block hash (missing if receipt belongs to pending block) */
  blockHash: Hash;
  /** The block number (missing if receipt belongs to pending block) */
  blockNumber: bigint;
  /** Transaction index in the block */
  transactionIndex: number;
  /** Messages sent to L1 */
  messagesSent: Array<{
    /** The address of the L2 contract sending the message */
    fromAddress: Address;
    /** The target L1 address the message is sent to */
    toAddress: Hex;
    /** The payload of the message */
    payload: Hex[];
  }>;
  /** The events emitted as part of this transaction */
  events: Array<{
    /** A contract address */
    fromAddress: Address;
    /** Event keys */
    keys: Hex[];
    /** Event data */
    data: Hex[];
  }>;
  /**
   * The resources consumed by the transaction (Triple Gas Model).
   *
   * NOTE: Older RPC versions (≤0.7) had detailed execution_resources with steps,
   * memory_holes, and builtin counters. Modern RPC (v0.8+) returns only gas metrics?
   */
  executionResources: {
    /** The data gas consumed by this transaction's data, 0 if it uses gas for DA */
    l1DataGas: number;
    /** The gas consumed by this transaction's data, 0 if it uses data gas for DA */
    l1Gas: number;
    /** L2 gas consumed (computation, calldata, events) */
    l2Gas: number;
  };
  /** Revert reason if execution failed */
  revertReason?: string;
};

export type InvokeTransactionReceipt = TransactionReceiptBase & {
  type: "INVOKE";
};

export type DeclareTransactionReceipt = TransactionReceiptBase & {
  type: "DECLARE";
};

export type DeployTransactionReceipt = TransactionReceiptBase & {
  type: "DEPLOY";
  contractAddress: Address;
};

export type DeployAccountTransactionReceipt = TransactionReceiptBase & {
  type: "DEPLOY_ACCOUNT";
  contractAddress: Address;
};

/** Receipt for an L1_HANDLER transaction. */
export type L1HandlerTransactionReceipt = TransactionReceiptBase & {
  type: "L1_HANDLER";
  /** Hash of the L1 message that triggered this transaction */
  messageHash: Hex;
};

/**
 * A confirmed Starknet transaction receipt.
 *
 * @link https://docs.starknet.io/documentation/architecture_and_concepts/Transactions/
 */
export type TransactionReceipt = TransactionReceiptBase & {
  /** Transaction type */
  type: "INVOKE" | "DECLARE" | "DEPLOY" | "DEPLOY_ACCOUNT" | "L1_HANDLER";
  /** Contract address - only on DEPLOY and DEPLOY_ACCOUNT receipts */
  contractAddress?: Address;
  /** Message hash - only on L1_HANDLER receipts */
  messageHash?: Hex;
};

// ----------------
// Trace
// ----------------

// TODO: Implement trace, atm kept just for evm compatability

/**
 * A Starknet trace (function invocation).
 */
export type Trace = {
  /** The type of the call */
  type: "CALL" | "LIBRARY_CALL" | "DELEGATE" | "CONSTRUCTOR";
  /** The address that initiated the call */
  from: Address;
  /** The address of the contract that was called */
  to: Address | null;
  /** Calldata input */
  input: Hex;
  /** Output of the call, if any */
  output?: Hex;
  /** Error message, if any */
  error?: string;
  /** Why this call reverted, if it reverted */
  revertReason?: string;
  /** Index of this trace in the transaction */
  traceIndex: number;
  /** Number of subcalls */
  subcalls: number;
  // EVM compatibility fields (Starknet doesn't have these natively)
  gas: bigint;
  gasUsed: bigint;
  value: bigint | null;
};

// ----------------
// ETH Transfer
// ----------------

// TODO: Remove this, useless because starknet has no native ETH

export type Transfer = {
  /** The address that sent the transfer */
  from: Address;
  /** The address that received the transfer */
  to: Address;
  /** The amount of tokens transferred */
  value: bigint;
};
