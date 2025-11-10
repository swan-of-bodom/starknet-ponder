import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { graphql } from "starknet-ponder";
import type { Address } from "starkweb2";
import { eq } from "starknet-ponder";

const app = new Hono();

app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

app.get("/tokens", async (c) => {
  const rows = await db.select().from(schema.token);
  return c.json(rows);
})

app.get("/tokens/:address", async (c) => {
  const address = c.req.param("address").toLowerCase() as Address;
  const token = await db.query.token.findFirst({
    where: eq(schema.token.id, address),
  });

  return c.json(token)
})

export default app;

