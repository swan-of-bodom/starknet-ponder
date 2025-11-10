import { index, onchainTable } from "starknet-ponder";

export const deposit = onchainTable(
  "deposit",
  (t) => ({
    id: t.text().primaryKey(),
    l1Token: t.hex().notNull(),
    l2Recipient: t.hex().notNull(),
    amount: t.bigint().notNull(),
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
    transactionHash: t.hex().notNull(),
  }),
  (table) => ({
    recipientIdx: index("recipient_index").on(table.l2Recipient),
    l1TokenIdx: index("l1_token_index").on(table.l1Token),
  }),
);

export const withdrawal = onchainTable(
  "withdrawal",
  (t) => ({
    id: t.text().primaryKey(),
    l1Token: t.hex().notNull(),
    l1Recipient: t.hex().notNull(),
    callerAddress: t.hex().notNull(),
    amount: t.bigint().notNull(),
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
    transactionHash: t.hex().notNull(),
  }),
  (table) => ({
    recipientIdx: index("l1_recipient_index").on(table.l1Recipient),
    callerIdx: index("caller_index").on(table.callerAddress),
  }),
);

export const recipientStats = onchainTable("recipient_stats", (t) => ({
  address: t.hex().primaryKey(),
  totalDeposits: t.bigint().notNull(),
  depositCount: t.integer().notNull(),
  totalWithdrawals: t.bigint().notNull(),
  withdrawalCount: t.integer().notNull(),
}));
