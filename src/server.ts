import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { fileURLToPath } from "url";

import indexRouter from "./routes/index.js";
import authRouter from "./routes/auth.js";
import logging from "./middleware/logging.js";
import { requireAuth } from "./middleware/auth.js";
import pool, { initializeDatabase } from "./db.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PgSession = connectPgSimple(session);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/", logging);

app.use(
  session({
    store: new PgSession({
      pool: pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "fallback_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60,
    },
  }),
);

app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/", indexRouter);
app.use("/auth", authRouter);

app.get("/protected", requireAuth, (req: Request, res: Response) => {
  res.status(200).json({
    message: "You are authorized",
    userId: req.session.userId,
    email: req.session.userEmail,
  });
});

async function startServer(): Promise<void> {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(
        `Server running on http://localhost:${String(PORT)} at ${new Date().toLocaleTimeString()}`,
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

void startServer();
