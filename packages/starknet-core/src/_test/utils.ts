import { type AddressInfo, createServer } from "node:net";
import { buildLogFactory } from "@/build/factory.js";
import { factory } from "@/config/address.js";
import type { Common } from "@/internal/common.js";
import type {
  AccountMetadata,
  AccountSource,
  BlockSource,
  Chain,
  ContractMetadata,
  ContractSource,
  Event,
  Factory,
  FilterAddress,
  IndexingFunctions,
  LogFactory,
  Source,
  Status,
  TransactionFilter,
} from "@/internal/types.js";
import {
  buildEvents,
  decodeEvents,
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "@/runtime/events.js";
import {
  defaultBlockFilterInclude,
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
  defaultTransactionFilterInclude,
  defaultTransactionReceiptInclude,
  defaultTransferFilterInclude,
} from "@/runtime/filter.js";
import { buildAbiEvents, buildAbiFunctions } from "@/utils/abi.js";
import { computeEventSelector } from "@/utils/event-selector.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { Address, Chain as ViemChain } from "viem";
import type { StarknetAbi } from "@/types/starknetAbi.js";
import { RpcProvider as StarknetRpcProvider } from "starknet";
import { DevnetProvider } from "starknet-devnet";
import { vi } from "vitest";
import { erc20ABI, factoryABI, pairABI } from "./generated.js";
import type {
  mintErc20,
  simulateBlock,
  swapPair,
  transferErc20,
  transferEth,
} from "./simulate.js";

// Starknet devnet test setup
// ID of the current test worker
export const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

// Get devnet URL from environment (set by globalSetup.ts)
export const getDevnetUrl = () => process.env.STARKNET_DEVNET_URL || "http://127.0.0.1:5050";

// ============================================================================
// Predeployed Contracts (same addresses as Starknet mainnet/testnet)
// ============================================================================

/** STRK token address - predeployed on devnet */
export const STRK_TOKEN_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d" as const;

/** ETH token address - predeployed on devnet */
export const ETH_TOKEN_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7" as const;

/** Universal Deployer Contract (UDC) address */
export const UDC_ADDRESS = "0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf" as const;

/** Get predeployed accounts from devnet via JSON-RPC */
export const getPredeployedAccounts = async (withBalance = false) => {
  const response = await fetch(getDevnetUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "devnet_getPredeployedAccounts",
      params: { with_balance: withBalance },
    }),
  });
  const data = await response.json();
  return data.result as Array<{
    initial_balance: string;
    address: string;
    public_key: string;
    private_key: string;
    balance?: {
      eth: { amount: string; unit: string };
      strk: { amount: string; unit: string };
    };
  }>;
};

// Starknet chain config for viem Chain compatibility
export const anvil: ViemChain = {
  id: 1, // Using chainId 1 for compatibility (Starknet uses different chain IDs)
  name: "Starknet Devnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [getDevnetUrl()],
    },
  },
};

// Create starknet.js RPC provider for Starknet JSON-RPC calls
export const starknetProvider = new StarknetRpcProvider({
  nodeUrl: getDevnetUrl(),
});

// Create devnet provider for devnet-specific operations (dump/load state, etc.)
export const devnetProvider = new DevnetProvider({ url: getDevnetUrl() });

// Import resetMockState lazily to avoid circular deps
let _resetMockState: (() => void) | null = null;
const getResetMockState = async () => {
  if (!_resetMockState) {
    const { resetMockState } = await import("./simulate.js");
    _resetMockState = resetMockState;
  }
  return _resetMockState;
};

// Test client with snapshot/revert functionality using devnet's restart
// Since dump/load requires file paths, we use restart for clean state between tests
export const testClient = {
  snapshot: async () => {
    // For starknet devnet, we just return a dummy ID
    // The actual state reset happens on revert via restart()
    return `snapshot_${Date.now()}`;
  },
  revert: async (_args: { id: string }) => {
    try {
      // Restart devnet to get clean state (resets nonces, blocks, etc.)
      await devnetProvider.restart();
      // Reset cached providers in simulate.ts so they reconnect to restarted devnet
      const resetMockState = await getResetMockState();
      resetMockState();
    } catch (e) {
      console.warn("Failed to restart devnet:", e);
    }
  },
  mine: async (_args?: { blocks?: number }) => {
    // Create a block on starknet devnet
    try {
      await devnetProvider.createBlock();
    } catch {
      // Ignore errors - devnet might not support this
    }
  },
} as any;

export const getErc20IndexingBuild = <
  includeCallTraces extends boolean = false,
>(params: {
  address: Address;
  includeCallTraces?: includeCallTraces;
  includeTransactionReceipts?: boolean;
}): includeCallTraces extends true
  ? {
      sources: [
        ContractSource<"trace", undefined, undefined, undefined>,
        ContractSource<"log", undefined, undefined, undefined>,
      ];
      indexingFunctions: IndexingFunctions;
    }
  : {
      sources: [ContractSource<"log", undefined, undefined, undefined>];
      indexingFunctions: IndexingFunctions;
    } => {
  // Use Starknet ABI utilities for Cairo ABIs
  const contractMetadata = {
    type: "contract",
    abi: erc20ABI,
    abiEvents: buildAbiEvents({ abi: erc20ABI as unknown as StarknetAbi }),
    abiFunctions: buildAbiFunctions({ abi: erc20ABI as unknown as StarknetAbi }),
    name: "Erc20",
    chain: getChain(),
  } satisfies ContractMetadata;

  // Compute Starknet event selector for Transfer event
  // The ETH token on devnet uses the standard Transfer event name
  const transferSelector = computeEventSelector("Transfer");
  // Compute function selector for transfer (Starknet uses the function name hash)
  const transferFunctionSelector = computeEventSelector("transfer");

  const sources = params.includeCallTraces
    ? ([
        {
          filter: {
            type: "trace",
            chainId: 1,
            fromAddress: undefined,
            toAddress: toLowerCase(params.address),
            callType: "CALL",
            functionSelector: transferFunctionSelector,
            includeReverted: false,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultTraceFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          ...contractMetadata,
        },
        {
          filter: {
            type: "log",
            chainId: 1,
            address: toLowerCase(params.address),
            topic0: transferSelector,
            topic1: null,
            topic2: null,
            topic3: null,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultLogFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          ...contractMetadata,
        },
      ] satisfies [ContractSource, ContractSource])
    : ([
        {
          filter: {
            type: "log",
            chainId: 1,
            address: toLowerCase(params.address),
            topic0: transferSelector,
            topic1: null,
            topic2: null,
            topic3: null,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultLogFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          ...contractMetadata,
        },
      ] satisfies [ContractSource]);

  // Cairo event naming - just the event name, no EVM-style type signatures
  const indexingFunctions = params.includeCallTraces
    ? {
        "Erc20.transfer()": vi.fn(),
        "Erc20:Transfer": vi.fn(),
        "Erc20:setup": vi.fn(),
      }
    : {
        "Erc20:Transfer": vi.fn(),
        "Erc20:setup": vi.fn(),
      };

  // @ts-ignore
  return { sources, indexingFunctions };
};

export const getPairWithFactoryIndexingBuild = <
  includeCallTraces extends boolean = false,
>(params: {
  address: Address;
  includeCallTraces?: includeCallTraces;
  includeTransactionReceipts?: boolean;
}): includeCallTraces extends true
  ? {
      sources: [
        ContractSource<"trace", undefined, undefined, LogFactory>,
        ContractSource<"log", LogFactory, undefined, undefined>,
      ];
      indexingFunctions: IndexingFunctions;
    }
  : {
      sources: [ContractSource<"log", LogFactory, undefined, undefined>];
      indexingFunctions: IndexingFunctions;
    } => {
  // Use Starknet ABI utilities for Cairo ABIs
  const contractMetadata = {
    type: "contract",
    abi: pairABI,
    abiEvents: buildAbiEvents({ abi: pairABI as unknown as StarknetAbi }),
    abiFunctions: buildAbiFunctions({ abi: pairABI as unknown as StarknetAbi }),
    name: "Pair",
    chain: getChain(),
  } satisfies ContractMetadata;

  // For Starknet factory pattern, we need to find the PairCreated event
  // and use it with the factory address pattern
  const pairCreatedEvent = (factoryABI as readonly any[]).find(
    (item: any) => item.type === "event" && item.name === "PairCreated",
  );

  const pairAddress = buildLogFactory({
    chainId: 1,
    fromBlock: undefined,
    toBlock: undefined,
    ...factory({
      address: params.address,
      event: pairCreatedEvent,
      parameter: "pair",
    }),
  }) satisfies FilterAddress<Factory>;

  // Compute Starknet event/function selectors
  const swapSelector = computeEventSelector("Swap");
  const swapFunctionSelector = computeEventSelector("swap");

  const sources = params.includeCallTraces
    ? ([
        {
          filter: {
            type: "trace",
            chainId: 1,
            fromAddress: undefined,
            toAddress: pairAddress,
            callType: "CALL",
            functionSelector: swapFunctionSelector,
            includeReverted: false,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultTraceFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          ...contractMetadata,
        },
        {
          filter: {
            type: "log",
            chainId: 1,
            address: pairAddress,
            topic0: swapSelector,
            topic1: null,
            topic2: null,
            topic3: null,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultLogFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          ...contractMetadata,
        },
      ] satisfies [ContractSource, ContractSource])
    : ([
        {
          filter: {
            type: "log",
            chainId: 1,
            address: pairAddress,
            topic0: swapSelector,
            topic1: null,
            topic2: null,
            topic3: null,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultLogFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          ...contractMetadata,
        },
      ] satisfies [ContractSource]);

  const indexingFunctions = params.includeCallTraces
    ? {
        "Pair.swap()": vi.fn(),
        "Pair:Swap": vi.fn(),
        "Pair:setup": vi.fn(),
      }
    : {
        "Pair:Swap": vi.fn(),
        "Pair:setup": vi.fn(),
      };

  // @ts-ignore
  return { sources, indexingFunctions };
};

export const getBlocksIndexingBuild = (params: {
  interval: number;
}): {
  sources: [BlockSource];
  indexingFunctions: IndexingFunctions;
} => {
  const sources = [
    {
      filter: {
        type: "block",
        chainId: 1,
        interval: params.interval,
        offset: 0,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: false,
        include: defaultBlockFilterInclude,
      },
      type: "block",
      name: "Blocks",
      chain: getChain(),
    },
  ] satisfies [BlockSource];

  const indexingFunctions = {
    "Blocks:block": vi.fn(),
  };

  return { sources, indexingFunctions };
};

export const getAccountsIndexingBuild = (params: {
  address: Address;
}): {
  sources: [
    AccountSource<"transaction", undefined, undefined>,
    AccountSource<"transaction", undefined, undefined>,
    AccountSource<"transfer", undefined, undefined>,
    AccountSource<"transfer", undefined, undefined>,
  ];
  indexingFunctions: IndexingFunctions;
} => {
  const accountMetadata = {
    type: "account",
    name: "Accounts",
    chain: getChain(),
  } satisfies AccountMetadata;

  const sources = [
    {
      filter: {
        type: "transaction",
        chainId: 1,
        fromAddress: undefined,
        toAddress: toLowerCase(params.address),
        includeReverted: false,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: true,
        include: defaultTransactionFilterInclude,
      } satisfies TransactionFilter,
      ...accountMetadata,
    },
    {
      filter: {
        type: "transaction",
        chainId: 1,
        fromAddress: toLowerCase(params.address),
        toAddress: undefined,
        includeReverted: false,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: true,
        include: defaultTransactionFilterInclude,
      } satisfies TransactionFilter,
      ...accountMetadata,
    },
    {
      filter: {
        type: "transfer",
        chainId: 1,
        fromAddress: undefined,
        toAddress: toLowerCase(params.address),
        includeReverted: false,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: false,
        include: defaultTransferFilterInclude,
      },
      ...accountMetadata,
    },
    {
      filter: {
        type: "transfer",
        chainId: 1,
        fromAddress: toLowerCase(params.address),
        toAddress: undefined,
        includeReverted: false,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: false,
        include: defaultTransferFilterInclude,
      },
      ...accountMetadata,
    },
  ] satisfies [AccountSource, AccountSource, AccountSource, AccountSource];

  const indexingFunctions = {
    "Accounts:transaction:from": vi.fn(),
    "Accounts:transaction:to": vi.fn(),
    "Accounts:transfer:from": vi.fn(),
    "Accounts:transfer:to": vi.fn(),
  };

  return { sources, indexingFunctions };
};

export const getSimulatedEvent = ({
  source,
  blockData,
}: {
  source: Source;
  blockData:
    | Awaited<ReturnType<typeof simulateBlock>>
    | Awaited<ReturnType<typeof mintErc20>>
    | Awaited<ReturnType<typeof transferErc20>>
    | Awaited<ReturnType<typeof transferEth>>
    | Awaited<ReturnType<typeof swapPair>>;
}): Event => {
  const rawEvents = buildEvents({
    sources: [source],
    blocks: [syncBlockToInternal({ block: blockData.block })],
    // @ts-ignore
    logs: blockData.log ? [syncLogToInternal({ log: blockData.log })] : [],
    // @ts-ignore
    transactions: blockData.transaction
      ? // @ts-ignore
        [syncTransactionToInternal({ transaction: blockData.transaction, blockNumber: blockData.block.number })]
      : [],
    // @ts-ignore
    transactionReceipts: blockData.transactionReceipt
      ? [
          syncTransactionReceiptToInternal({
            // @ts-ignore
            transactionReceipt: blockData.transactionReceipt,
          }),
        ]
      : [],
    // @ts-ignore
    traces: blockData.trace
      ? // @ts-ignore
        [syncTraceToInternal({ trace: blockData.trace })]
      : [],
    childAddresses: new Map(),
    chainId: 1,
  });

  const events = decodeEvents({} as Common, [source], rawEvents);

  if (events.length !== 1) {
    throw new Error("getSimulatedEvent() failed to construct the event");
  }

  return events[0]!;
};

export const getChain = (params?: {
  finalityBlockCount?: number;
}) => {
  return {
    // Use "mainnet" for test compatibility with expected assertions
    name: "mainnet",
    id: 1,
    rpc: getDevnetUrl(),
    pollingInterval: 1_000,
    finalityBlockCount: params?.finalityBlockCount ?? 1,
    disableCache: false,
    viemChain: anvil,
  } satisfies Chain;
};

export function getFreePort(): Promise<number> {
  return new Promise((res) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => res(port));
    });
  });
}

export async function waitForIndexedBlock({
  port,
  chainName,
  block,
}: {
  port: number;
  chainName: string;
  block: { number: number };
}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out while waiting for the indexed block."));
    }, 5_000);
    const interval = setInterval(async () => {
      const response = await fetch(`http://localhost:${port}/status`);
      if (response.status === 200) {
        const status = (await response.json()) as Status;
        const sb = status[chainName]?.block;
        if (sb !== undefined && sb.number >= block.number) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve(undefined);
        }
      }
    }, 20);
  });
}
