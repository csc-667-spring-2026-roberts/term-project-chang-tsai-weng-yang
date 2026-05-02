import 'dotenv/config';
import pgPromise from 'pg-promise';

const pgp = pgPromise();
const db = pgp(process.env.DATABASE_URL);

(async () => {
  try {
    const result = await db.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'game_rooms' ORDER BY ordinal_position;"
    );
    console.log("\n=== game_rooms Table Columns ===");
    result.forEach(col => {
      console.log(`${col.column_name}: ${col.data_type}`);
    });
    
    // Also check current rooms
    const rooms = await db.query("SELECT id, created_by, player_2_id, player_3_id, player_4_id, status FROM game_rooms ORDER BY created_at DESC LIMIT 3");
    console.log("\n=== Last 3 Rooms ===");
    console.log(rooms);
    
    await db.$pool.end();
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
})();
