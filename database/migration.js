import 'dotenv/config';
import pgPromise from 'pg-promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// In ES Modules, we have to manually create __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pgp = pgPromise();

// Ensure you have DATABASE_URL in your .env or Render environment variables
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const db = pgp(connectionString);

const runMigration = async () => {
  try {
    console.log("--- Starting Migration (ESM Mode) ---");

    // 1. Read and execute schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`schema.sql not found at ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath).toString();
    console.log("Executing schema.sql...");
    await db.none(schemaSql);
    console.log("✓ Tables checked/created.");

    // 2. Check if the cards table needs seeding
    const cardCountResult = await db.one('SELECT count(*) FROM cards');
    const count = parseInt(cardCountResult.count);

    if (count === 0) {
      console.log("Seeding cards table (52 cards)...");

      const suits = ['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'];
      const ranks = [
        { name: 'A', value: 1 }, { name: '2', value: 2 }, { name: '3', value: 3 },
        { name: '4', value: 4 }, { name: '5', value: 5 }, { name: '6', value: 6 },
        { name: '7', value: 7 }, { name: '8', value: 8 }, { name: '9', value: 9 },
        { name: '10', value: 10 }, { name: 'J', value: 11 }, { name: 'Q', value: 12 },
        { name: 'K', value: 13 }
      ];

      const cardEntries = [];

      suits.forEach(suit => {
        const color = (suit === 'HEARTS' || suit === 'DIAMONDS') ? 'RED' : 'BLACK';
        ranks.forEach(rank => {
          cardEntries.push({
            suit: suit,
            rank: rank.name,
            rank_value: rank.value,
            color: color
          });
        });
      });

      // Using pg-promise Helpers for a single multi-row insert query
      const cs = new pgp.helpers.ColumnSet(['suit', 'rank', 'rank_value', 'color'], { table: 'cards' });
      const insertQuery = pgp.helpers.insert(cardEntries, cs);
      
      await db.none(insertQuery);
      console.log("✓ 52 cards seeded successfully.");
    } else {
      console.log(`✓ Cards table already contains ${count} records. Skipping seed.`);
    }

    console.log("--- Migration Completed Successfully ---");
    process.exit(0);

  } catch (err) {
    console.error("!!! Migration Failed !!!");
    console.error(err.message);
    process.exit(1);
  }
};

runMigration();