import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "index.html"));
});

router.get("/about", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "about.html"));
});

router.get("/rules", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "rules.html"));
});

export default router;
