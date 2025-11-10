import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Devnet } from "starknet-devnet";
import dotenv from "dotenv";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

let devnetInstance: Awaited<ReturnType<typeof Devnet.spawnVersion>> | null =
  null;

export default async function () {
  dotenv.config({ path: ".env.local" });

  const generatedFilePath = join(__dirname, "generated.ts");
  if (!existsSync(generatedFilePath)) {
    // Cairo ABIs are manually maintained in generated.ts
    console.log("generated.ts exists, skipping generation");
  }

  try {
    devnetInstance = await Devnet.spawnVersion("v0.6.1", {
      args: [
        "--seed",
        "0",
        "--accounts",
        "10",
        "--initial-balance",
        "1000000000000000000000",
        "--dump-on",
        "request",
      ],
      stdout: "ignore",
      stderr: "ignore",
    });

    const isAlive = await devnetInstance.provider.isAlive();
    if (!isAlive) throw new Error("Starknet devnet failed to start");

    process.env.STARKNET_DEVNET_URL = devnetInstance.provider.url;
    console.log(`Starknet devnet started at ${devnetInstance.provider.url}`);

    const accounts = await devnetInstance.provider.getPredeployedAccounts();
    if (accounts && accounts.length > 0) {
      console.log(`First predeployed account: ${accounts[0]?.address}`);
      process.env.STARKNET_DEVNET_ACCOUNTS = JSON.stringify(accounts);
    }
  } catch (error) {
    console.error("Failed to start starknet-devnet:", error);
    process.env.STARKNET_DEVNET_URL = "";
  }

  let cleanupDatabase: (() => Promise<void>) | undefined;
  if (process.env.DATABASE_URL) {
    cleanupDatabase = async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });

      const databaseRows = await pool.query(`
        SELECT datname FROM pg_database WHERE datname LIKE 'vitest_%';
      `);
      const databases = databaseRows.rows.map((r) => r.datname) as string[];

      await Promise.all(
        databases.map((databaseName) =>
          pool.query(`DROP DATABASE "${databaseName}"`),
        ),
      );

      await pool.end();
    };
  }

  return async () => {
    if (devnetInstance) devnetInstance.kill();
    await cleanupDatabase?.();
  };
}
