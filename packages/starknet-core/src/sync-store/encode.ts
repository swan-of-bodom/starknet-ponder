import type {
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import { toHex64, hexToBigInt } from "@/utils/hex.js";
import type { Hex } from "@/utils/hex.js";
import type * as ponderSyncSchema from "./schema.js";

export const encodeBlock = ({
  block,
  chainId,
}: {
  block: SyncBlock | SyncBlockHeader;
  chainId: number;
}): typeof ponderSyncSchema.blocks.$inferInsert => ({
  chainId: BigInt(chainId),
  number: BigInt(block.number),
  timestamp: BigInt(block.timestamp),
  hash: toHex64(block.hash),
  parentHash: toHex64(block.parentHash),
  // Starknet-native fields
  newRoot: toHex64(block.newRoot),
  sequencerAddress: toHex64(block.sequencerAddress),
  starknetVersion: block.starknetVersion,
  status: block.status,
  l1DaMode: block.l1DaMode,
  l1GasPrice: JSON.stringify(block.l1GasPrice),
  l1DataGasPrice: JSON.stringify(block.l1DataGasPrice),
});

export const encodeLog = ({
  log,
  chainId,
}: {
  log: SyncLog;
  chainId: number;
}): typeof ponderSyncSchema.logs.$inferInsert => {
  // For Starknet: always store ALL keys in allKeys (supports unlimited indexed params)
  const allKeysValue = JSON.stringify(log.keys);

  return {
    chainId: BigInt(chainId),
    blockNumber: BigInt(log.blockNumber),
    logIndex: log.logIndex,
    transactionIndex: log.transactionIndex,
    blockHash: toHex64(log.blockHash),
    transactionHash: toHex64(log.transactionHash),
    address: toHex64(log.address),
    topic0: log.keys[0] ? log.keys[0] : null,
    topic1: log.keys[1] ? log.keys[1] : null,
    topic2: log.keys[2] ? log.keys[2] : null,
    topic3: log.keys[3] ? log.keys[3] : null,
    // For Starknet: always store all keys (supports unlimited indexed params + ByteArray expansion)
    // For EVM: use as fallback if > 4 keys
    allKeys: allKeysValue,
    // For Starknet: if data is an array, serialize it as JSON
    // For Ethereum: data is already a hex string
    data: (Array.isArray(log.data) ? JSON.stringify(log.data) : log.data) as Hex,
  };
};

// Helper to get senderAddress from transaction (only INVOKE, DECLARE, not L1_HANDLER/DEPLOY/DEPLOY_ACCOUNT)
const getSenderAddress = (tx: SyncTransaction): Hex | null => {
  if (tx.type === "INVOKE" || tx.type === "DECLARE") {
    return tx.senderAddress;
  }
  return null;
};

// Helper to get nonce from transaction (not present on DEPLOY)
const getNonce = (tx: SyncTransaction): Hex | null => {
  if (tx.type === "DEPLOY") {
    return null;
  }
  return tx.nonce;
};

// Helper to get calldata from transaction (INVOKE, L1_HANDLER have calldata; DECLARE doesn't)
const getCalldata = (tx: SyncTransaction): Hex[] | null => {
  if (tx.type === "INVOKE" || tx.type === "L1_HANDLER") {
    return tx.calldata;
  }
  if (tx.type === "DEPLOY" || tx.type === "DEPLOY_ACCOUNT") {
    return tx.constructorCalldata;
  }
  return null;
};

// Helper to get signature from transaction (not present on L1_HANDLER, DEPLOY)
const getSignature = (tx: SyncTransaction): Hex[] | null => {
  if (tx.type === "L1_HANDLER" || tx.type === "DEPLOY") {
    return null;
  }
  return tx.signature;
};

// Helper to get resourceBounds from transaction (not on L1_HANDLER, DEPLOY)
const getResourceBounds = (tx: SyncTransaction) => {
  if (tx.type === "L1_HANDLER" || tx.type === "DEPLOY") {
    return null;
  }
  return tx.resourceBounds ?? null;
};

// Helper to get tip from transaction (not on L1_HANDLER, DEPLOY)
const getTip = (tx: SyncTransaction): Hex | null => {
  if (tx.type === "L1_HANDLER" || tx.type === "DEPLOY") {
    return null;
  }
  return tx.tip ?? null;
};

// Helper to get paymasterData from transaction (not on L1_HANDLER, DEPLOY)
const getPaymasterData = (tx: SyncTransaction): Hex[] | null => {
  if (tx.type === "L1_HANDLER" || tx.type === "DEPLOY") {
    return null;
  }
  return tx.paymasterData ?? null;
};

// Helper to get accountDeploymentData from transaction (not on L1_HANDLER, DEPLOY)
const getAccountDeploymentData = (tx: SyncTransaction): Hex[] | null => {
  if (tx.type === "L1_HANDLER" || tx.type === "DEPLOY") {
    return null;
  }
  return tx.accountDeploymentData ?? null;
};

// Helper to get feeDataAvailabilityMode from transaction (not on L1_HANDLER, DEPLOY)
const getFeeDataAvailabilityMode = (tx: SyncTransaction): "L1" | "L2" | null => {
  if (tx.type === "L1_HANDLER" || tx.type === "DEPLOY") {
    return null;
  }
  return tx.feeDataAvailabilityMode ?? null;
};

// Helper to get nonceDataAvailabilityMode from transaction (not on L1_HANDLER, DEPLOY)
const getNonceDataAvailabilityMode = (tx: SyncTransaction): "L1" | "L2" | null => {
  if (tx.type === "L1_HANDLER" || tx.type === "DEPLOY") {
    return null;
  }
  return tx.nonceDataAvailabilityMode ?? null;
};

// Helper to get contractAddress from transaction (only L1_HANDLER)
const getContractAddress = (tx: SyncTransaction): Hex | null => {
  if (tx.type === "L1_HANDLER") {
    return tx.contractAddress;
  }
  return null;
};

// Helper to get entryPointSelector from transaction (only L1_HANDLER)
const getEntryPointSelector = (tx: SyncTransaction): Hex | null => {
  if (tx.type === "L1_HANDLER") {
    return tx.entryPointSelector;
  }
  return null;
};

// Helper to get classHash from transaction (DECLARE, DEPLOY, DEPLOY_ACCOUNT)
const getClassHash = (tx: SyncTransaction): Hex | null => {
  if (tx.type === "DECLARE" || tx.type === "DEPLOY" || tx.type === "DEPLOY_ACCOUNT") {
    return tx.classHash;
  }
  return null;
};

// Helper to get compiledClassHash from transaction (only DECLARE)
const getCompiledClassHash = (tx: SyncTransaction): Hex | null => {
  if (tx.type === "DECLARE") {
    return tx.compiledClassHash ?? null;
  }
  return null;
};

// Helper to get contractAddressSalt from transaction (DEPLOY, DEPLOY_ACCOUNT)
const getContractAddressSalt = (tx: SyncTransaction): Hex | null => {
  if (tx.type === "DEPLOY" || tx.type === "DEPLOY_ACCOUNT") {
    return tx.contractAddressSalt;
  }
  return null;
};

// Helper to get constructorCalldata from transaction (DEPLOY, DEPLOY_ACCOUNT)
const getConstructorCalldata = (tx: SyncTransaction): Hex[] | null => {
  if (tx.type === "DEPLOY" || tx.type === "DEPLOY_ACCOUNT") {
    return tx.constructorCalldata;
  }
  return null;
};

export const encodeTransaction = ({
  transaction,
  chainId,
  blockNumber = 0,
}: {
  transaction: SyncTransaction;
  chainId: number;
  blockNumber?: number;
}): typeof ponderSyncSchema.transactions.$inferInsert => {
  const senderAddress = getSenderAddress(transaction);
  const nonce = getNonce(transaction);
  const calldata = getCalldata(transaction);
  const signature = getSignature(transaction);
  const resourceBounds = getResourceBounds(transaction);
  const tip = getTip(transaction);
  const paymasterData = getPaymasterData(transaction);
  const accountDeploymentData = getAccountDeploymentData(transaction);
  const feeDataAvailabilityMode = getFeeDataAvailabilityMode(transaction);
  const nonceDataAvailabilityMode = getNonceDataAvailabilityMode(transaction);
  // Type-specific fields
  const contractAddress = getContractAddress(transaction);
  const entryPointSelector = getEntryPointSelector(transaction);
  const classHash = getClassHash(transaction);
  const compiledClassHash = getCompiledClassHash(transaction);
  const contractAddressSalt = getContractAddressSalt(transaction);
  const constructorCalldata = getConstructorCalldata(transaction);

  return {
    chainId: BigInt(chainId),
    blockNumber: BigInt(blockNumber),
    transactionIndex: transaction.transactionIndex,
    hash: toHex64(transaction.hash),
    // Starknet-native fields
    type: transaction.type,
    version: transaction.version,
    senderAddress: senderAddress ? toHex64(senderAddress) : null,
    nonce: nonce ?? null,
    calldata: calldata ? JSON.stringify(calldata) : null,
    signature: signature ? JSON.stringify(signature) : null,
    resourceBounds: resourceBounds ? JSON.stringify(resourceBounds) : null,
    tip: tip ?? null,
    paymasterData: paymasterData ? JSON.stringify(paymasterData) : null,
    accountDeploymentData: accountDeploymentData ? JSON.stringify(accountDeploymentData) : null,
    feeDataAvailabilityMode: feeDataAvailabilityMode ?? null,
    nonceDataAvailabilityMode: nonceDataAvailabilityMode ?? null,
    // L1_HANDLER specific fields
    contractAddress: contractAddress ? toHex64(contractAddress) : null,
    entryPointSelector: entryPointSelector ? toHex64(entryPointSelector) : null,
    // DECLARE specific fields
    classHash: classHash ? toHex64(classHash) : null,
    compiledClassHash: compiledClassHash ? toHex64(compiledClassHash) : null,
    // DEPLOY, DEPLOY_ACCOUNT specific fields
    contractAddressSalt: contractAddressSalt ? toHex64(contractAddressSalt) : null,
    constructorCalldata: constructorCalldata ? JSON.stringify(constructorCalldata) : null,
  };
};

export const encodeTransactionReceipt = ({
  transactionReceipt,
  chainId,
}: {
  transactionReceipt: SyncTransactionReceipt;
  chainId: number;
}): typeof ponderSyncSchema.transactionReceipts.$inferInsert => {
  return {
    chainId: BigInt(chainId),
    blockNumber: BigInt(transactionReceipt.blockNumber),
    transactionIndex: transactionReceipt.transactionIndex,
    transactionHash: toHex64(transactionReceipt.transactionHash),
    blockHash: toHex64(transactionReceipt.blockHash),
    // Starknet-native fields (already in camelCase from standardization)
    actualFee: JSON.stringify(transactionReceipt.actualFee),
    executionResources: JSON.stringify(transactionReceipt.executionResources),
    executionStatus: transactionReceipt.executionStatus,
    finalityStatus: transactionReceipt.finalityStatus,
    messagesSent: JSON.stringify(transactionReceipt.messagesSent),
    events: JSON.stringify(transactionReceipt.events),
    revertReason: transactionReceipt.revertReason || null,
    contractAddress: transactionReceipt.contractAddress
      ? toHex64(transactionReceipt.contractAddress)
      : null,
    // L1_HANDLER specific - hash of the L1 message
    messageHash: transactionReceipt.messageHash
      ? toHex64(transactionReceipt.messageHash)
      : null,
  };
};

export const encodeTrace = ({
  trace,
  block,
  transaction,
  chainId,
}: {
  trace: SyncTrace;
  block: Pick<SyncBlock, "number">;
  transaction: Pick<SyncTransaction, "transactionIndex">;
  chainId: number;
}): typeof ponderSyncSchema.traces.$inferInsert => ({
  chainId: BigInt(chainId),
  // block.number is now a plain number
  blockNumber: BigInt(block.number),
  // transaction.transactionIndex is now a plain number
  transactionIndex: transaction.transactionIndex,
  traceIndex: trace.trace.index,
  from: toHex64(trace.trace.from),
  to: trace.trace.to ? toHex64(trace.trace.to) : null,
  input: trace.trace.input,
  output: trace.trace.output ?? null,
  value: trace.trace.value ? hexToBigInt(trace.trace.value).toString() : null,
  type: trace.trace.type,
  gas: hexToBigInt(trace.trace.gas).toString(),
  gasUsed: hexToBigInt(trace.trace.gasUsed).toString(),
  error: trace.trace.error ? trace.trace.error.replace(/\0/g, "") : null,
  revertReason: trace.trace.revertReason
    ? trace.trace.revertReason.replace(/\0/g, "")
    : null,
  subcalls: trace.trace.subcalls,
});
