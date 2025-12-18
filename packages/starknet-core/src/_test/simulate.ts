/**
 * Starknet simulation helpers for tests
 *
 * These functions interact with starknet-devnet to create real blockchain data.
 * They execute actual transactions on devnet that emit real events.
 */

import type {
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { computeEventSelector } from "@/utils/event-selector.js";
import { toHex64 } from "@/utils/hex.js";
import type { Address, Hex } from "viem";
import { Account, RpcProvider, hash, CallData, uint256, ETransactionVersion, Signer } from "starknet";
import { DevnetProvider } from "starknet-devnet";

// Get devnet URL and provider
const getDevnetUrl = () =>
  process.env.STARKNET_DEVNET_URL || "http://127.0.0.1:5050";

// Lazy-loaded providers to avoid issues when devnet isn't running
let _starknetProvider: RpcProvider | null = null;
let _devnetProvider: DevnetProvider | null = null;
let _predeployedAccounts: Array<{
  address: string;
  private_key: string;
  public_key: string;
  initial_balance: string;
}> | null = null;

const getStarknetProvider = (): RpcProvider => {
  if (!_starknetProvider) {
    _starknetProvider = new RpcProvider({
      nodeUrl: getDevnetUrl(),
      // Use 'latest' instead of 'pending' for devnet compatibility
      blockIdentifier: "latest",
    });
  }
  return _starknetProvider;
};

const getDevnetProvider = (): DevnetProvider => {
  if (!_devnetProvider) {
    _devnetProvider = new DevnetProvider({ url: getDevnetUrl() });
  }
  return _devnetProvider;
};

// Get predeployed accounts (cached)
const getPredeployedAccounts = async () => {
  if (!_predeployedAccounts || _predeployedAccounts.length === 0) {
    const devnet = getDevnetProvider();
    const accounts = await devnet.getPredeployedAccounts();
    if (!accounts || accounts.length === 0) {
      throw new Error(`No predeployed accounts found. Is starknet-devnet running at ${getDevnetUrl()}?`);
    }
    _predeployedAccounts = accounts;
  }
  return _predeployedAccounts;
};

// Create starknet.js Account instance from sender address
const getAccountFromAddress = async (senderAddress: Address): Promise<Account> => {
  const accounts = await getPredeployedAccounts();
  const normalizedSender = senderAddress.toLowerCase();

  // Find matching account
  const accountInfo = accounts.find(
    (acc) => acc.address.toLowerCase() === normalizedSender
  );

  if (!accountInfo) {
    // Use first account as default
    const defaultAccount = accounts[0]!;
    // v9 API uses options object with explicit Signer
    // Use V3 transactions with skipValidate to avoid fee estimation issues
    return new Account({
      provider: getStarknetProvider(),
      address: defaultAccount.address,
      signer: new Signer(defaultAccount.private_key),
      transactionVersion: ETransactionVersion.V3,
    });
  }

  // v9 API uses options object with explicit Signer
  // Use V3 transactions with skipValidate to avoid fee estimation issues
  return new Account({
    provider: getStarknetProvider(),
    address: accountInfo.address,
    signer: new Signer(accountInfo.private_key),
    transactionVersion: ETransactionVersion.V3,
  });
};

// Starknet fee token addresses (same on mainnet, testnet, and devnet)
const ETH_TOKEN_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7" as Address;
const STRK_TOKEN_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d" as Address;

// Zero address in Starknet format
const ZERO_ADDRESS = toHex64(0n) as Address;

// Convert RPC block to SyncBlock format
// Important: Use toHex64 to normalize hashes for consistent comparison with RPC actions
const convertToSyncBlock = (rpcBlock: any): SyncBlock => {
  const transactions = (rpcBlock.transactions || []).map((tx: any, index: number) => {
    if (typeof tx === 'string') {
      return {
        hash: toHex64(tx) as Hex,
        transactionIndex: index,
        type: "INVOKE",
        version: "0x3" as Hex,
        senderAddress: ZERO_ADDRESS as Hex,
        nonce: "0x0" as Hex,
        calldata: [],
        signature: [],
      };
    }
    return {
      hash: toHex64(tx.transaction_hash) as Hex,
      transactionIndex: index,
      type: tx.type || "INVOKE",
      version: tx.version as Hex,
      senderAddress: toHex64(tx.sender_address || tx.contract_address || ZERO_ADDRESS) as Hex,
      nonce: tx.nonce as Hex,
      calldata: tx.calldata || [],
      signature: tx.signature || [],
      resourceBounds: tx.resource_bounds,
    };
  });

  return {
    number: Number(rpcBlock.block_number),
    hash: toHex64(rpcBlock.block_hash) as Hex,
    parentHash: toHex64(rpcBlock.parent_hash) as Hex,
    timestamp: Number(rpcBlock.timestamp),
    transactions,
    newRoot: toHex64(rpcBlock.new_root) as Hex,
    sequencerAddress: toHex64(rpcBlock.sequencer_address || ZERO_ADDRESS) as Address,
    starknetVersion: rpcBlock.starknet_version || "0.13.0",
    status: rpcBlock.status || "ACCEPTED_ON_L2",
    l1DaMode: rpcBlock.l1_da_mode || "BLOB",
    l1GasPrice: {
      priceInWei: rpcBlock.l1_gas_price?.price_in_wei || "0x1",
      priceInFri: rpcBlock.l1_gas_price?.price_in_fri || "0x1",
    },
    l1DataGasPrice: {
      priceInWei: rpcBlock.l1_data_gas_price?.price_in_wei || "0x1",
      priceInFri: rpcBlock.l1_data_gas_price?.price_in_fri || "0x1",
    },
  } as SyncBlock;
};

// Convert RPC transaction to SyncTransaction format
export const convertToSyncTransaction = (rpcTx: any, index: number): SyncTransaction => {
  return {
    hash: rpcTx.transaction_hash as Hex,
    transactionIndex: index,
    type: rpcTx.type || "INVOKE",
    version: rpcTx.version as Hex,
    senderAddress: (rpcTx.sender_address || rpcTx.contract_address) as Hex,
    nonce: rpcTx.nonce as Hex,
    calldata: rpcTx.calldata || [],
    signature: rpcTx.signature || [],
    resourceBounds: rpcTx.resource_bounds,
  } as SyncTransaction;
};

// Convert RPC receipt to SyncTransactionReceipt format
export const convertToSyncReceipt = (rpcReceipt: any): SyncTransactionReceipt => {
  // Transform events from snake_case to camelCase
  const events = (rpcReceipt.events || []).map((event: any) => ({
    fromAddress: toHex64(event.from_address) as Hex,
    keys: event.keys?.map((k: string) => toHex64(k) as Hex) || [],
    data: event.data?.map((d: string) => toHex64(d) as Hex) || [],
  }));

  // Transform messages_sent from snake_case to camelCase
  const messagesSent = (rpcReceipt.messages_sent || []).map((msg: any) => ({
    fromAddress: toHex64(msg.from_address) as Hex,
    toAddress: msg.to_address as Hex,
    payload: msg.payload || [],
  }));

  // Transform execution_resources
  const executionResources = rpcReceipt.execution_resources
    ? {
        l1DataGas: rpcReceipt.execution_resources.data_gas?.l1_data_gas ?? rpcReceipt.execution_resources.l1_data_gas ?? 0,
        l1Gas: rpcReceipt.execution_resources.data_gas?.l1_gas ?? rpcReceipt.execution_resources.l1_gas ?? 0,
        l2Gas: rpcReceipt.execution_resources.l2_gas ?? 0,
      }
    : { l1DataGas: 0, l1Gas: 0, l2Gas: 0 };

  return {
    transactionHash: toHex64(rpcReceipt.transaction_hash) as Hex,
    blockHash: toHex64(rpcReceipt.block_hash) as Hex,
    blockNumber: rpcReceipt.block_number,
    transactionIndex: rpcReceipt.transaction_index ?? 0,
    actualFee: rpcReceipt.actual_fee || { amount: "0x1", unit: "WEI" },
    events,
    executionStatus: rpcReceipt.execution_status || "SUCCEEDED",
    finalityStatus: rpcReceipt.finality_status || "ACCEPTED_ON_L2",
    type: rpcReceipt.type || "INVOKE",
    contractAddress: rpcReceipt.contract_address ? toHex64(rpcReceipt.contract_address) as Hex : null,
    messagesSent,
    revertReason: rpcReceipt.revert_reason,
    executionResources,
  } as SyncTransactionReceipt;
};

// Convert RPC event to SyncLog format
export const convertToSyncLog = (event: any, blockNumber: number, blockHash: Hex, txHash: Hex, txIndex: number, logIndex: number): SyncLog => {
  return {
    address: event.from_address as Address,
    keys: event.keys as Hex[],
    data: event.data as Hex[],
    blockHash: blockHash,
    blockNumber: blockNumber,
    transactionHash: txHash,
    transactionIndex: txIndex,
    logIndex: logIndex,
    removed: false,
  } as SyncLog;
};

/**
 * Deploy ERC20 contract - uses the predeployed ETH token
 * Returns the ETH token address as a simulated "deployed" ERC20
 */
export const deployErc20 = async (_params: {
  sender: Address;
}): Promise<{ address: Address }> => {
  return { address: toLowerCase(ETH_TOKEN_ADDRESS) };
};

/**
 * Deploy Factory contract - creates a mock address for factory tests
 * Note: For real factory tests, you'd need to declare/deploy a Cairo factory contract
 */
export const deployFactory = async (params: {
  sender: Address;
}): Promise<{ address: Address }> => {
  // For now, return a deterministic mock address
  const mockAddress = toHex64(BigInt(hash.starknetKeccak(`factory_${params.sender}`))) as Address;
  return { address: toLowerCase(mockAddress) };
};

/**
 * Deploy Revert contract - mock for testing
 */
export const deployRevert = async (params: {
  sender: Address;
}): Promise<{ address: Address }> => {
  const mockAddress = toHex64(BigInt(hash.starknetKeccak(`revert_${params.sender}`))) as Address;
  return { address: toLowerCase(mockAddress) };
};

/**
 * Deploy Multicall contract - mock for testing
 */
export const deployMulticall = async (params: {
  sender: Address;
}): Promise<{ address: Address }> => {
  const mockAddress = toHex64(BigInt(hash.starknetKeccak(`multicall_${params.sender}`))) as Address;
  return { address: toLowerCase(mockAddress) };
};

/**
 * Create pair from factory - mock for testing
 */
export const createPair = async (params: {
  factory: Address;
  sender: Address;
}): Promise<{
  address: Address;
  block: SyncBlock;
  transaction: SyncTransaction;
  transactionReceipt: SyncTransactionReceipt;
  log: SyncLog;
}> => {
  // For factory tests, we'd need an actual factory contract
  // For now, simulate a block and return mock pair data
  const { block } = await simulateBlock();

  const pairAddress = toHex64(BigInt(hash.starknetKeccak(`pair_${params.factory}_${Date.now()}`))) as Address;
  const txHash = toHex64(BigInt(hash.starknetKeccak(`tx_${Date.now()}`))) as Hex;

  const transaction: SyncTransaction = {
    hash: txHash,
    transactionIndex: 0,
    type: "INVOKE",
    version: "0x1" as Hex,
    senderAddress: toHex64(params.sender) as Hex,
    nonce: "0x0" as Hex,
    calldata: [],
    signature: [],
  };

  const pairCreatedSelector = computeEventSelector("PairCreated");
  const blockNum = block.number;
  const log: SyncLog = {
    address: params.factory,
    keys: [pairCreatedSelector, pairAddress as Hex],
    data: [] as Hex[],
    blockHash: block.hash,
    blockNumber: blockNum,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as SyncLog;

  const transactionReceipt: SyncTransactionReceipt = {
    transactionHash: txHash,
    blockHash: block.hash,
    blockNumber: blockNum,
    transactionIndex: 0,
    actualFee: { amount: "0x1", unit: "WEI" },
    events: [{ from_address: params.factory, keys: log.keys, data: [] }],
    executionStatus: "SUCCEEDED",
    finalityStatus: "ACCEPTED_ON_L2",
    type: "INVOKE",
    contractAddress: null,
    messagesSent: [],
    revertReason: undefined,
    executionResources: { l1DataGas: 0, l1Gas: 0, l2Gas: 0 },
  } as SyncTransactionReceipt;

  return {
    address: toLowerCase(pairAddress),
    block,
    transaction,
    transactionReceipt,
    log,
  };
};

/**
 * Mint ERC20 tokens - executes a real transfer on devnet (mint is simulated as transfer from account)
 * Since devnet predeployed tokens don't have mint, we use transfer which emits Transfer event
 */
export const mintErc20 = async (params: {
  erc20: Address;
  to: Address;
  amount: bigint;
  sender: Address;
}): Promise<{
  block: SyncBlock;
  log: SyncLog;
  transaction: SyncTransaction;
  transactionReceipt: SyncTransactionReceipt;
}> => {
  const provider = getStarknetProvider();
  const account = await getAccountFromAddress(params.sender);

  // Execute transfer (this emits Transfer event)
  const u256Amount = uint256.bnToUint256(params.amount);

  // Use fixed resource bounds for devnet (avoids slow fee estimation)
  // These values must be high enough to cover validation + execution on devnet
  // Must use BigInt for starknet.js v9
  // L2 gas needs at least ~1,116,800 for ERC20 transfer
  const devnetResourceBounds = {
    l1_gas: { max_amount: 0x200000n, max_price_per_unit: 0x100000000000n },
    l2_gas: { max_amount: 0x200000n, max_price_per_unit: 0x100000000000n },
    l1_data_gas: { max_amount: 0x200000n, max_price_per_unit: 0x100000000000n },
  };

  // Execute with hardcoded resource bounds
  const result = await account.execute(
    {
      contractAddress: params.erc20,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: params.to,
        amount: u256Amount,
      }),
    },
    {
      resourceBounds: devnetResourceBounds,
    }
  );

  // Create a block to include the transaction (devnet doesn't auto-mine)
  const devnet = getDevnetProvider();
  await devnet.createBlock();

  // Check status - if SUCCEEDED, no need to wait further
  const status = await provider.getTransactionStatus(result.transaction_hash);
  if (status.execution_status !== "SUCCEEDED") {
    throw new Error(`Transaction failed: ${status.failure_reason}`);
  }

  // Get the receipt
  const receipt = await provider.getTransactionReceipt(result.transaction_hash);

  // Get the block
  const block = await provider.getBlockWithTxs(receipt.block_number);
  const syncBlock = convertToSyncBlock(block);

  // Find the transaction in the block
  const txIndex = block.transactions.findIndex(
    (tx: any) => tx.transaction_hash === result.transaction_hash
  );
  const rpcTx = block.transactions[txIndex];
  const transaction = convertToSyncTransaction(rpcTx, txIndex);

  // Find the Transfer event
  const transferEvent = (receipt as any).events?.find(
    (e: any) => e.from_address.toLowerCase() === params.erc20.toLowerCase()
  );

  const log: SyncLog = transferEvent ? convertToSyncLog(
    transferEvent,
    syncBlock.number,
    syncBlock.hash,
    result.transaction_hash as Hex,
    txIndex,
    0
  ) : {
    address: params.erc20,
    keys: [computeEventSelector("Transfer")],
    data: [],
    blockHash: syncBlock.hash,
    blockNumber: syncBlock.number,
    transactionHash: result.transaction_hash as Hex,
    transactionIndex: txIndex,
    logIndex: 0,
    removed: false,
  } as SyncLog;

  const transactionReceipt = convertToSyncReceipt(receipt);

  return { block: syncBlock, transaction, transactionReceipt, log };
};

/**
 * Transfer ERC20 tokens - executes a real transfer on devnet
 */
export const transferErc20 = async (params: {
  erc20: Address;
  to: Address;
  amount: bigint;
  sender: Address;
}): Promise<{
  block: SyncBlock;
  transaction: SyncTransaction;
  transactionReceipt: SyncTransactionReceipt;
  trace: SyncTrace;
  log: SyncLog;
}> => {
  const result = await mintErc20(params);

  const trace: SyncTrace = {
    trace: {
      type: "CALL",
      from: params.sender,
      to: params.erc20,
      gas: "0x0" as Hex,
      gasUsed: "0x0" as Hex,
      input: "0x" as Hex,
      output: "0x01" as Hex,
      value: "0x0" as Hex,
      index: 0,
      subcalls: 0,
    },
    transactionHash: result.transaction.hash,
  };

  return { ...result, trace };
};

/**
 * Swap tokens in pair - mock for testing
 */
export const swapPair = async (params: {
  pair: Address;
  amount0Out: bigint;
  amount1Out: bigint;
  to: Address;
  sender: Address;
}): Promise<{
  block: SyncBlock;
  transaction: SyncTransaction;
  transactionReceipt: SyncTransactionReceipt;
  trace: SyncTrace;
  log: SyncLog;
}> => {
  const { block } = await simulateBlock();
  const txHash = toHex64(BigInt(hash.starknetKeccak(`swap_${Date.now()}`))) as Hex;

  const transaction: SyncTransaction = {
    hash: txHash,
    transactionIndex: 0,
    type: "INVOKE",
    version: "0x1" as Hex,
    senderAddress: toHex64(params.sender) as Hex,
    nonce: "0x0" as Hex,
    calldata: [],
    signature: [],
  };

  const swapSelector = computeEventSelector("Swap");
  const blockNum = block.number;
  const log: SyncLog = {
    address: params.pair,
    keys: [swapSelector, params.sender as Hex, params.to as Hex],
    data: [toHex64(params.amount0Out) as Hex, toHex64(params.amount1Out) as Hex],
    blockHash: block.hash,
    blockNumber: blockNum,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as SyncLog;

  const transactionReceipt: SyncTransactionReceipt = {
    transactionHash: txHash,
    blockHash: block.hash,
    blockNumber: blockNum,
    transactionIndex: 0,
    actualFee: { amount: "0x1", unit: "WEI" },
    events: [{ from_address: params.pair, keys: log.keys, data: [] }],
    executionStatus: "SUCCEEDED",
    finalityStatus: "ACCEPTED_ON_L2",
    type: "INVOKE",
    contractAddress: null,
    messagesSent: [],
    revertReason: undefined,
    executionResources: { l1DataGas: 0, l1Gas: 0, l2Gas: 0 },
  } as SyncTransactionReceipt;

  const trace: SyncTrace = {
    trace: {
      type: "CALL",
      from: params.sender,
      to: params.pair,
      gas: "0x0" as Hex,
      gasUsed: "0x0" as Hex,
      input: "0x" as Hex,
      output: undefined,
      value: "0x0" as Hex,
      index: 0,
      subcalls: 0,
    },
    transactionHash: txHash,
  };

  return { block, transaction, transactionReceipt, trace, log };
};

/**
 * Transfer native tokens (ETH) - executes a real transfer on devnet
 */
export const transferEth = async (params: {
  to: Address;
  amount: bigint;
  sender: Address;
}): Promise<{
  block: SyncBlock;
  transaction: SyncTransaction;
  transactionReceipt: SyncTransactionReceipt;
  trace: SyncTrace;
}> => {
  const result = await transferErc20({
    erc20: ETH_TOKEN_ADDRESS,
    to: params.to,
    amount: params.amount,
    sender: params.sender,
  });

  return {
    block: result.block,
    transaction: result.transaction,
    transactionReceipt: result.transactionReceipt,
    trace: result.trace,
  };
};

/**
 * Simulate a new block - creates a block on devnet
 */
export const simulateBlock = async (): Promise<{ block: SyncBlock }> => {
  const devnet = getDevnetProvider();
  const provider = getStarknetProvider();

  // Create a new block on devnet
  await devnet.createBlock();

  // Get the latest block
  const latestBlock = await provider.getBlockLatestAccepted();
  const block = await provider.getBlockWithTxs(latestBlock.block_number);

  return { block: convertToSyncBlock(block) };
};

/**
 * Reset state - resets devnet if possible, or just clears caches
 */
export const resetMockState = () => {
  _starknetProvider = null;
  _devnetProvider = null;
  _predeployedAccounts = null;
};

/**
 * Get predeployed account addresses for use in tests
 */
export const getTestAccounts = async (): Promise<Address[]> => {
  const accounts = await getPredeployedAccounts();
  return accounts.map((acc) => acc.address as Address);
};

/**
 * Create starknet.js Account instance (exported for tests that need it)
 */
export const createStarknetAccount = async (index = 0): Promise<Account> => {
  const accounts = await getPredeployedAccounts();
  const account = accounts[index];
  if (!account) {
    throw new Error(`No predeployed account at index ${index}`);
  }
  // v9 API uses options object with explicit Signer
  // Use V3 transactions
  return new Account({
    provider: getStarknetProvider(),
    address: account.address,
    signer: new Signer(account.private_key),
    transactionVersion: ETransactionVersion.V3,
  });
};

/**
 * Get STRK fee token address (exported for tests that need it)
 */
export const getStrkTokenAddress = async (): Promise<Address> => {
  return STRK_TOKEN_ADDRESS;
};
