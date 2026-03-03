import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import indexRouter from "./routes/index.js";
import db from "./db/connection.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/", indexRouter);

// POST: Create a test record
app.post("/db-test", async (req, res) => {
  try {
    await db.none("INSERT INTO milestone5_test(message) VALUES($1)", [
      "Gin Rummy Connection Success!",
    ]);
    res.json({ message: "Saved to gin_db!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Retrieve test records
app.get("/db-test", async (req, res) => {
  try {
    const data = await db.any("SELECT * FROM milestone5_test");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${String(PORT)}`);
});
