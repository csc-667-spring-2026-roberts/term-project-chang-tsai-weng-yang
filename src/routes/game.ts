import express, { Request, Response } from "express";
import { randomBytes } from "crypto";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { broadcastToRoom } from "../sse/hub.js";

const router = express.Router();

// Helper to get user ID from session
function getUserId(req: Request): number | null {
  return req.session.userId || null;
}

// Helper to get session room for real-time updates
function sessionRoom(req: Request): string | null {
  return req.sessionID ? `session:${req.sessionID}` : null;
}

// Helper to generate a 6-character room ID
function generateRoomId(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

interface GameRoom {
  id: string;
  created_by: number;
  player_2_id: number | null;
  status: string;
  created_at: string;
  matched_at: string | null;
}

// Create a new game room
router.post("/rooms/create", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const roomId = generateRoomId();

    const result = await pool.query<GameRoom>(
      "INSERT INTO game_rooms (id, created_by, status) VALUES ($1, $2, 'waiting') RETURNING *",
      [roomId, userId],
    );

    const room = result.rows[0];
    if (!room) {
      return res.status(500).json({ message: "Failed to create room" });
    }

    // Broadcast to session that a room was created
    const sessionRoomId = sessionRoom(req);
    if (sessionRoomId) {
      broadcastToRoom(sessionRoomId, {
        event: "game:room_created",
        data: {
          roomId: room.id,
          status: room.status,
        },
      });
    }

    // Broadcast to waiting room queue
    broadcastToRoom("game:waiting", {
      event: "game:room_available",
      data: {
        roomId: room.id,
      },
    });

    return res.status(201).json(room);
  } catch (error) {
    console.error("Error creating room:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Join an existing game room
router.post("/rooms/join", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { roomId } = req.body as { roomId?: string };

    if (!roomId || typeof roomId !== "string") {
      return res.status(400).json({ message: "Room ID is required" });
    }

    // Fetch the room
    const roomResult = await pool.query<GameRoom>("SELECT * FROM game_rooms WHERE id = $1", [
      roomId.toUpperCase(),
    ]);

    const room = roomResult.rows[0];
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    if (room.status !== "waiting") {
      return res.status(400).json({ message: "Room is not available" });
    }

    if (room.created_by === userId) {
      return res.status(400).json({ message: "Cannot join your own room" });
    }

    // Update the room to add the second player
    const updateResult = await pool.query<GameRoom>(
      "UPDATE game_rooms SET player_2_id = $1, status = 'matched', matched_at = NOW() WHERE id = $2 RETURNING *",
      [userId, roomId.toUpperCase()],
    );

    const updatedRoom = updateResult.rows[0];
    if (!updatedRoom) {
      return res.status(500).json({ message: "Failed to join room" });
    }

    // Broadcast match event to both players
    broadcastToRoom(`game:room:${roomId.toUpperCase()}`, {
      event: "game:matched",
      data: {
        roomId: updatedRoom.id,
        player1Id: updatedRoom.created_by,
        player2Id: updatedRoom.player_2_id,
        status: updatedRoom.status,
      },
    });

    // Also broadcast to the session rooms of both players
    const sessionRoomId = sessionRoom(req);
    if (sessionRoomId) {
      broadcastToRoom(sessionRoomId, {
        event: "game:matched",
        data: {
          roomId: updatedRoom.id,
          opponent: room.created_by,
        },
      });
    }

    return res.status(200).json(updatedRoom);
  } catch (error) {
    console.error("Error joining room:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Get waiting rooms (for players waiting for matches)
router.get("/rooms/waiting", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await pool.query<GameRoom>(
      "SELECT id, created_by, created_at FROM game_rooms WHERE status = 'waiting' AND created_by != $1 LIMIT 10",
      [userId],
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching waiting rooms:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Get room by ID (for checking room status)
router.get("/rooms/:roomId", requireAuth, async (req: Request, res: Response) => {
  try {
    const roomId = req.params.roomId;
    if (!roomId || typeof roomId !== "string") {
      return res.status(400).json({ message: "Invalid room ID" });
    }

    const result = await pool.query<GameRoom>("SELECT * FROM game_rooms WHERE id = $1", [
      roomId.toUpperCase(),
    ]);

    const room = result.rows[0];
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    return res.status(200).json(room);
  } catch (error) {
    console.error("Error fetching room:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Subscribe to room updates (SSE endpoint)
router.get("/rooms/:roomId/subscribe", requireAuth, (req: Request, res: Response): void => {
  const roomId = req.params.roomId;
  if (!roomId || typeof roomId !== "string") {
    res.status(400).json({ message: "Invalid room ID" });
    return;
  }

  const roomIdUpper = roomId.toUpperCase();

  // This would be handled by the SSE middleware by passing the room as a query param
  // The client will subscribe to the specific room via ?room=game:room:ROOMID
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`event: subscribed\ndata: ${JSON.stringify({ room: `game:room:${roomIdUpper}` })}\n\n`);

  // Keep connection open
  const timer = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(timer);
    res.end();
  });
});

// Cancel a room
router.post("/rooms/:roomId/cancel", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const roomId = req.params.roomId;
    if (!roomId || typeof roomId !== "string") {
      return res.status(400).json({ message: "Invalid room ID" });
    }

    const result = await pool.query<GameRoom>(
      "UPDATE game_rooms SET status = 'cancelled' WHERE id = $1 AND created_by = $2 RETURNING *",
      [roomId.toUpperCase(), userId],
    );

    const room = result.rows[0];
    if (!room) {
      return res.status(404).json({ message: "Room not found or you don't have permission" });
    }

    // Broadcast cancellation
    broadcastToRoom(`game:room:${roomId.toUpperCase()}`, {
      event: "game:room_cancelled",
      data: {
        roomId: room.id,
      },
    });

    return res.status(200).json(room);
  } catch (error) {
    console.error("Error cancelling room:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
