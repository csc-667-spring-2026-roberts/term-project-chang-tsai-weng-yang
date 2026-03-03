import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import indexRouter from "./routes/index.js";
import logging from "./middleware/logging.js";
import dotenv from "dotenv";
import db from "./db/connection.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/", logging);
app.use(express.static(path.join(__dirname, "..", "public")));

// POST: Write a message to the database
app.post("/db-test", async (req, res) => {
  try {
    const testMessage = "Gin Rummy Connection Success!";
    await db.none("INSERT INTO milestone5_test(message) VALUES($1)", [testMessage]);
    res.json({ message: "Saved to gin_db!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Route: Reads from the database
app.get("/db-test", async (req, res) => {
  try {
    const data = await db.any("SELECT * FROM milestone5_test ORDER BY id DESC");
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.use("/", indexRouter);

app.listen(PORT, () => {
  console.log(
    `Server running on http://localhost:${String(PORT)} at ${new Date().toLocaleTimeString()}`,
  );
});
