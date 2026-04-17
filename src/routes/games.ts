import { Router, Request, Response } from "express";
import pool from "../db.js";
import { shuffleDeck } from "../utils/gameLogic.js";

const router = Router();

// Define interfaces to avoid 'any' and satisfy ESLint
interface CardRow {
  id: number;
}

interface PlayerRow {
  user_id: number;
}

/**
 * POST /games/:gameId/start
 * Initializes a game by shuffling and dealing cards.
 */
router.post("/:gameId/start", async (req: Request, res: Response) => {
  const { gameId } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Fetch all 52 card IDs from the lookup table
    const cardsResult = await client.query<CardRow>("SELECT id FROM cards");
    const shuffledCardIds = shuffleDeck(cardsResult.rows.map((c) => c.id));

    // 2. Fetch players assigned to this game instance
    const playersResult = await client.query<PlayerRow>(
      "SELECT user_id FROM game_users WHERE game_id = $1 ORDER BY seat_number",
      [gameId],
    );

    const players = playersResult.rows;
    const player0 = players[0];
    const player1 = players[1];

    // ESLint Proofing: Type guarding to prove player0 and player1 exist
    if (!player0 || !player1) {
      throw new Error("Need exactly 2 players to start a Gin Rummy match.");
    }

    // 3. Distribute cards and insert into the junction table
    // Gin Rummy: 10 cards each, 1 discard, rest in deck.
    for (let i = 0; i < shuffledCardIds.length; i++) {
      let location = "DECK";
      let userId: number | null = null;
      const currentCardId = shuffledCardIds[i];

      // Verification check for the shuffle result
      if (currentCardId === undefined) continue;

      if (i < 10) {
        location = "PLAYER_0_HAND";
        userId = player0.user_id;
      } else if (i < 20) {
        location = "PLAYER_1_HAND";
        userId = player1.user_id;
      } else if (i === 20) {
        location = "DISCARD";
      }

      await client.query(
        `INSERT INTO game_cards (game_id, card_id, location, user_id, card_order) 
         VALUES ($1, $2, $3, $4, $5)`,
        [gameId, currentCardId, location, userId, i],
      );
    }

    // 4. Set the game to IN_PROGRESS and assign the first turn
    await client.query("UPDATE games SET status = $1, turn_player_id = $2 WHERE id = $3", [
      "IN_PROGRESS",
      player0.user_id,
      gameId,
    ]);

    await client.query("COMMIT");
    res.status(200).json({ message: "Game successfully initialized and dealt." });
  } catch (err: unknown) {
    await client.query("ROLLBACK");

    // Safety check for error message to satisfy ESLint
    const errorMessage = err instanceof Error ? err.message : "An unknown database error occurred";
    console.error("Game Start Error:", errorMessage);
    res.status(500).json({ error: errorMessage });
  } finally {
    // Crucial: Release the client back to the pool
    client.release();
  }
});

export default router;
