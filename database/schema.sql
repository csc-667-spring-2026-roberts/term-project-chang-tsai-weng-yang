CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");


CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cards (
    id SERIAL PRIMARY KEY,
    suit VARCHAR(10) NOT NULL,    -- 'HEARTS', 'DIAMONDS', etc.
    rank VARCHAR(5) NOT NULL,     -- 'A', '2', 'K', etc.
    rank_value INTEGER NOT NULL,  -- 1 for Ace, 13 for King
    color VARCHAR(10) NOT NULL    -- 'RED' or 'BLACK'
);


CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'LOBBY' CHECK (status IN ('LOBBY', 'IN_PROGRESS', 'COMPLETED')),
    turn_player_id INTEGER REFERENCES users(id),
    turn_phase VARCHAR(20) NOT NULL DEFAULT 'DRAW' CHECK (turn_phase IN ('DRAW', 'DISCARD')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS game_users (
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    seat_number INTEGER NOT NULL CHECK (seat_number IN (0, 1)),
    PRIMARY KEY (game_id, user_id),
    UNIQUE (game_id, seat_number)
);


CREATE TABLE IF NOT EXISTS game_cards (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    card_id INTEGER REFERENCES cards(id),
    location VARCHAR(20) NOT NULL,  -- 'DECK', 'DISCARD', 'PLAYER_0_HAND', 'PLAYER_1_HAND'
    user_id INTEGER REFERENCES users(id), -- Specific hand ownership
    card_order INTEGER NOT NULL,   -- Crucial for the Fisher-Yates shuffled deck order
    UNIQUE (game_id, card_id)
);

CREATE TABLE IF NOT EXISTS game_events (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    action_type VARCHAR(50) NOT NULL, -- 'DRAW', 'DISCARD', 'KNOCK'
    card_id INTEGER REFERENCES cards(id), -- Which card was moved
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);



