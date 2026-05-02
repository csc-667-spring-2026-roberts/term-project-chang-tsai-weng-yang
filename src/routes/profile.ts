import express, { Request, Response } from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { broadcastToRoom } from "../sse/hub.js";

const router = express.Router();

interface UserRow {
  id: number;
  email: string;
  nickname: string | null;
  created_at: string;
}

interface ProfileStatsRow {
  total_games: string;
  hosted_games: string;
  joined_games: string;
  active_games: string;
  completed_games: string;
  ready_games: string;
  waiting_games: string;
  cancelled_games: string;
  last_room_at: string | null;
}

interface RecentRoomRow {
  id: string;
  status: string;
  created_at: string;
  matched_at: string | null;
  started_at: string | null;
  created_by: number;
  player_2_id: number | null;
  player_3_id: number | null;
  player_4_id: number | null;
  host_nickname: string | null;
  host_email: string;
  player_2_nickname: string | null;
  player_2_email: string | null;
  player_3_nickname: string | null;
  player_3_email: string | null;
  player_4_nickname: string | null;
  player_4_email: string | null;
}

function participantFilter(): string {
  return "$1 IN (created_by, player_2_id, player_3_id, player_4_id)";
}

async function getProfileUser(userId: number): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    "SELECT id, email, nickname, created_at FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0] || null;
}

async function getProfileStats(userId: number): Promise<ProfileStatsRow> {
  const result = await pool.query<ProfileStatsRow>(
    `SELECT
        COUNT(*) AS total_games,
        COUNT(*) FILTER (WHERE created_by = $1) AS hosted_games,
        COUNT(*) FILTER (WHERE created_by <> $1) AS joined_games,
        COUNT(*) FILTER (WHERE status = 'completed') AS active_games,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_games,
        COUNT(*) FILTER (WHERE status = 'waiting_to_start') AS ready_games,
        COUNT(*) FILTER (WHERE status IN ('waiting', 'waiting_to_start')) AS waiting_games,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_games,
        MAX(created_at) AS last_room_at
     FROM game_rooms
     WHERE ${participantFilter()}`,
    [userId],
  );

  return (
    result.rows[0] || {
      total_games: "0",
      hosted_games: "0",
      joined_games: "0",
      active_games: "0",
      completed_games: "0",
      ready_games: "0",
      waiting_games: "0",
      cancelled_games: "0",
      last_room_at: null,
    }
  );
}

async function getRoomRows(
  userId: number,
  limit: number,
  activeOnly: boolean,
): Promise<RecentRoomRow[]> {
  const activeFilter = activeOnly
    ? "AND gr.status IN ('waiting', 'waiting_to_start', 'completed')"
    : "";
  const result = await pool.query<RecentRoomRow>(
    `SELECT
        gr.id,
        gr.status,
        gr.created_at,
        gr.matched_at,
        gr.started_at,
        gr.created_by,
        gr.player_2_id,
        gr.player_3_id,
        gr.player_4_id,
        host.nickname AS host_nickname,
        host.email AS host_email,
        p2.nickname AS player_2_nickname,
        p2.email AS player_2_email,
        p3.nickname AS player_3_nickname,
        p3.email AS player_3_email,
        p4.nickname AS player_4_nickname,
        p4.email AS player_4_email
     FROM game_rooms gr
     JOIN users host ON host.id = gr.created_by
     LEFT JOIN users p2 ON p2.id = gr.player_2_id
     LEFT JOIN users p3 ON p3.id = gr.player_3_id
     LEFT JOIN users p4 ON p4.id = gr.player_4_id
     WHERE $1 IN (gr.created_by, gr.player_2_id, gr.player_3_id, gr.player_4_id)
       ${activeFilter}
     ORDER BY gr.created_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  return result.rows;
}

async function getRecentRooms(userId: number): Promise<RecentRoomRow[]> {
  return getRoomRows(userId, 8, false);
}

async function getActiveRooms(userId: number): Promise<RecentRoomRow[]> {
  return getRoomRows(userId, 4, true);
}

function formatStats(stats: ProfileStatsRow): Record<string, number | string | null> {
  return {
    totalGames: Number(stats.total_games),
    hostedGames: Number(stats.hosted_games),
    joinedGames: Number(stats.joined_games),
    activeGames: Number(stats.active_games),
    completedGames: Number(stats.completed_games),
    readyGames: Number(stats.ready_games),
    waitingGames: Number(stats.waiting_games),
    cancelledGames: Number(stats.cancelled_games),
    lastRoomAt: stats.last_room_at,
  };
}

function formatRecentRoom(room: RecentRoomRow, userId: number): Record<string, unknown> {
  const players = [
    {
      id: room.created_by,
      label: room.host_nickname || room.host_email,
    },
    room.player_2_id
      ? {
          id: room.player_2_id,
          label: room.player_2_nickname || room.player_2_email || "Player 2",
        }
      : null,
    room.player_3_id
      ? {
          id: room.player_3_id,
          label: room.player_3_nickname || room.player_3_email || "Player 3",
        }
      : null,
    room.player_4_id
      ? {
          id: room.player_4_id,
          label: room.player_4_nickname || room.player_4_email || "Player 4",
        }
      : null,
  ].filter(Boolean);

  return {
    id: room.id,
    status: room.status,
    createdAt: room.created_at,
    matchedAt: room.matched_at,
    startedAt: room.started_at,
    role: room.created_by === userId ? "Host" : "Player",
    playerCount: players.length,
    capacity: 4,
    players,
  };
}

// Get user profile
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await getProfileUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching profile:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await getProfileUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const [stats, recentRooms, activeRooms] = await Promise.all([
      getProfileStats(userId),
      getRecentRooms(userId),
      getActiveRooms(userId),
    ]);

    return res.status(200).json({
      user,
      stats: formatStats(stats),
      activeRooms: activeRooms.map((room) => formatRecentRoom(room, userId)),
      recentRooms: recentRooms.map((room) => formatRecentRoom(room, userId)),
    });
  } catch (error) {
    console.error("Error fetching profile summary:", error);
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
      "UPDATE users SET nickname = $1 WHERE id = $2 RETURNING id, email, nickname, created_at",
      [nickname, userId],
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(500).json({ message: "Failed to update nickname" });
    }

    // Broadcast profile update to session
    const sessionRoom = req.sessionID ? `session:${req.sessionID}` : null;
    if (sessionRoom) {
      broadcastToRoom(sessionRoom, {
        event: "profile:updated",
        data: {
          nickname: user.nickname,
        },
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
      "SELECT id, email, nickname, created_at FROM users WHERE id = $1",
      [parseInt(userId)],
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
