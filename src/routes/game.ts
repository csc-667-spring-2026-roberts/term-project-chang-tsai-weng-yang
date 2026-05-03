import express, { Request, Response } from "express";
import type { PoolClient } from "pg";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { broadcastToRoom } from "../sse/hub.js";
import { createDeck, shuffle } from "../utils/cards.js";
import {
  getUserId,
  sessionRoom,
  generateRoomId,
  GameRoom,
  GameState,
  GameCard,
  getRoomWithSelfPlay,
  dealCards,
} from "../middleware/game.js";

const router = express.Router();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface JoinRoomResult {
  success: boolean;
  updatedRoom?: GameRoom;
  errorMessage?: string;
}

type GameOutcome = "win" | "loss" | "draw";

interface SubmittedGameResult {
  userId?: number;
  outcome?: GameOutcome;
  score?: number;
  deadwoodScore?: number;
  wentGin?: boolean;
  knocked?: boolean;
  placement?: number;
  opponentIds?: number[];
}

interface SubmitResultsBody {
  results?: SubmittedGameResult[];
}

interface NormalizedGameResult {
  userId: number;
  outcome: GameOutcome;
  score: number;
  deadwoodScore: number;
  wentGin: boolean;
  knocked: boolean;
  placement: number;
  opponentIds: number[];
}

interface GameResultRow {
  id: number;
  room_id: string;
  user_id: number;
  opponent_ids: number[];
  placement: number | null;
  score: number;
  deadwood_score: number;
  went_gin: boolean;
  knocked: boolean;
  outcome: GameOutcome;
  finished_at: string;
}

/**
 * Find available player slot and update room
 */
async function findAndUpdatePlayerSlot(
  room: GameRoom,
  userId: number,
  roomId: string,
): Promise<JoinRoomResult> {
  let updateQuery = "";
  let updateParams: (string | number)[] = [];
  let playerSlot = "";

  if (room.player_2_id === null) {
    playerSlot = "player_2";
    updateQuery =
      "UPDATE game_rooms SET player_2_id = $1, status = 'waiting_to_start', matched_at = NOW() WHERE id = $2 AND (status = 'waiting' OR status = 'waiting_to_start') RETURNING *";
    updateParams = [userId, roomId.toUpperCase()];
    console.log(`[JOIN] Player ${String(userId)} taking slot ${playerSlot} in room ${roomId}`);
  } else if (room.player_3_id === null) {
    playerSlot = "player_3";
    updateQuery =
      "UPDATE game_rooms SET player_3_id = $1, status = 'waiting_to_start' WHERE id = $2 AND (status = 'waiting' OR status = 'waiting_to_start') RETURNING *";
    updateParams = [userId, roomId.toUpperCase()];
    console.log(`[JOIN] Player ${String(userId)} taking slot ${playerSlot} in room ${roomId}`);
  } else if (room.player_4_id === null) {
    playerSlot = "player_4";
    updateQuery =
      "UPDATE game_rooms SET player_4_id = $1, status = 'waiting_to_start' WHERE id = $2 AND (status = 'waiting' OR status = 'waiting_to_start') RETURNING *";
    updateParams = [userId, roomId.toUpperCase()];
    console.log(`[JOIN] Player ${String(userId)} taking slot ${playerSlot} in room ${roomId}`);
  } else {
    console.log(`[JOIN] Room ${roomId} is full`);
    return { success: false, errorMessage: "Room is full (4 players max)" };
  }

  console.log(
    `[JOIN] Executing UPDATE for ${playerSlot}: ${updateQuery.substring(0, 60)}... with params [${String(updateParams)}]`,
  );
  const updateResult = await pool.query<GameRoom>(updateQuery, updateParams);
  const updatedRoom = updateResult.rows[0];

  if (!updatedRoom) {
    const currentRoom = await pool.query<GameRoom>("SELECT * FROM game_rooms WHERE id = $1", [
      roomId.toUpperCase(),
    ]);
    const current = currentRoom.rows[0];
    const status = current?.status ?? "unknown";
    console.log(
      `[JOIN] Current room status in DB: '${status}' | Player slots: P2=${String(current?.player_2_id)}, P3=${String(current?.player_3_id)}, P4=${String(current?.player_4_id)}`,
    );
    return {
      success: false,
      errorMessage: `Failed to join room - status is '${status}' (expected 'waiting' or 'waiting_to_start')`,
    };
  }

  console.log(
    `[JOIN] Successfully updated room. New status: '${updatedRoom.status}' | Players: P2=${String(updatedRoom.player_2_id)}, P3=${String(updatedRoom.player_3_id)}, P4=${String(updatedRoom.player_4_id)}`,
  );

  return { success: true, updatedRoom };
}

function playerIdsForRoom(room: GameRoom): number[] {
  return [room.created_by, room.player_2_id, room.player_3_id, room.player_4_id].filter(
    (id): id is number => id !== null,
  );
}

function isGameOutcome(value: unknown): value is GameOutcome {
  return value === "win" || value === "loss" || value === "draw";
}

function normalizeNonNegativeInteger(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return Number.NaN;
  return value;
}

function isValidOpponentList(
  opponentIds: unknown,
  userId: number,
  playerSet: Set<number>,
): opponentIds is number[] {
  return (
    Array.isArray(opponentIds) &&
    opponentIds.every(
      (id: unknown) =>
        typeof id === "number" && Number.isInteger(id) && playerSet.has(id) && id !== userId,
    )
  );
}

function normalizeSubmittedResult(
  result: unknown,
  playerIds: number[],
  playerSet: Set<number>,
): { validResult?: NormalizedGameResult; errorMessage?: string } {
  if (!result || typeof result !== "object") {
    return { errorMessage: "Each result must be an object" };
  }

  const submitted = result as SubmittedGameResult;

  if (!submitted.userId || !playerSet.has(submitted.userId)) {
    return { errorMessage: "Result user must be a player in the room" };
  }

  if (!isGameOutcome(submitted.outcome)) {
    return { errorMessage: "Result outcome must be win, loss, or draw" };
  }

  const score = normalizeNonNegativeInteger(submitted.score);
  const deadwoodScore = normalizeNonNegativeInteger(submitted.deadwoodScore);
  const placement = normalizeNonNegativeInteger(submitted.placement, 1);
  const opponentIds = submitted.opponentIds ?? playerIds.filter((id) => id !== submitted.userId);

  if (
    Number.isNaN(score) ||
    Number.isNaN(deadwoodScore) ||
    Number.isNaN(placement) ||
    !isValidOpponentList(opponentIds, submitted.userId, playerSet)
  ) {
    return { errorMessage: "Result scores, placement, and opponents must be valid" };
  }

  return {
    validResult: {
      userId: submitted.userId,
      outcome: submitted.outcome,
      score,
      deadwoodScore,
      wentGin: Boolean(submitted.wentGin),
      knocked: Boolean(submitted.knocked),
      placement,
      opponentIds,
    },
  };
}

function validateSubmittedResults(
  results: unknown,
  playerIds: number[],
): { validResults?: NormalizedGameResult[]; errorMessage?: string } {
  if (!Array.isArray(results) || results.length === 0) {
    return { errorMessage: "At least one result is required" };
  }

  const playerSet = new Set(playerIds);
  const seenUsers = new Set<number>();
  const validResults: NormalizedGameResult[] = [];

  for (const result of results) {
    const normalized = normalizeSubmittedResult(result, playerIds, playerSet);

    if (!normalized.validResult) {
      return { errorMessage: normalized.errorMessage };
    }

    if (seenUsers.has(normalized.validResult.userId)) {
      return { errorMessage: "Each player can only have one result per room" };
    }
    seenUsers.add(normalized.validResult.userId);
    validResults.push(normalized.validResult);
  }

  return { validResults };
}

async function saveGameResults(
  client: PoolClient,
  roomId: string,
  results: NormalizedGameResult[],
): Promise<GameResultRow[]> {
  const savedResults: GameResultRow[] = [];

  for (const result of results) {
    const saved = await client.query<GameResultRow>(
      `INSERT INTO game_results (
          room_id,
          user_id,
          opponent_ids,
          placement,
          score,
          deadwood_score,
          went_gin,
          knocked,
          outcome,
          finished_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (room_id, user_id)
        DO UPDATE SET
          opponent_ids = EXCLUDED.opponent_ids,
          placement = EXCLUDED.placement,
          score = EXCLUDED.score,
          deadwood_score = EXCLUDED.deadwood_score,
          went_gin = EXCLUDED.went_gin,
          knocked = EXCLUDED.knocked,
          outcome = EXCLUDED.outcome,
          finished_at = NOW()
        RETURNING *`,
      [
        roomId,
        result.userId,
        result.opponentIds,
        result.placement,
        result.score,
        result.deadwoodScore,
        result.wentGin,
        result.knocked,
        result.outcome,
      ],
    );

    const savedResult = saved.rows[0];
    if (savedResult) {
      savedResults.push(savedResult);
    }
  }

  return savedResults;
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

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

    // Allow joining during 'waiting' or 'waiting_to_start' status
    if (room.status !== "waiting" && room.status !== "waiting_to_start") {
      console.log(`[JOIN] Room ${roomId} status is '${room.status}' - not available for joining`);
      return res.status(400).json({ message: `Room is not available (status: ${room.status})` });
    }

    // Check if user is already in the room
    if (
      room.created_by === userId ||
      room.player_2_id === userId ||
      room.player_3_id === userId ||
      room.player_4_id === userId
    ) {
      return res.status(400).json({ message: "You are already in this room" });
    }

    // Find available slot and update room
    const joinResult = await findAndUpdatePlayerSlot(room, userId, roomId);
    if (!joinResult.success) {
      return res.status(400).json({ message: joinResult.errorMessage });
    }

    const updatedRoom = joinResult.updatedRoom;
    if (!updatedRoom) {
      return res.status(500).json({ message: "Failed to update room" });
    }

    // Get all players info for broadcast
    const playerIds = [
      updatedRoom.created_by,
      updatedRoom.player_2_id,
      updatedRoom.player_3_id,
      updatedRoom.player_4_id,
    ].filter((id): id is number => id !== null);

    broadcastToRoom(`game:room:${roomId.toUpperCase()}`, {
      event: "game:player_joined",
      data: {
        roomId: updatedRoom.id,
        players: playerIds,
        playerCount: playerIds.length,
        status: updatedRoom.status,
      },
    });

    const sessionRoomId = sessionRoom(req);
    if (sessionRoomId) {
      broadcastToRoom(sessionRoomId, {
        event: "game:player_joined",
        data: {
          roomId: updatedRoom.id,
          playerCount: playerIds.length,
        },
      });
    }

    return res.status(200).json({ ...updatedRoom, self_play: false });
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

// Leave an in-progress (or any) game. Either participant can call this.
// Marks the room cancelled and broadcasts game:room_cancelled so the
// other player's client can tear down its game view in real time.
router.post("/rooms/:roomId/leave", requireAuth, async (req: Request, res: Response) => {
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
      `UPDATE game_rooms
         SET status = 'cancelled'
       WHERE id = $1
         AND (created_by = $2 OR player_2_id = $2)
         AND status <> 'cancelled'
       RETURNING *`,
      [roomIdUpper, userId],
    );

    const room = result.rows[0];
    if (!room) {
      return res
        .status(400)
        .json({ message: "Room not found, already cancelled, or you're not in it." });
    }

    broadcastToRoom(`game:room:${roomIdUpper}`, {
      event: "game:room_cancelled",
      data: {
        roomId: room.id,
        leftBy: userId,
      },
    });

    broadcastToRoom("game:waiting", {
      event: "game:room_removed",
      data: { roomId: room.id },
    });

    return res.status(200).json(room);
  } catch (error) {
    console.error("Error leaving room:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/rooms/:roomId/start", requireAuth, async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const userId = getUserId(req);

  if (!roomId || typeof roomId !== "string") {
    return res.status(400).json({ message: "Invalid room ID" });
  }

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const roomIdUpper = roomId.toUpperCase();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verify the user is the room creator (host)
    const roomRes = await client.query<GameRoom>("SELECT * FROM game_rooms WHERE id = $1", [
      roomIdUpper,
    ]);
    const room = roomRes.rows[0];

    if (!room) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Room not found" });
    }

    if (room.created_by !== userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Only the host can start the game" });
    }

    if (room.status !== "waiting_to_start") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Room is not ready to start" });
    }

    // Count players
    const playerIds = [
      room.created_by,
      room.player_2_id,
      room.player_3_id,
      room.player_4_id,
    ].filter((id): id is number => id !== null);

    if (playerIds.length < 2) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Need at least 2 players to start" });
    }

    if (playerIds.length > 4) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Maximum 4 players allowed" });
    }

    // Initialize game state with first player's turn
    await client.query(
      "INSERT INTO game_state (room_id, turn_user_id) VALUES ($1, $2) ON CONFLICT (room_id) DO UPDATE SET turn_user_id = $2",
      [roomIdUpper, room.created_by],
    );

    // Deal cards to all players
    const cardsPerPlayer = await dealCards(client, roomIdUpper, playerIds, createDeck, shuffle);

    // Update room status and started_at
    await client.query(
      "UPDATE game_rooms SET status = 'completed', started_at = NOW() WHERE id = $1",
      [roomIdUpper],
    );

    await client.query("COMMIT");

    broadcastToRoom(`game:room:${roomIdUpper}`, {
      event: "game:started",
      data: {
        roomId: roomIdUpper,
        playerCount: playerIds.length,
        cardsPerPlayer: cardsPerPlayer,
      },
    });

    return res.json({
      message: `Gin Rummy started with ${String(playerIds.length)} players: ${String(cardsPerPlayer)} cards dealt to each player.`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ message: "Failed to start Gin Rummy." });
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

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const roomIdUpper = roomId.toUpperCase();

  const stateRes = await pool.query<GameState>(
    "SELECT turn_user_id FROM game_state WHERE room_id = $1",
    [roomIdUpper],
  );
  const turnUserId = stateRes.rows[0]?.turn_user_id;

  if (!turnUserId || turnUserId !== userId) {
    return res.status(403).json({ message: "Not your turn!" });
  }

  try {
    const topCard = await pool.query<GameCard>(
      "SELECT id FROM game_cards WHERE room_id = $1 AND location = 'deck' ORDER BY card_order ASC LIMIT 1",
      [roomIdUpper],
    );

    const card = topCard.rows[0];
    if (!card) {
      return res.status(400).json({ message: "Deck empty" });
    }

    await pool.query("UPDATE game_cards SET location = 'hand', player_id = $1 WHERE id = $2", [
      userId,
      card.id,
    ]);

    broadcastToRoom(`game:room:${roomIdUpper}`, { event: "game:update", data: { action: "draw" } });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Draw failed" });
  }
});

// DRAW the top card from the discard pile
router.post("/rooms/:roomId/draw-discard", requireAuth, async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const userId = getUserId(req);

  if (!roomId || typeof roomId !== "string") {
    return res.status(400).json({ message: "Invalid room ID" });
  }

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const roomIdUpper = roomId.toUpperCase();

  const stateRes = await pool.query<GameState>(
    "SELECT turn_user_id FROM game_state WHERE room_id = $1",
    [roomIdUpper],
  );
  const turnUserId = stateRes.rows[0]?.turn_user_id;

  if (!turnUserId || turnUserId !== userId) {
    return res.status(403).json({ message: "Not your turn!" });
  }

  try {
    // Top of discard = highest card_order in the discard pile
    const topCard = await pool.query<GameCard>(
      "SELECT id FROM game_cards WHERE room_id = $1 AND location = 'discard' ORDER BY card_order DESC LIMIT 1",
      [roomIdUpper],
    );

    const card = topCard.rows[0];
    if (!card) {
      return res.status(400).json({ message: "Discard pile empty" });
    }

    await pool.query("UPDATE game_cards SET location = 'hand', player_id = $1 WHERE id = $2", [
      userId,
      card.id,
    ]);

    broadcastToRoom(`game:room:${roomIdUpper}`, {
      event: "game:update",
      data: { action: "draw-discard" },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Draw from discard failed" });
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

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const roomIdUpper = roomId.toUpperCase();

  const stateRes = await pool.query<GameState>(
    "SELECT turn_user_id FROM game_state WHERE room_id = $1",
    [roomIdUpper],
  );
  const turnUserId = stateRes.rows[0]?.turn_user_id;

  if (!turnUserId || turnUserId !== userId) {
    return res.status(403).json({ message: "Not your turn!" });
  }

  try {
    // Place the discarded card on TOP of the discard pile by giving it
    // the highest card_order in this room. That way "top of discard"
    // queries (ORDER BY card_order DESC) always return the most recently
    // discarded card — important for the Draw-Discard action.
    const result = await pool.query(
      `UPDATE game_cards
         SET location = 'discard',
             player_id = NULL,
             card_order = COALESCE((SELECT MAX(card_order) + 1 FROM game_cards WHERE room_id = $2), 0)
       WHERE id = $1 AND room_id = $2 AND player_id = $3
       RETURNING *`,
      [cardId, roomIdUpper, userId],
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ message: "Invalid card" });
    }

    // Get room to find all active players
    const roomResult = await pool.query<GameRoom>("SELECT * FROM game_rooms WHERE id = $1", [
      roomIdUpper,
    ]);
    const room = roomResult.rows[0];

    if (!room) {
      return res.status(400).json({ message: "Game room not found" });
    }

    // Get all active players in order
    const activePlayers = [
      room.created_by,
      room.player_2_id,
      room.player_3_id,
      room.player_4_id,
    ].filter((id): id is number => id !== null);

    // Find current player's index and get next player
    const currentPlayerIndex = activePlayers.indexOf(userId);
    const nextPlayerIndex = (currentPlayerIndex + 1) % activePlayers.length;
    const nextTurn = activePlayers[nextPlayerIndex];

    await pool.query("UPDATE game_state SET turn_user_id = $1 WHERE room_id = $2", [
      nextTurn,
      roomIdUpper,
    ]);

    broadcastToRoom(`game:room:${roomIdUpper}`, { event: "game:update", data: { action: "play" } });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Discard failed" });
  }
});

router.post("/rooms/:roomId/results", requireAuth, async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const userId = getUserId(req);

  if (!roomId || typeof roomId !== "string") {
    return res.status(400).json({ message: "Invalid room ID" });
  }

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { results } = req.body as SubmitResultsBody;
  const roomIdUpper = roomId.toUpperCase();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const roomResult = await client.query<GameRoom>("SELECT * FROM game_rooms WHERE id = $1", [
      roomIdUpper,
    ]);
    const room = roomResult.rows[0];

    if (!room) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Room not found" });
    }

    if (room.created_by !== userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Only the host can record game results" });
    }

    const playerIds = playerIdsForRoom(room);
    const validation = validateSubmittedResults(results, playerIds);
    if (!validation.validResults) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: validation.errorMessage });
    }

    const savedResults = await saveGameResults(client, roomIdUpper, validation.validResults);
    await client.query("COMMIT");

    broadcastToRoom(`game:room:${roomIdUpper}`, {
      event: "game:results_recorded",
      data: {
        roomId: roomIdUpper,
        results: savedResults,
      },
    });

    return res.status(200).json({ results: savedResults });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error recording game results:", error);
    return res.status(500).json({ message: "Failed to record game results" });
  } finally {
    client.release();
  }
});

router.get("/rooms/:roomId/state", requireAuth, async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const userId = getUserId(req);

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!roomId || typeof roomId !== "string") {
    return res.status(400).json({ message: "Invalid room ID" });
  }

  const roomIdUpper = roomId.toUpperCase();

  try {
    const [{ room, selfPlay }, cards, state] = await Promise.all([
      getRoomWithSelfPlay(roomIdUpper),
      pool.query<GameCard>(
        "SELECT id, suit, rank, location, player_id, card_order FROM game_cards WHERE room_id = $1",
        [roomIdUpper],
      ),
      pool.query<GameState>("SELECT turn_user_id FROM game_state WHERE room_id = $1", [
        roomIdUpper,
      ]),
    ]);
    const turnUserId = state.rows[0]?.turn_user_id;

    // Get all active players
    const activePlayers = room
      ? [room.created_by, room.player_2_id, room.player_3_id, room.player_4_id].filter(
          (id): id is number => id !== null,
        )
      : [];

    return res.json({
      cards: cards.rows,
      turn: turnUserId,
      isMyTurn: turnUserId === userId || (selfPlay && turnUserId === room?.player_2_id),
      activePlayerId: turnUserId,
      activePlayers: activePlayers,
      playerCount: activePlayers.length,
      selfPlay: selfPlay,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to fetch state" });
  }
});

// Kept for potential future use
// function getCanSelfPlayAct(
//   room: GameRoomWithPlayer2Email | null,
//   selfPlay: boolean,
//   userId: number,
//   turnUserId: number | undefined,
// ): boolean {
//   return (
//     selfPlay &&
//     room?.created_by === userId &&
//     Boolean(room.player_2_id) &&
//     (turnUserId === room.created_by || turnUserId === room.player_2_id)
//   );
// }

export default router;
