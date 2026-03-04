import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";

import db from "../db/connection.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "page", "index.html"));
});

router.get("/about", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "page", "about.html"));
});

router.get("/rules", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "page", "rules.html"));
});

// POST: Write a message to the database
router.post("/db-test", async (req, res) => {
  try {
    const testMessage = "Gin Rummy Connection Success!";
    await db.none("INSERT INTO milestone5_test(message) VALUES($1)", [testMessage]);
    res.json({ message: "Saved to gin_db!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Route: Reads from the database
router.get("/db-test", async (req, res) => {
  try {
    const data = await db.any("SELECT * FROM milestone5_test ORDER BY id DESC");
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", (req, res) => {
  const { id } = req.params;
  res.send(id);
});

export default router;
