const keys = require("./keys");

// Express Application setup
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Postgres client setup
const { Pool } = require("pg");
const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort
});

pgClient.on("connect", client => {
  client
    .query("CREATE TABLE IF NOT EXISTS values (number INT)")
    .catch(err => console.log("PG ERROR", err));
  client
    .query(
      "CREATE TABLE IF NOT EXISTS entries (id SERIAL PRIMARY KEY, text TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())"
    )
    .catch(err => console.log("PG ERROR", err));
});

//Express route definitions
app.get("/", (req, res) => {
  res.send("Hi");
});

// get the values
app.get("/values/all", async (req, res) => {
  const values = await pgClient.query("SELECT * FROM values");

  res.send(values);
});

// now the post -> insert value
app.post("/values", async (req, res) => {
  if (!req.body.value) res.send({ working: false });

  pgClient.query("INSERT INTO values(number) VALUES($1)", [req.body.value]);

  res.send({ working: true });
});

// Simple gratitude entries API
app.get("/entries/all", async (req, res) => {
  try {
    const result = await pgClient.query(
      "SELECT id, text, created_at FROM entries ORDER BY created_at DESC LIMIT 50"
    );
    res.send({ rows: result.rows });
  } catch (e) {
    res.status(500).send({ error: "Failed to fetch entries" });
  }
});

app.post("/entries", async (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : "").trim();
  if (!text) {
    return res.status(400).send({ ok: false, error: "Text is required" });
  }
  if (text.length > 200) {
    return res.status(400).send({ ok: false, error: "Max 200 characters" });
  }
  try {
    await pgClient.query("INSERT INTO entries(text) VALUES($1)", [text]);
    res.send({ ok: true });
  } catch (e) {
    res.status(500).send({ ok: false, error: "Failed to save entry" });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, err => {
  if (err) {
    console.error("Failed to start server", err);
    process.exit(1);
  }
  console.log(`Server listening on :${PORT}`);
});
