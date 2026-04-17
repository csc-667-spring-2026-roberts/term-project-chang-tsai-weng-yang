export const shuffleDeck = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    const valI = shuffled[i];
    const valJ = shuffled[j];

    if (valI !== undefined && valJ !== undefined) {
      shuffled[i] = valJ;
      shuffled[j] = valI;
    }
  }
  return shuffled;
};
