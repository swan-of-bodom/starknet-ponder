import { onchainTable, index } from "starknet-ponder";

// VToken (ERC4626 vault) metadata
export const vToken = onchainTable("vToken", (t) => ({
  id: t.text().primaryKey(), // contract address
  pool: t.text().notNull(),
  asset: t.text().notNull(),
  name: t.text().notNull(),
  symbol: t.text().notNull(),
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

