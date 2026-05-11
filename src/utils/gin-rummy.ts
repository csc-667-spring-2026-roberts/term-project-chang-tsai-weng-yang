import type { GameCard } from "../middleware/game.js";

export type FinishDeclaration = "gin" | "knock";
export type FinishOutcome = "win" | "loss" | "draw";

export interface MeldCard {
  id: number;
  suit: string;
  rank: string;
}

export interface Meld {
  type: "run" | "set";
  cards: MeldCard[];
}

export interface HandEvaluation {
  deadwood: number;
  melds: Meld[];
  deadwoodCards: MeldCard[];
}

export interface PlayerFinishResult {
  userId: number;
  deadwood: number;
  outcome: FinishOutcome;
  placement: number;
  score: number;
  wentGin: boolean;
  knocked: boolean;
  melds: Meld[];
  deadwoodCards: MeldCard[];
}

const RANK_VALUE: Record<string, number> = {
  A: 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
};

const DEADWOOD_VALUE: Record<string, number> = {
  A: 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 10,
  Q: 10,
  K: 10,
};

function toMeldCard(card: GameCard | MeldCard): MeldCard {
  return {
    id: card.id,
    suit: card.suit,
    rank: card.rank,
  };
}

function rankOrder(card: MeldCard): number {
  return RANK_VALUE[card.rank] ?? 0;
}

function cardValue(card: MeldCard): number {
  return DEADWOOD_VALUE[card.rank] ?? 0;
}

function sameCard(a: MeldCard, b: MeldCard): boolean {
  return a.id === b.id;
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];

  const [first, ...rest] = items;
  const withFirst = combinations(rest, size - 1).map((combo) =>
    first === undefined ? combo : [first, ...combo],
  );
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

function enumerateMelds(cards: MeldCard[]): Meld[] {
  const melds: Meld[] = [];
  const byRank = new Map<string, MeldCard[]>();
  const bySuit = new Map<string, MeldCard[]>();

  for (const card of cards) {
    byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
    bySuit.set(card.suit, [...(bySuit.get(card.suit) ?? []), card]);
  }

  for (const rankCards of byRank.values()) {
    if (rankCards.length < 3) continue;
    for (const size of [3, 4]) {
      for (const combo of combinations(rankCards, size)) {
        if (combo.length === size) {
          melds.push({ type: "set", cards: combo });
        }
      }
    }
  }

  for (const suitCards of bySuit.values()) {
    const sorted = [...suitCards].sort((a, b) => rankOrder(a) - rankOrder(b));
    for (let start = 0; start < sorted.length; start++) {
      for (let end = start + 2; end < sorted.length; end++) {
        const run = sorted.slice(start, end + 1);
        const isConsecutive = run.every((card, index) => {
          if (index === 0) return true;
          const previous = run[index - 1];
          return previous !== undefined && rankOrder(card) === rankOrder(previous) + 1;
        });
        if (isConsecutive) {
          melds.push({ type: "run", cards: run });
        }
      }
    }
  }

  return melds;
}

function maskForMeld(meld: Meld, cardIndex: Map<number, number>): number {
  return meld.cards.reduce((mask, card) => {
    const index = cardIndex.get(card.id);
    return index === undefined ? mask : mask | (1 << index);
  }, 0);
}

export function evaluateHand(inputCards: Array<GameCard | MeldCard>): HandEvaluation {
  const cards = inputCards.map(toMeldCard);
  const totalValue = cards.reduce((sum, card) => sum + cardValue(card), 0);
  const cardIndex = new Map(cards.map((card, index) => [card.id, index]));
  const melds = enumerateMelds(cards);
  const meldMasks = melds.map((meld) => ({
    meld,
    mask: maskForMeld(meld, cardIndex),
    value: meld.cards.reduce((sum, card) => sum + cardValue(card), 0),
  }));

  const bestByMask = new Map<number, { value: number; melds: Meld[] }>();
  bestByMask.set(0, { value: 0, melds: [] });

  for (const candidate of meldMasks) {
    const snapshots = [...bestByMask.entries()];
    for (const [mask, best] of snapshots) {
      if ((mask & candidate.mask) !== 0) continue;
      const nextMask = mask | candidate.mask;
      const nextValue = best.value + candidate.value;
      const current = bestByMask.get(nextMask);
      if (!current || nextValue > current.value) {
        bestByMask.set(nextMask, {
          value: nextValue,
          melds: [...best.melds, candidate.meld],
        });
      }
    }
  }

  let bestMask = 0;
  let bestValue = 0;
  let bestMelds: Meld[] = [];
  for (const [mask, best] of bestByMask.entries()) {
    if (best.value > bestValue) {
      bestMask = mask;
      bestValue = best.value;
      bestMelds = best.melds;
    }
  }

  const deadwoodCards = cards.filter((card) => {
    const index = cardIndex.get(card.id);
    return index === undefined || (bestMask & (1 << index)) === 0;
  });

  return {
    deadwood: totalValue - bestValue,
    melds: bestMelds,
    deadwoodCards,
  };
}

export function canDeclareGin(cards: Array<GameCard | MeldCard>): boolean {
  return evaluateHand(cards).deadwood === 0;
}

export function canDeclareKnock(cards: Array<GameCard | MeldCard>, knockLimit = 10): boolean {
  const deadwood = evaluateHand(cards).deadwood;
  return deadwood > 0 && deadwood <= knockLimit;
}

export function removeDiscardForDeclaration(
  cards: GameCard[],
  discardCardId: number | undefined,
): GameCard[] {
  if (discardCardId === undefined) return cards;
  return cards.filter((card) => card.id !== discardCardId);
}

export function scoreFinishedRound(
  playerHands: Map<number, GameCard[]>,
  declarerId: number,
  declaration: FinishDeclaration,
): PlayerFinishResult[] {
  const evaluations = [...playerHands.entries()].map(([userId, cards]) => ({
    userId,
    evaluation: evaluateHand(cards),
  }));

  const lowestDeadwood = Math.min(...evaluations.map(({ evaluation }) => evaluation.deadwood));
  const winnerIds = evaluations
    .filter(({ evaluation }) => evaluation.deadwood === lowestDeadwood)
    .map(({ userId }) => userId);
  const isDraw = winnerIds.length > 1;

  return evaluations
    .map(({ userId, evaluation }) => {
      const won = !isDraw && winnerIds.includes(userId);
      const outcome: FinishOutcome = isDraw ? "draw" : won ? "win" : "loss";
      const score = won
        ? evaluations
            .filter((other) => other.userId !== userId)
            .reduce(
              (sum, other) => sum + Math.max(0, other.evaluation.deadwood - evaluation.deadwood),
              0,
            )
        : 0;

      return {
        userId,
        deadwood: evaluation.deadwood,
        outcome,
        placement: won ? 1 : isDraw ? 1 : 2,
        score,
        wentGin: userId === declarerId && declaration === "gin",
        knocked: userId === declarerId && declaration === "knock",
        melds: evaluation.melds,
        deadwoodCards: evaluation.deadwoodCards,
      };
    })
    .sort((a, b) => a.deadwood - b.deadwood || a.userId - b.userId);
}

export function containsCard(cards: GameCard[], cardId: number): boolean {
  return cards.some((card) => sameCard(card, { id: cardId, suit: card.suit, rank: card.rank }));
}
