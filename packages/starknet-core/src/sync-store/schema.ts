import type { Factory, FragmentId } from "@/internal/types.js";
import {
  customType,
  index,
  pgSchema,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";
import type { Address, Hash, Hex } from "@/utils/hex.js";

const nummultirange = (name: string) =>
  customType<{ data: string }>({
    dataType() {
      return "nummultirange";
    },
  })(name);


/**
 * Database schemas for the sync.
 *
 * @dev The order of the schemas represents the order of the migrations.
 * @dev The schemas must match the files in "./sql".
 */
export const PONDER_SYNC_SCHEMAS = ["ponder_sync"] as const;
/**
 * Latest database schema for the sync.
 */
export const PONDER_SYNC_SCHEMA =
  PONDER_SYNC_SCHEMAS[PONDER_SYNC_SCHEMAS.length - 1]!;

export const PONDER_SYNC = pgSchema(PONDER_SYNC_SCHEMA);

export const blocks = PONDER_SYNC.table(
  "blocks",
  (t) => ({
    chainId: t.bigint("chain_id", { mode: "bigint" }).notNull(),
    number: t.bigint("number", { mode: "bigint" }).notNull(),
    timestamp: t.bigint("timestamp", { mode: "bigint" }).notNull(),
    hash: t.varchar("hash", { length: 66 }).notNull().$type<Hash>(),
    parentHash: t.varchar("parent_hash", { length: 66 }).notNull().$type<Hash>(),
    // Starknet-specific fields
    newRoot: t.varchar("new_root", { length: 66 }).notNull().$type<Hash>(),
    sequencerAddress: t.varchar("sequencer_address", { length: 66 }).notNull().$type<Address>(),
    starknetVersion: t.text("starknet_version").notNull(),
    status: t.text("status").notNull(), // "ACCEPTED_ON_L1" | "ACCEPTED_ON_L2" | "PENDING"
    l1DaMode: t.text("l1_da_mode").notNull(), // "BLOB" | "CALLDATA"
    l1GasPrice: t.text("l1_gas_price").notNull(), // JSON: { priceInFri, priceInWei }
    l1DataGasPrice: t.text("l1_data_gas_price").notNull(), // JSON: { priceInFri, priceInWei }
  }),
  (table) => [
    primaryKey({
      name: "blocks_pkey",
      columns: [table.chainId, table.number],
    }),
  ],
);

export const transactions = PONDER_SYNC.table(
  "transactions",
  (t) => ({
    chainId: t.bigint("chain_id", { mode: "bigint" }).notNull(),
    blockNumber: t.bigint("block_number", { mode: "bigint" }).notNull(),
    transactionIndex: t.integer("transaction_index").notNull(),
    hash: t.varchar("hash", { length: 66 }).notNull().$type<Hash>(),
    // Starknet-specific fields
    type: t.text("type").notNull(), // "INVOKE" | "DECLARE" | "DEPLOY" | "DEPLOY_ACCOUNT" | "L1_HANDLER"
    version: t.text("version").notNull().$type<Hex>(),
    senderAddress: t.varchar("sender_address", { length: 66 }).$type<Address>(),
    nonce: t.text("nonce").$type<Hex>(), // Stored as hex string, nullable for some tx types
    calldata: t.text("calldata"), // JSON array of hex strings
    signature: t.text("signature"), // JSON array of hex strings
    resourceBounds: t.text("resource_bounds"), // JSON: { l1Gas, l2Gas, l1DataGas }
    tip: t.text("tip").$type<Hex>(),
    paymasterData: t.text("paymaster_data"), // JSON array
    accountDeploymentData: t.text("account_deployment_data"), // JSON array
    feeDataAvailabilityMode: t.text("fee_data_availability_mode"), // "L1" | "L2"
    nonceDataAvailabilityMode: t.text("nonce_data_availability_mode"), // "L1" | "L2"
    // L1_HANDLER specific fields
    contractAddress: t.varchar("contract_address", { length: 66 }).$type<Address>(),
    entryPointSelector: t.text("entry_point_selector").$type<Hex>(),
    // DECLARE specific fields
    classHash: t.text("class_hash").$type<Hex>(),
    compiledClassHash: t.text("compiled_class_hash").$type<Hex>(),
    // DEPLOY, DEPLOY_ACCOUNT specific fields
    contractAddressSalt: t.text("contract_address_salt").$type<Hex>(),
    constructorCalldata: t.text("constructor_calldata"), // JSON array of hex strings
  }),
  (table) => [
    primaryKey({
      name: "transactions_pkey",
      columns: [table.chainId, table.blockNumber, table.transactionIndex],
    }),
  ],
);

export const transactionReceipts = PONDER_SYNC.table(
  "transaction_receipts",
  (t) => ({
    chainId: t.bigint("chain_id", { mode: "bigint" }).notNull(),
    blockNumber: t.bigint("block_number", { mode: "bigint" }).notNull(),
    transactionIndex: t.integer("transaction_index").notNull(),
    transactionHash: t.varchar("transaction_hash", { length: 66 }).notNull().$type<Hash>(),
    blockHash: t.varchar("block_hash", { length: 66 }).notNull().$type<Hash>(),
    // Starknet-specific fields
    actualFee: t.text("actual_fee").notNull(), // JSON: { amount: string, unit: string }
    executionResources: t.text("execution_resources").notNull(), // JSON: { l1DataGas, l1Gas, l2Gas }
    executionStatus: t.text("execution_status").notNull(), // "SUCCEEDED" | "REVERTED"
    finalityStatus: t.text("finality_status").notNull(), // "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1"
    messagesSent: t.text("messages_sent").notNull(), // JSON array
    events: t.text("events").notNull(), // JSON array of events
    revertReason: t.text("revert_reason"),
    contractAddress: t.varchar("contract_address", { length: 66 }).$type<Address>(), // For DEPLOY/DEPLOY_ACCOUNT transactions
    messageHash: t.varchar("message_hash", { length: 66 }).$type<Hex>(), // For L1_HANDLER transactions
  }),
  (table) => [
    primaryKey({
      name: "transaction_receipts_pkey",
      columns: [table.chainId, table.blockNumber, table.transactionIndex],
    }),
  ],
);

export const logs = PONDER_SYNC.table(
  "logs",
  (t) => ({
    chainId: t.bigint("chain_id", { mode: "bigint" }).notNull(),
    blockNumber: t.bigint("block_number", { mode: "bigint" }).notNull(),
    logIndex: t.integer("log_index").notNull(),
    transactionIndex: t.integer("transaction_index").notNull(),
    blockHash: t.varchar("block_hash", { length: 66 }).notNull().$type<Hash>(),
    transactionHash: t.varchar("transaction_hash", { length: 66 }).notNull().$type<Hash>(),
    address: t.varchar("address", { length: 66 }).notNull().$type<Address>(), // Starknet addresses are 66 chars
    topic0: t.varchar("topic0", { length: 66 }).$type<Hex>(),
    topic1: t.varchar("topic1", { length: 66 }).$type<Hex>(),
    topic2: t.varchar("topic2", { length: 66 }).$type<Hex>(),
    topic3: t.varchar("topic3", { length: 66 }).$type<Hex>(),
    allKeys: t.text("all_keys").$type<string | null>(),
    data: t.text("data").notNull().$type<Hex>(),
  }),
  (table) => [
    primaryKey({
      name: "logs_pkey",
      columns: [table.chainId, table.blockNumber, table.logIndex],
    }),
  ],
);

export const traces = PONDER_SYNC.table(
  "traces",
  (t) => ({
    chainId: t.bigint("chain_id", { mode: "bigint" }).notNull(),
    blockNumber: t.bigint("block_number", { mode: "bigint" }).notNull(),
    transactionIndex: t.integer("transaction_index").notNull(),
    traceIndex: t.integer("trace_index").notNull(),
    // Starknet addresses are 66 chars (0x + 64 hex)
    from: t.varchar("from", { length: 66 }).notNull().$type<Address>(),
    to: t.varchar("to", { length: 66 }).$type<Address>(),
    input: t.text("input").notNull().$type<Hex>(),
    output: t.text("output").$type<Hex>(),
    value: t.numeric("value", { precision: 78, scale: 0 }),
    type: t.text("type").notNull(), // "CALL" | "LIBRARY_CALL" | "DELEGATE" | "CONSTRUCTOR"
    gas: t.numeric("gas", { precision: 78, scale: 0 }).notNull(),
    gasUsed: t.numeric("gas_used", { precision: 78, scale: 0 }).notNull(),
    error: t.text("error"),
    revertReason: t.text("revert_reason"),
    subcalls: t.integer("subcalls").notNull(),
  }),
  (table) => [
    primaryKey({
      name: "traces_pkey",
      columns: [
        table.chainId,
        table.blockNumber,
        table.transactionIndex,
        table.traceIndex,
      ],
    }),
  ],
);

export const rpcRequestResults = PONDER_SYNC.table(
  "rpc_request_results",
  (t) => ({
    requestHash: t.text("request_hash").notNull(),
    chainId: t.bigint("chain_id", { mode: "bigint" }).notNull(),
    blockNumber: t.bigint("block_number", { mode: "bigint" }),
    result: t.text("result").notNull(),
  }),
  (table) => [
    primaryKey({
      name: "rpc_request_results_pkey",
      columns: [table.chainId, table.requestHash],
    }),
    index("rpc_request_results_chain_id_block_number_index").on(
      table.chainId,
      table.blockNumber,
    ),
  ],
);

export const intervals = PONDER_SYNC.table("intervals", (t) => ({
  fragmentId: t.text("fragment_id").notNull().$type<FragmentId>().primaryKey(),
  chainId: t.bigint("chain_id", { mode: "bigint" }).notNull(),
  blocks: nummultirange("blocks").notNull(),
}));

export const factories = PONDER_SYNC.table(
  "factories",
  (t) => ({
    id: t.integer("id").primaryKey().generatedAlwaysAsIdentity(),
    factory: t.jsonb("factory").$type<Omit<Factory, "id">>().notNull(),
  }),
  (table) => [
    index("factories_factory_idx").on(table.factory),
    unique("factories_factory_key").on(table.factory),
  ],
);

export const factoryAddresses = PONDER_SYNC.table(
  "factory_addresses",
  (t) => ({
    id: t.integer("id").primaryKey().generatedAlwaysAsIdentity(),
    factoryId: t.integer("factory_id").notNull(), // references `factories.id`
    chainId: t.bigint("chain_id", { mode: "bigint" }).notNull(),
    blockNumber: t.bigint("block_number", { mode: "bigint" }).notNull(),
    address: t.text("address").$type<Address>().notNull(),
  }),
  (table) => [index("factory_addresses_factory_id_index").on(table.factoryId)],
);
