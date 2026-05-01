import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import connectLivereload from "connect-livereload";
import { fileURLToPath } from "url";

import indexRouter from "./routes/index.js";
import authRouter from "./routes/auth.js";
import sseRouter from "./routes/sse.js";
import gameRouter from "./routes/game.js";
import profileRouter from "./routes/profile.js";
import logging from "./middleware/logging.js";
import { requireAuth } from "./middleware/auth.js";
import { initializeDatabase } from "./db.js";
import pool from "./db.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render (and most PaaS) terminate TLS at a reverse proxy and forward
// plain HTTP to the container. Without this, Express thinks every
// request came over HTTP, and refuses to set a `secure: true` session
// cookie -- which is why login appeared to "work" but the session never
// stuck on the deployed site.
if (isProd) {
  app.set("trust proxy", 1);
}

const PgSession = connectPgSimple(session);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (!isProd) {
  app.use(connectLivereload());
}

app.use("/", logging);

app.use(
  session({
    store: new PgSession({
      pool: pool,
      createTableIfMissing: false,
    }),
    secret: process.env.SESSION_SECRET || "fallback_secret",
    resave: false,
    saveUninitialized: false,
    // Tell express-session to honor the X-Forwarded-Proto header that
    // Express now trusts. Required alongside `secure: true` on Render.
    proxy: isProd,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 1000 * 60 * 60,
    },
  }),
);

app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/", indexRouter);
app.use("/auth", authRouter);
app.use("/api", sseRouter);
app.use("/api/game", gameRouter);
app.use("/api/profile", profileRouter);

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

const isDirectRun = process.argv[1] === __filename;
if (isDirectRun) {
  void startServer();
}

export { app, startServer };
