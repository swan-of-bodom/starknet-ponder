import { type Logger, createNoopLogger } from "@/internal/logger.js";
import type { Kysely, Migration, MigrationProvider } from "kysely";
import { sql } from "kysely";

let logger = createNoopLogger();

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export function buildMigrationProvider(logger_: Logger) {
  logger = logger_;
  return new StaticMigrationProvider();
}

const migrations: Record<string, Migration> = {
  "0001_initial_starknet": {
    async up(db: Kysely<any>) {
      logger.debug({
        msg: `${new Date().toISOString()} [ponder_sync migration] started 0001_initial_starknet`,
      });

      // ============================================
      // BLOCKS
      // ============================================

      await db.schema
        .createTable("blocks")
        .addColumn("chain_id", "bigint", (col) => col.notNull())
        .addColumn("number", "bigint", (col) => col.notNull())
        .addColumn("timestamp", "bigint", (col) => col.notNull())
        .addColumn("hash", "varchar(66)", (col) => col.notNull())
        .addColumn("parent_hash", "varchar(66)", (col) => col.notNull())
        .addColumn("new_root", "varchar(66)", (col) => col.notNull())
        .addColumn("sequencer_address", "varchar(66)", (col) => col.notNull())
        .addColumn("starknet_version", "text", (col) => col.notNull())
        .addColumn("status", "text", (col) => col.notNull())
        .addColumn("l1_da_mode", "text", (col) => col.notNull())
        .addColumn("l1_gas_price", "text", (col) => col.notNull())
        .addColumn("l1_data_gas_price", "text", (col) => col.notNull())
        .addPrimaryKeyConstraint("blocks_pkey", ["chain_id", "number"])
        .execute();

      // ============================================
      // TRANSACTIONS
      // ============================================

      await db.schema
        .createTable("transactions")
        .addColumn("chain_id", "bigint", (col) => col.notNull())
        .addColumn("block_number", "bigint", (col) => col.notNull())
        .addColumn("transaction_index", "integer", (col) => col.notNull())
        .addColumn("hash", "varchar(66)", (col) => col.notNull())
        .addColumn("type", "text", (col) => col.notNull())
        .addColumn("version", "text", (col) => col.notNull())
        .addColumn("sender_address", "varchar(66)")
        .addColumn("nonce", "text")
        .addColumn("calldata", "text")
        .addColumn("signature", "text")
        .addColumn("resource_bounds", "text")
        .addColumn("tip", "text")
        .addColumn("paymaster_data", "text")
        .addColumn("account_deployment_data", "text")
        .addColumn("fee_data_availability_mode", "text")
        .addColumn("nonce_data_availability_mode", "text")
        // L1_HANDLER specific
        .addColumn("contract_address", "varchar(66)")
        .addColumn("entry_point_selector", "text")
        // DECLARE specific
        .addColumn("class_hash", "text")
        .addColumn("compiled_class_hash", "text")
        // DEPLOY / DEPLOY_ACCOUNT specific
        .addColumn("contract_address_salt", "text")
        .addColumn("constructor_calldata", "text")
        .addPrimaryKeyConstraint("transactions_pkey", [
          "chain_id",
          "block_number",
          "transaction_index",
        ])
        .execute();

      // ============================================
      // TRANSACTION RECEIPTS - Starknet-native schema
      // ============================================

      await db.schema
        .createTable("transaction_receipts")
        .addColumn("chain_id", "bigint", (col) => col.notNull())
        .addColumn("block_number", "bigint", (col) => col.notNull())
        .addColumn("transaction_index", "integer", (col) => col.notNull())
        .addColumn("transaction_hash", "varchar(66)", (col) => col.notNull())
        .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
        .addColumn("actual_fee", "text", (col) => col.notNull())
        .addColumn("execution_resources", "text", (col) => col.notNull())
        .addColumn("execution_status", "text", (col) => col.notNull())
        .addColumn("finality_status", "text", (col) => col.notNull())
        .addColumn("messages_sent", "text", (col) => col.notNull())
        .addColumn("events", "text", (col) => col.notNull())
        .addColumn("revert_reason", "text")
        .addColumn("contract_address", "varchar(66)")
        .addColumn("message_hash", "varchar(66)")
        .addPrimaryKeyConstraint("transaction_receipts_pkey", [
          "chain_id",
          "block_number",
          "transaction_index",
        ])
        .execute();

      // ============================================
      // LOGS (Events)
      // ============================================

      await db.schema
        .createTable("logs")
        .addColumn("chain_id", "bigint", (col) => col.notNull())
        .addColumn("block_number", "bigint", (col) => col.notNull())
        .addColumn("log_index", "integer", (col) => col.notNull())
        .addColumn("transaction_index", "integer", (col) => col.notNull())
        .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
        .addColumn("transaction_hash", "varchar(66)", (col) => col.notNull())
        .addColumn("address", "varchar(66)", (col) => col.notNull())
        .addColumn("topic0", "varchar(66)")
        .addColumn("topic1", "varchar(66)")
        .addColumn("topic2", "varchar(66)")
        .addColumn("topic3", "varchar(66)")
        .addColumn("all_keys", "text")
        .addColumn("data", "text", (col) => col.notNull())
        .addPrimaryKeyConstraint("logs_pkey", [
          "chain_id",
          "block_number",
          "log_index",
        ])
        .execute();

      // ============================================
      // TODO: TRACES (Call traces)
      // ============================================

      await db.schema
        .createTable("traces")
        .addColumn("chain_id", "bigint", (col) => col.notNull())
        .addColumn("block_number", "bigint", (col) => col.notNull())
        .addColumn("transaction_index", "integer", (col) => col.notNull())
        .addColumn("trace_index", "integer", (col) => col.notNull())
        .addColumn("from", "varchar(66)", (col) => col.notNull())
        .addColumn("to", "varchar(66)")
        .addColumn("input", "text", (col) => col.notNull())
        .addColumn("output", "text")
        .addColumn("value", "numeric(78, 0)")
        .addColumn("type", "text", (col) => col.notNull())
        .addColumn("gas", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("gas_used", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("error", "text")
        .addColumn("revert_reason", "text")
        .addColumn("subcalls", "integer", (col) => col.notNull())
        .addPrimaryKeyConstraint("traces_pkey", [
          "chain_id",
          "block_number",
          "transaction_index",
          "trace_index",
        ])
        .execute();

      // ============================================
      // RPC REQUEST CACHE
      // ============================================

      await db.schema
        .createTable("rpc_request_results")
        .addColumn("request_hash", "text", (col) => col.notNull())
        .addColumn("chain_id", "bigint", (col) => col.notNull())
        .addColumn("block_number", "bigint")
        .addColumn("result", "text", (col) => col.notNull())
        .addPrimaryKeyConstraint("rpc_request_results_pkey", [
          "chain_id",
          "request_hash",
        ])
        .execute();

      await db.schema
        .createIndex("rpc_request_results_chain_id_block_number_index")
        .on("rpc_request_results")
        .columns(["chain_id", "block_number"])
        .execute();

      // ============================================
      // SYNC INTERVALS
      // ============================================

      await db.schema
        .createTable("intervals")
        .addColumn("fragment_id", "text", (col) => col.notNull().primaryKey())
        .addColumn("chain_id", "bigint", (col) => col.notNull())
        .addColumn("blocks", sql`nummultirange`, (col) => col.notNull())
        .execute();

      // ============================================
      // FACTORIES (for dynamic contract discovery)
      // ============================================

      await db.schema
        .createTable("factories")
        .addColumn("id", "integer", (col) =>
          col.generatedAlwaysAsIdentity().primaryKey(),
        )
        .addColumn("factory", "jsonb", (col) => col.notNull().unique())
        .execute();

      await db.schema
        .createIndex("factories_factory_index")
        .on("factories")
        .column("factory")
        .execute();

      // ============================================
      // FACTORY ADDRESSES (discovered child contracts)
      // ============================================

      await db.schema
        .createTable("factory_addresses")
        .addColumn("id", "integer", (col) =>
          col.generatedAlwaysAsIdentity().primaryKey(),
        )
        .addColumn("factory_id", "integer", (col) => col.notNull())
        .addColumn("chain_id", "bigint", (col) => col.notNull())
        .addColumn("block_number", "bigint", (col) => col.notNull())
        .addColumn("address", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("factory_addresses_factory_id_index")
        .on("factory_addresses")
        .column("factory_id")
        .execute();

      logger.debug({
        msg: `${new Date().toISOString()} [ponder_sync migration] finished 0001_initial_starknet`,
      });
    },
  },
};
