import express, { Request, Response } from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { broadcastToRoom } from "../sse/hub.js";

const router = express.Router();

interface UserRow {
  id: number;
  email: string;
  nickname: string | null;
}

// Get current user's profile
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await pool.query<UserRow>(
      "SELECT id, email, nickname FROM users WHERE id = $1",
      [userId],
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching profile:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Update nickname
router.post("/update-nickname", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { nickname } = req.body as { nickname?: string };

    if (!nickname || typeof nickname !== "string") {
      return res.status(400).json({ message: "Nickname is required" });
    }

    if (nickname.length < 1 || nickname.length > 100) {
      return res.status(400).json({ message: "Nickname must be between 1 and 100 characters" });
    }

    const result = await pool.query<UserRow>(
      "UPDATE users SET nickname = $1 WHERE id = $2 RETURNING id, email, nickname",
      [nickname, userId],
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(500).json({ message: "Failed to update nickname" });
    }

    const sessionRoom = req.sessionID ? `session:${req.sessionID}` : null;
    if (sessionRoom) {
      broadcastToRoom(sessionRoom, {
        event: "profile:updated",
        data: { nickname: user.nickname },
      });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error("Error updating nickname:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Get user nickname by ID (for displaying opponent nicknames)
router.get("/user/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const result = await pool.query<UserRow>(
      "SELECT id, email, nickname FROM users WHERE id = $1",
      [parseInt(userId, 10)],
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      id: user.id,
      nickname: user.nickname || `Player ${String(user.id)}`,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
