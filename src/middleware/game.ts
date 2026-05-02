import { Request } from "express";
import { randomBytes } from "crypto";
import pool from "../db.js";
import type { Card } from "../utils/cards.js";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface GameRoom {
  id: string;
  created_by: number;
  player_2_id: number | null;
  player_3_id: number | null;
  player_4_id: number | null;
  status: string;
  created_at: string;
  matched_at: string | null;
  started_at: string | null;
}

export interface GameState {
  room_id: string;
  turn_user_id: number;
}

export interface GameCard {
  id: number;
  suit: string;
  rank: string;
  location: string;
  player_id: number | null;
  card_order: number;
}

export interface GameRoomWithPlayer2Email extends GameRoom {
  player_2_email: string | null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract user ID from session
 */
export function getUserId(req: Request): number | null {
  return req.session.userId || null;
}

/**
 * Extract session room identifier for real-time updates
 */
export function sessionRoom(req: Request): string | null {
  return req.sessionID ? `session:${req.sessionID}` : null;
}

/**
 * Generate a random 6-character room ID
 */
export function generateRoomId(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

/**
 * Get email for self-play user (internal use)
 */
export function selfPlayEmailFor(userId: number): string {
  return `self-play-${String(userId)}@local.invalid`;
}

/**
 * Fetch room with player 2's email (for self-play detection)
 */
export async function getRoomWithSelfPlay(roomId: string): Promise<{
  room: GameRoomWithPlayer2Email | null;
  selfPlay: boolean;
}> {
  const result = await pool.query<GameRoomWithPlayer2Email>(
    `SELECT game_rooms.*, users.email AS player_2_email
       FROM game_rooms
       LEFT JOIN users ON users.id = game_rooms.player_2_id
      WHERE game_rooms.id = $1`,
    [roomId],
  );
  const room = result.rows[0] || null;

  return {
    room,
    selfPlay: Boolean(
      room?.player_2_id && room.player_2_email === selfPlayEmailFor(room.created_by),
    ),
  };
}

/**
 * Get the user ID to use for current action in a room
 */
export function getActingUserId(
  room: GameRoomWithPlayer2Email | null,
  selfPlay: boolean,
  sessionUserId: number,
  turnUserId: number | undefined,
): number {
  if (selfPlay && room?.created_by === sessionUserId && turnUserId === room.player_2_id) {
    return turnUserId;
  }

  return sessionUserId;
}

// ============================================================================
// GAME LOGIC
// ============================================================================

/**
 * Deal cards to players based on player count
 * @param client Database client (must be within transaction)
 * @param roomId Room ID
 * @param playerIds Array of player IDs in order
 * @param createDeck Function to create standard 52-card deck
 * @param shuffle Function to shuffle deck
 */
export async function dealCards(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  roomId: string,
  playerIds: number[],
  createDeck: () => Card[],
  shuffle: (arr: Card[]) => Card[],
): Promise<number> {
  // Determine cards per player based on player count
  const cardsPerPlayer = playerIds.length === 2 ? 10 : 7;
  const deck = shuffle(createDeck());

  // Deal cards to each player
  let cardIndex = 0;
  for (let playerIdx = 0; playerIdx < playerIds.length; playerIdx++) {
    for (let i = 0; i < cardsPerPlayer; i++) {
      if (cardIndex < deck.length) {
        const card = deck[cardIndex];
        if (card) {
          await client.query(
            `INSERT INTO game_cards (room_id, suit, rank, location, player_id, card_order) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [roomId, card.suit, card.rank, "hand", playerIds[playerIdx], cardIndex],
          );
        }
        cardIndex++;
      }
    }
  }

  // Place the next card as the initial discard card
  if (cardIndex < deck.length) {
    const card = deck[cardIndex];
    if (card) {
      await client.query(
        `INSERT INTO game_cards (room_id, suit, rank, location, player_id, card_order) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [roomId, card.suit, card.rank, "discard", null, cardIndex],
      );
    }
    cardIndex++;
  }

  // Place remaining cards in deck
  while (cardIndex < deck.length) {
    const card = deck[cardIndex];
    if (card) {
      await client.query(
        `INSERT INTO game_cards (room_id, suit, rank, location, player_id, card_order) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [roomId, card.suit, card.rank, "deck", null, cardIndex],
      );
    }
    cardIndex++;
  }

  return cardsPerPlayer;
}
