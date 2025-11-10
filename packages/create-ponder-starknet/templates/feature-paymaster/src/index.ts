import { ponder } from "ponder:registry";
import {
  contractUpgrade,
  dailyStats,
  ownershipTransfer,
  sponsoredTransaction,
  sponsoredUser,
} from "ponder:schema";

ponder.on("Forwarder:SponsoredTransaction", async ({ event, context }) => {
  const timestamp = Number(event.block.timestamp);
  const date = new Date(timestamp * 1000).toISOString().split("T")[0]!;

  // Upsert the user
  await context.db
    .insert(sponsoredUser)
    .values({
      address: event.args.user_address,
      totalTransactions: 1,
      firstSponsoredAt: timestamp,
      lastSponsoredAt: timestamp,
    })
    .onConflictDoUpdate((row) => ({
      totalTransactions: row.totalTransactions + 1,
      lastSponsoredAt: timestamp,
    }));

  // Record the sponsored transaction
  await context.db.insert(sponsoredTransaction).values({
    id: event.id,
    userAddress: event.args.user_address,
    sponsorMetadata: JSON.stringify(event.args.sponsor_metadata),
    transactionHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp,
  });

  // Update daily stats
  await context.db
    .insert(dailyStats)
    .values({
      date,
      transactionCount: 1,
      uniqueUsers: 1,
    })
    .onConflictDoUpdate((row) => ({
      transactionCount: row.transactionCount + 1,
    }));
});

ponder.on("Forwarder:OwnershipTransferred", async ({ event, context }) => {
  await context.db.insert(ownershipTransfer).values({
    id: event.id,
    previousOwner: event.args.previous_owner,
    newOwner: event.args.new_owner,
    blockNumber: event.block.number,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("Forwarder:Upgraded", async ({ event, context }) => {
  await context.db.insert(contractUpgrade).values({
    id: event.id,
    classHash: event.args.class_hash,
    blockNumber: event.block.number,
    timestamp: Number(event.block.timestamp),
  });
});
