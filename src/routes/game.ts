import express, { Request, Response } from "express";
import { randomBytes } from "crypto";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { broadcastToRoom } from "../sse/hub.js";
import { createDeck, shuffle } from "../utils/cards.js";
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

interface GameState {
  room_id: string;
  turn_user_id: number;
}

interface GameCard {
  id: number;
  suit: string;
  rank: string;
  location: string;
  player_id: number | null;
  card_order: number;
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

    const updateResult = await pool.query<GameRoom>(
      "UPDATE game_rooms SET player_2_id = $1, status = 'matched', matched_at = NOW() WHERE id = $2 RETURNING *",
      [userId, roomId.toUpperCase()],
    );

    const updatedRoom = updateResult.rows[0];
    if (!updatedRoom) {
      return res.status(500).json({ message: "Failed to join room" });
    }

    broadcastToRoom(`game:room:${roomId.toUpperCase()}`, {
      event: "game:matched",
      data: {
        roomId: updatedRoom.id,
        player1Id: updatedRoom.created_by,
        player2Id: updatedRoom.player_2_id,
        status: updatedRoom.status,
      },
    });

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

// Get waiting rooms
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

// Get room by ID
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

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`event: subscribed\ndata: ${JSON.stringify({ room: `game:room:${roomIdUpper}` })}\n\n`);

  const timer = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 25000);

  // FIXED: Removed async from close listener and added proper cleanup
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

    const roomIdUpper = roomId.toUpperCase();

    const result = await pool.query<GameRoom>(
      "UPDATE game_rooms SET status = 'cancelled' WHERE id = $1 AND created_by = $2 AND status = 'waiting' RETURNING *",
      [roomIdUpper, userId],
    );

    const room = result.rows[0];

    if (!room) {
      return res.status(400).json({
        message:
          "Room cannot be cancelled. It may not exist, you aren't the host, or it's already matched.",
      });
    }

    broadcastToRoom(`game:room:${roomIdUpper}`, {
      event: "game:room_cancelled",
      data: {
        roomId: room.id,
      },
    });

    broadcastToRoom("game:waiting", {
      event: "game:room_removed",
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

router.post("/rooms/:roomId/start", requireAuth, async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const userId = getUserId(req);

  if (!roomId || typeof roomId !== "string") {
    return res.status(400).json({ message: "Invalid room ID" });
  }

  const roomIdUpper = roomId.toUpperCase();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // FIXED: Explicit type for room query
    const roomRes = await client.query<GameRoom>(
      "SELECT * FROM game_rooms WHERE id = $1 AND created_by = $2",
      [roomIdUpper, userId],
    );
    const room = roomRes.rows[0];

    if (!room || room.status !== "matched") {
      return res.status(400).json({ message: "Need 2 players to start Gin Rummy." });
    }

    await client.query(
      "INSERT INTO game_state (room_id, turn_user_id) VALUES ($1, $2) ON CONFLICT (room_id) DO UPDATE SET turn_user_id = $2",
      [roomIdUpper, room.created_by],
    );

    const deck = shuffle(createDeck());

    const insertQueries = deck.map((card, index) => {
      let location = "deck";
      let ownerId = null;

      if (index < 10) {
        location = "hand";
        ownerId = room.created_by;
      } else if (index < 20) {
        location = "hand";
        ownerId = room.player_2_id;
      } else if (index === 20) {
        location = "discard";
      }

      return client.query(
        `INSERT INTO game_cards (room_id, suit, rank, location, player_id, card_order) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [roomIdUpper, card.suit, card.rank, location, ownerId, index],
      );
    });

    await Promise.all(insertQueries);

    await client.query("UPDATE game_rooms SET status = 'completed' WHERE id = $1", [roomIdUpper]);

    await client.query("COMMIT");

    broadcastToRoom(`game:room:${roomIdUpper}`, {
      event: "game:started",
      data: { roomId: roomIdUpper },
    });

    res.json({ message: "Gin Rummy started: 10 cards dealt to each player." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ message: "Failed to start Gin Rummy." });
  } finally {
    client.release();
  }
});

// DRAW a card from the deck
router.post("/rooms/:roomId/draw", requireAuth, async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const userId = getUserId(req);

  if (!roomId || typeof roomId !== "string") {
    return res.status(400).json({ message: "Invalid room ID" });
  }

  const roomIdUpper = roomId.toUpperCase();

  const stateRes = await pool.query<GameState>(
    "SELECT turn_user_id FROM game_state WHERE room_id = $1",
    [roomIdUpper],
  );
  if (stateRes.rows[0]?.turn_user_id !== userId) {
    return res.status(403).json({ message: "Not your turn!" });
  }

  try {
    const topCard = await pool.query<GameCard>(
      "SELECT id FROM game_cards WHERE room_id = $1 AND location = 'deck' ORDER BY card_order ASC LIMIT 1",
      [roomIdUpper],
    );

    if (topCard.rowCount === 0) return res.status(400).json({ message: "Deck empty" });

    await pool.query("UPDATE game_cards SET location = 'hand', player_id = $1 WHERE id = $2", [
      userId,
      topCard.rows[0].id,
    ]);

    broadcastToRoom(`game:room:${roomIdUpper}`, { event: "game:update", data: { action: "draw" } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Draw failed" });
  }
});

// DISCARD (Play) a card from hand
router.post("/rooms/:roomId/discard", requireAuth, async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const { cardId } = req.body as { cardId: number };
  const userId = getUserId(req);

  if (!roomId || typeof roomId !== "string") {
    return res.status(400).json({ message: "Invalid room ID" });
  }
  const roomIdUpper = roomId.toUpperCase();

  const stateRes = await pool.query<GameState>(
    "SELECT turn_user_id FROM game_state WHERE room_id = $1",
    [roomIdUpper],
  );
  if (stateRes.rows[0]?.turn_user_id !== userId) {
    return res.status(403).json({ message: "Not your turn!" });
  }

  try {
    const result = await pool.query(
      "UPDATE game_cards SET location = 'discard', player_id = NULL WHERE id = $1 AND room_id = $2 AND player_id = $3 RETURNING *",
      [cardId, roomIdUpper, userId],
    );

    if (result.rowCount === 0) return res.status(400).json({ message: "Invalid card" });

    const roomRes = await pool.query<GameRoom>("SELECT * FROM game_rooms WHERE id = $1", [
      roomIdUpper,
    ]);
    const room = roomRes.rows[0];
    const nextTurn = userId === room.created_by ? room.player_2_id : room.created_by;
    await pool.query("UPDATE game_state SET turn_user_id = $1 WHERE room_id = $2", [
      nextTurn,
      roomIdUpper,
    ]);

    broadcastToRoom(`game:room:${roomIdUpper}`, { event: "game:update", data: { action: "play" } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Discard failed" });
  }
});

router.get("/rooms/:roomId/state", requireAuth, async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const userId = getUserId(req);

  if (!roomId || typeof roomId !== "string") {
    return res.status(400).json({ message: "Invalid room ID" });
  }

  const roomIdUpper = roomId.toUpperCase();

  try {
    const cards = await pool.query<GameCard>(
      "SELECT id, suit, rank, location, player_id FROM game_cards WHERE room_id = $1",
      [roomIdUpper],
    );
    const state = await pool.query<GameState>(
      "SELECT turn_user_id FROM game_state WHERE room_id = $1",
      [roomIdUpper],
    );

    res.json({
      cards: cards.rows,
      turn: state.rows[0]?.turn_user_id,
      isMyTurn: state.rows[0]?.turn_user_id === userId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch state" });
  }
});

export default router;
