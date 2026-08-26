import pg from "pg";

const { Client } = pg;

async function checkPgvector() {
  const client = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: "postgres",
    password: "moulish",
    database: "campus_biometrics",
  });
  await client.connect();

  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
    const res = await client.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'");
    if (res.rows.length > 0) {
      console.log("pgvector = ENABLED (Version:", res.rows[0].extversion, ")");
    } else {
      console.log("pgvector = DISABLED");
    }
  } catch (err) {
    console.error("pgvector error:", err.message);
  } finally {
    await client.end();
  }
}

checkPgvector();
