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

// POST: Write a message and get the new ID back immediately
router.post("/db-test", async (req, res) => {
  try {
    const testMessage = "Gin Rummy Connection Success!";

    // Using db.one because RETURNING id ensures exactly one row is returned and we want to capture that new ID and timestamp
    const result = await db.one(
      "INSERT INTO milestone5_test(message) VALUES($1) RETURNING id, created_at",
      [testMessage],
    );

    res.json({
      success: true,
      message: "Saved to gin_db!",
      newRecordId: result.id,
      timestamp: result.created_at,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
