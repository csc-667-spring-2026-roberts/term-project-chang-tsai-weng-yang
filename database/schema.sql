CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_rooms (
    id VARCHAR(8) PRIMARY KEY,
    created_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_2_id INT REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'waiting',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    matched_at TIMESTAMP,
    CONSTRAINT valid_status CHECK (status IN ('waiting', 'matched', 'completed', 'cancelled'))
);