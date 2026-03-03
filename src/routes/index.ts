import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";

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

router.get("/:id", (req, res) => {
  const { id } = req.params;
  res.send(id);
});

export default router;
