import { ponder } from "ponder:registry";
import { deposit, recipientStats, withdrawal } from "ponder:schema";

ponder.on("WBTCBridge:DepositHandled", async ({ event, context }) => {
  await context.db.insert(deposit).values({
    id: event.id,
    l1Token: event.args.l1_token,
    l2Recipient: event.args.l2_recipient,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
    transactionHash: event.transaction.hash,
  });

  await context.db
    .insert(recipientStats)
    .values({
      address: event.args.l2_recipient,
      totalDeposits: event.args.amount,
      depositCount: 1,
      totalWithdrawals: 0n,
      withdrawalCount: 0,
    })
    .onConflictDoUpdate((row) => ({
      totalDeposits: row.totalDeposits + event.args.amount,
      depositCount: row.depositCount + 1,
    }));
});

ponder.on("WBTCBridge:WithdrawInitiated", async ({ event, context }) => {
  await context.db.insert(withdrawal).values({
    id: event.id,
    l1Token: event.args.l1_token,
    l1Recipient: event.args.l1_recipient,
    callerAddress: event.args.caller_address,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
    transactionHash: event.transaction.hash,
  });

  await context.db
    .insert(recipientStats)
    .values({
      address: event.args.caller_address,
      totalDeposits: 0n,
      depositCount: 0,
      totalWithdrawals: event.args.amount,
      withdrawalCount: 1,
    })
    .onConflictDoUpdate((row) => ({
      totalWithdrawals: row.totalWithdrawals + event.args.amount,
      withdrawalCount: row.withdrawalCount + 1,
    }));
});
