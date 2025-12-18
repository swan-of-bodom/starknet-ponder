import type { Chain } from "viem";

/**
 * Starknet chain definitions compatible with viem's Chain type
 * These are simplified for Starknet's use cases
 */

/** Starknet Mainnet */
export const mainnet: Chain = {
  id: 1, // Internal numeric ID for Starknet mainnet (mapped from SN_MAIN)
  name: "Starknet Mainnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://starknet-mainnet.public.blastapi.io"],
    },
  },
  blockExplorers: {
    default: {
      name: "Starkscan",
      url: "https://starkscan.co",
    },
  },
};

/** Starknet Sepolia Testnet */
export const sepolia: Chain = {
  id: 2, // Internal numeric ID for Starknet sepolia (mapped from SN_SEPOLIA)
  name: "Starknet Sepolia",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://starknet-sepolia.public.blastapi.io"],
    },
  },
  blockExplorers: {
    default: {
      name: "Starkscan",
      url: "https://sepolia.starkscan.co",
    },
  },
  testnet: true,
};

/** All Starknet chains */
export const chains: Record<string, Chain> = {
  mainnet,
  sepolia,
};
