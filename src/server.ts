import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import indexRouter from "./routes/index.js";
import logging from "./middleware/logging.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/", logging);
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/", indexRouter);

app.listen(PORT, () => {
  console.log(
    `Server running on http://localhost:${String(PORT)} at ${new Date().toLocaleTimeString()}`,
  );
});
