import { onchainTable } from "starknet-ponder";

export const pool = onchainTable("pool", (t) => ({
  id: t.text().primaryKey(),
  token0: t.text().notNull(),
  token1: t.text().notNull(),
  fee: t.integer().notNull(),
  tickSpacing: t.integer().notNull(),
  createdAtBlock: t.bigint().notNull(),
  createdAtTimestamp: t.bigint().notNull(),
  createdTxHash: t.hex().notNull(),
}));

export const swap = onchainTable("swap", (t) => ({
  id: t.text().primaryKey(),
  poolAddress: t.text().notNull(),
  sender: t.text().notNull(),
  recipient: t.text().notNull(),
  amount0: t.text().notNull(),
  amount1: t.text().notNull(),
  sqrtPriceX96: t.text().notNull(),
  liquidity: t.text().notNull(),
  tick: t.integer().notNull(),
}));

