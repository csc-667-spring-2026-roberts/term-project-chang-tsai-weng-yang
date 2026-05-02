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

-- Indexing for production performance on Render
CREATE INDEX IF NOT EXISTS idx_game_cards_room ON game_cards(room_id);
CREATE INDEX IF NOT EXISTS idx_game_cards_location ON game_cards(location);
