import pg from "pg";

const { Client } = pg;

async function main() {
  const adminClient = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: "postgres",
    password: "moulish",
    database: "postgres",
  });
  await adminClient.connect();
  const dbCheck = await adminClient.query("SELECT 1 FROM pg_database WHERE datname='campus_biometrics'");
  if (dbCheck.rows.length === 0) {
    await adminClient.query("CREATE DATABASE campus_biometrics");
    console.log("Database campus_biometrics created.");
  } else {
    console.log("Database campus_biometrics already exists.");
  }
  await adminClient.end();

  const cbClient = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: "postgres",
    password: "moulish",
    database: "campus_biometrics",
  });
  await cbClient.connect();
  const ver = await cbClient.query("SELECT version()");
  console.log("PostgreSQL version:", ver.rows[0].version);
  console.log("Host: 127.0.0.1");
  console.log("Port: 5432");
  console.log("Database: campus_biometrics");
  console.log("PostgreSQL connection: CONNECTED");
  await cbClient.end();
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
