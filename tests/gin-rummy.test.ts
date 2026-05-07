import assert from "node:assert/strict";
import test from "node:test";
import {
  canDeclareGin,
  canDeclareKnock,
  evaluateHand,
  scoreFinishedRound,
} from "../src/utils/gin-rummy.js";
import type { GameCard } from "../src/middleware/game.js";

let nextId = 1;

function card(rank: string, suit: string, playerId = 1): GameCard {
  return {
    id: nextId++,
    rank,
    suit,
    location: "hand",
    player_id: playerId,
    card_order: nextId,
  };
}

test("deadwood ignores valid runs and sets", () => {
  nextId = 1;
  const hand = [
    card("4", "S"),
    card("5", "S"),
    card("6", "S"),
    card("9", "H"),
    card("9", "D"),
    card("9", "C"),
    card("K", "D"),
    card("2", "C"),
  ];

  const evaluation = evaluateHand(hand);

  assert.equal(evaluation.deadwood, 12);
  assert.equal(evaluation.melds.length, 2);
  assert.deepEqual(evaluation.deadwoodCards.map((deadwoodCard) => deadwoodCard.rank).sort(), [
    "2",
    "K",
  ]);
});

test("gin requires zero deadwood and knock allows one to ten deadwood", () => {
  nextId = 1;
  const ginHand = [
    card("A", "H"),
    card("2", "H"),
    card("3", "H"),
    card("7", "S"),
    card("7", "D"),
    card("7", "C"),
  ];
  const knockHand = [...ginHand, card("8", "C")];

  assert.equal(canDeclareGin(ginHand), true);
  assert.equal(canDeclareKnock(ginHand), false);
  assert.equal(canDeclareGin(knockHand), false);
  assert.equal(canDeclareKnock(knockHand), true);
});

test("finished round winner is the player with lowest deadwood", () => {
  nextId = 1;
  const hands = new Map<number, GameCard[]>([
    [1, [card("4", "S", 1), card("5", "S", 1), card("6", "S", 1), card("K", "D", 1)]],
    [2, [card("9", "H", 2), card("9", "D", 2), card("9", "C", 2), card("2", "C", 2)]],
    [3, [card("A", "C", 3), card("2", "C", 3), card("3", "C", 3), card("5", "D", 3)]],
  ]);

  const results = scoreFinishedRound(hands, 1, "knock");

  assert.equal(results[0]?.userId, 2);
  assert.equal(results[0]?.outcome, "win");
  assert.equal(results[0]?.deadwood, 2);
});
