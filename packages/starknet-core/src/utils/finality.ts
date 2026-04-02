import type { Chain } from "viem";

/**
 * Returns the number of blocks that must pass before a block is considered final.
 * Note that a value of `0` indicates that blocks are considered final immediately.
 *
 * @param chain The chain to get the finality block count for.
 * @returns The finality block count.
 */
export function getFinalityBlockCount({ chain }: { chain: Chain | undefined }) {
  let finalityBlockCount: number;
  switch (chain?.id) {
    // Starknet mainnet (id=1) and testnet (id=2).
    case 1:
    case 2:
      finalityBlockCount = 10;
      break;
    default:
      finalityBlockCount = 10;
  }

  return finalityBlockCount;
}
