import { index, onchainTable, relations } from "starknet-ponder";

export const sponsoredUser = onchainTable("sponsored_user", (t) => ({
  address: t.hex().primaryKey(),
  totalTransactions: t.integer().notNull(),
  firstSponsoredAt: t.integer().notNull(),
  lastSponsoredAt: t.integer().notNull(),
}));

export const sponsoredUserRelations = relations(sponsoredUser, ({ many }) => ({
  transactions: many(sponsoredTransaction),
}));

export const sponsoredTransaction = onchainTable(
  "sponsored_transaction",
  (t) => ({
    id: t.text().primaryKey(),
    userAddress: t.hex().notNull(),
    sponsorMetadata: t.text().notNull(),
    transactionHash: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    userIdx: index("user_index").on(table.userAddress),
    blockIdx: index("block_index").on(table.blockNumber),
  }),
);

export const sponsoredTransactionRelations = relations(
  sponsoredTransaction,
  ({ one }) => ({
    user: one(sponsoredUser, {
      fields: [sponsoredTransaction.userAddress],
      references: [sponsoredUser.address],
    }),
  }),
);

export const ownershipTransfer = onchainTable("ownership_transfer", (t) => ({
  id: t.text().primaryKey(),
  previousOwner: t.hex().notNull(),
  newOwner: t.hex().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
}));

export const contractUpgrade = onchainTable("contract_upgrade", (t) => ({
  id: t.text().primaryKey(),
  classHash: t.hex().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
}));

export const dailyStats = onchainTable("daily_stats", (t) => ({
  date: t.text().primaryKey(),
  transactionCount: t.integer().notNull(),
  uniqueUsers: t.integer().notNull(),
}));
