import { onchainTable } from "starknet-ponder";

export const pool = onchainTable("pool", (t) => ({
  id: t.text().primaryKey(),
  token0: t.hex().notNull(),
  token1: t.hex().notNull(),
  fee: t.bigint().notNull(),
  tickSpacing: t.bigint().notNull(),
  extension: t.hex().notNull(),
  createdAtBlock: t.bigint().notNull(),
  createdAtTimestamp: t.bigint().notNull(),
  createdTxHash: t.hex().notNull(),
}));

export const token = onchainTable("token", (t) => ({
  id: t.hex().primaryKey(),
  name: t.text().notNull(),
  symbol: t.text().notNull(),
  decimals: t.integer().notNull()
}))

