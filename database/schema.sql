-- SESSION TABLE: Required for Render persistence across deploys
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- USERS TABLE: Basic authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GAME ROOMS: Manages the lobby and player matching
CREATE TABLE IF NOT EXISTS game_rooms (
    id VARCHAR(8) PRIMARY KEY,
    created_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_2_id INT REFERENCES users(id) ON DELETE CASCADE,
    player_3_id INT REFERENCES users(id) ON DELETE CASCADE,
    player_4_id INT REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'waiting',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    matched_at TIMESTAMP,
    started_at TIMESTAMP,
    -- 'waiting': room created, waiting for players
    -- 'waiting_to_start': room has 2+ players, waiting for host to click start
    -- 'completed': game is in progress
    -- 'cancelled': room was cancelled
    CONSTRAINT valid_status CHECK (status IN ('waiting', 'waiting_to_start', 'completed', 'cancelled'))
);

-- Add missing columns if they don't exist (for existing databases)
DO $$ 
BEGIN 
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='game_rooms' AND column_name='player_3_id') THEN
    ALTER TABLE game_rooms ADD COLUMN player_3_id INT REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='game_rooms' AND column_name='player_4_id') THEN
    ALTER TABLE game_rooms ADD COLUMN player_4_id INT REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='game_rooms' AND column_name='started_at') THEN
    ALTER TABLE game_rooms ADD COLUMN started_at TIMESTAMP;
  END IF;
END $$;

-- GAME STATE: Tracks whose turn it is
CREATE TABLE IF NOT EXISTS game_state (
    room_id VARCHAR(8) PRIMARY KEY REFERENCES game_rooms(id) ON DELETE CASCADE,
    turn_user_id INT REFERENCES users(id),
    last_action_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GAME CARDS: Junction table tracking every card's location
-- This replaces JSON columns to satisfy the "no JSON for game state" rule
CREATE TABLE IF NOT EXISTS game_cards (
    id SERIAL PRIMARY KEY,
    room_id VARCHAR(8) NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
    suit VARCHAR(1) NOT NULL, -- 'H', 'D', 'C', 'S'
    rank VARCHAR(2) NOT NULL, -- 'A', '2', ..., '10', 'J', 'Q', 'K'
    location VARCHAR(20) NOT NULL, -- 'deck', 'discard', 'hand'
    player_id INT REFERENCES users(id), -- NULL if in deck or discard pile
    card_order INT, -- Critical for Fisher-Yates shuffle order
    CONSTRAINT valid_location CHECK (location IN ('deck', 'discard', 'hand'))
);

-- GAME RESULTS: One row per player per finished game, used by profile stats
CREATE TABLE IF NOT EXISTS game_results (
    id SERIAL PRIMARY KEY,
    room_id VARCHAR(8) NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opponent_ids INT[] DEFAULT '{}',
    placement INT,
    score INT DEFAULT 0,
    deadwood_score INT DEFAULT 0,
    went_gin BOOLEAN DEFAULT FALSE,
    knocked BOOLEAN DEFAULT FALSE,
    outcome VARCHAR(20) NOT NULL,
    finished_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT game_results_room_user_unique UNIQUE (room_id, user_id),
    CONSTRAINT game_results_valid_outcome CHECK (outcome IN ('win', 'loss', 'draw'))
);

-- CARDS LOOKUP TABLE: the static, immutable definition of all 52
-- standard playing cards. Seeded once by database/migration.js and never
-- written to at runtime. game_cards is the junction table that maps a
-- card's *position* (deck/hand/discard, owner, order) per active room.
CREATE TABLE IF NOT EXISTS cards (
    id SERIAL PRIMARY KEY,
    suit VARCHAR(10) NOT NULL,         -- 'HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'
    rank VARCHAR(2)  NOT NULL,         -- 'A', '2', ..., '10', 'J', 'Q', 'K'
    rank_value INT   NOT NULL,         -- 1..13, used for melding/scoring
    color VARCHAR(5) NOT NULL,         -- 'RED' or 'BLACK'
    CONSTRAINT cards_unique UNIQUE (suit, rank),
    CONSTRAINT cards_valid_color CHECK (color IN ('RED', 'BLACK'))
);

-- GAME CHAT: Store chat messages sent during a game
CREATE TABLE IF NOT EXISTS game_chat (
    id SERIAL PRIMARY KEY,
    room_id VARCHAR(8) NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- AUTO-HEAL FOR PRE-EXISTING DATABASES ----------------------------------------
-- CREATE TABLE IF NOT EXISTS is a no-op when the table exists, so any
-- check-constraint changes have to be applied via ALTER. This block drops
-- the old `valid_status` constraint (which only allowed waiting/matched/
-- completed/cancelled) and re-adds it with the new value set including
-- 'waiting_to_start'. Idempotent: safe to run on fresh and existing DBs.
DO $$
BEGIN
  ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS valid_status;
  ALTER TABLE game_rooms ADD CONSTRAINT valid_status
    CHECK (status IN ('waiting', 'waiting_to_start', 'matched', 'completed', 'cancelled'));
EXCEPTION WHEN OTHERS THEN
  -- If the table doesn't exist yet (very fresh DB before CREATE), ignore.
  NULL;
END $$;

-- Normalize any legacy rows that were stuck at 'matched' under the
-- old code path so they don't block the new state machine.
UPDATE game_rooms SET status = 'waiting_to_start' WHERE status = 'matched';

-- Indexing for production performance on Render
CREATE INDEX IF NOT EXISTS idx_game_cards_room ON game_cards(room_id);
CREATE INDEX IF NOT EXISTS idx_game_cards_location ON game_cards(location);
CREATE INDEX IF NOT EXISTS idx_game_results_user ON game_results(user_id);
CREATE INDEX IF NOT EXISTS idx_game_results_room ON game_results(room_id);
CREATE INDEX IF NOT EXISTS idx_game_chat_room ON game_chat(room_id);
CREATE INDEX IF NOT EXISTS idx_game_chat_created ON game_chat(created_at);
