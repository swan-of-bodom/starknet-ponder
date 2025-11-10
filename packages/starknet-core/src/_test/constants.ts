import type {
  BlockFilter,
  LogFilter,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";

// Starknet devnet accounts with "--seed 0"
export const ACCOUNTS = [
  "0x064b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691",
  "0x078662e7352d062084b0010068b99288486c2d8b914f6e2a55ce945f8792c87",
] as const;

export const [ALICE, BOB] = ACCOUNTS;

export const EMPTY_LOG_FILTER: LogFilter = {
  type: "log",
  chainId: 1,
  address: undefined,
  topic0: null,
  topic1: null,
  topic2: null,
  topic3: null,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [],
};

export const EMPTY_BLOCK_FILTER: BlockFilter = {
  type: "block",
  chainId: 1,
  interval: 1,
  offset: 0,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [],
};

export const EMPTY_TRANSACTION_FILTER: TransactionFilter = {
  type: "transaction",
  chainId: 1,
  fromAddress: undefined,
  toAddress: undefined,
  includeReverted: false,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: true,
  include: [],
};

export const EMPTY_TRACE_FILTER: TraceFilter = {
  type: "trace",
  chainId: 1,
  callType: "CALL",
  functionSelector: undefined,
  fromAddress: undefined,
  toAddress: undefined,
  includeReverted: false,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [],
};

export const EMPTY_TRANSFER_FILTER: TransferFilter = {
  type: "transfer",
  chainId: 1,
  fromAddress: undefined,
  toAddress: undefined,
  includeReverted: false,
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [],
};
