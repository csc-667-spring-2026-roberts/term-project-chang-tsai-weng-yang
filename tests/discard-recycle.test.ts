import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { recycleDiscardIntoDeck } from "../src/routes/game.js";
import type { GameCard } from "../src/middleware/game.js";

function discardCard(id: number, cardOrder: number): GameCard {
  return {
    id,
    suit: "S",
    rank: String(id),
    location: "discard",
    player_id: null,
    card_order: cardOrder,
  };
}

function fakeRecycleClient(discardRows: GameCard[]) {
  const updates: Array<{ cardOrder: number; cardId: number; roomId: string }> = [];
  const client = {
    async query(sql: string, params: unknown[]) {
      if (sql.includes("SELECT id, suit, rank, location, player_id, card_order")) {
        return {
          rows: [...discardRows].sort((a, b) => b.card_order - a.card_order),
        };
      }

      if (sql.includes("UPDATE game_cards")) {
        updates.push({
          cardOrder: params[0] as number,
          cardId: params[1] as number,
          roomId: params[2] as string,
        });
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as PoolClient;

  return { client, updates };
}

test("recycles discard pile below the top card into the deck", async () => {
  const { client, updates } = fakeRecycleClient([
    discardCard(1, 10),
    discardCard(2, 20),
    discardCard(3, 30),
    discardCard(4, 40),
  ]);

  const recycledCount = await recycleDiscardIntoDeck(client, "ROOM42");

  assert.equal(recycledCount, 3);
  assert.equal(updates.length, 3);
  assert.deepEqual(
    updates.map((update) => update.cardId).sort((a, b) => a - b),
    [1, 2, 3],
  );
  assert.equal(
    updates.some((update) => update.cardId === 4),
    false,
    "top discard card should stay on the discard pile",
  );
  assert.deepEqual(
    updates.map((update) => update.cardOrder).sort((a, b) => a - b),
    [0, 1, 2],
  );
  assert.equal(
    updates.every((update) => update.roomId === "ROOM42"),
    true,
  );
});

test("does not recycle when only the top discard card remains", async () => {
  const { client, updates } = fakeRecycleClient([discardCard(1, 10)]);

  const recycledCount = await recycleDiscardIntoDeck(client, "ROOM42");

  assert.equal(recycledCount, 0);
  assert.equal(updates.length, 0);
});
