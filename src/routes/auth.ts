import express, { Request, Response } from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";

const router = express.Router();
const SALT_ROUNDS = 10;

interface AuthBody {
  email: string;
  password: string;
}

interface ExistingUserRow {
  id: number;
}

interface RegisteredUserRow {
  id: number;
  email: string;
  created_at: string;
}

interface LoginUserRow {
  id: number;
  email: string;
  password_hash: string;
}

router.post("/register", async (req: Request<object, object, AuthBody>, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existingUser = await pool.query<ExistingUserRow>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query<RegisteredUserRow>(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at",
      [email, hashedPassword],
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(500).json({ message: "Server error" });
    }

    req.session.userId = user.id;
    req.session.userEmail = user.email;

    return res.status(201).json({
      message: "Registration successful",
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req: Request<object, object, AuthBody>, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const result = await pool.query<LoginUserRow>(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    req.session.userId = user.id;
    req.session.userEmail = user.email;

    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/logout", (req: Request, res: Response): void => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      res.status(500).json({ message: "Logout failed" });
      return;
    }

    res.clearCookie("connect.sid");
    res.status(200).json({ message: "Logout successful" });
  });
});

router.get("/session", (req: Request, res: Response) => {
  if (!req.session.userId || !req.session.userEmail) {
    return res.status(200).json({ authenticated: false });
  }

  return res.status(200).json({
    authenticated: true,
    user: {
      id: req.session.userId,
      email: req.session.userEmail,
    },
  });
});

export default router;
