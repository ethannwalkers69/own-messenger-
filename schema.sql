-- Full schema for a FRESH database. Existing database? Run schema_update.sql instead.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  last_name TEXT,
  password_hash TEXT NOT NULL,
  bio TEXT,
  avatar TEXT,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_by INT REFERENCES users(id),   -- current group leader
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  last_read_id INT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id INT NOT NULL REFERENCES users(id),
  receiver_id INT REFERENCES users(id),                               -- NULL for group messages
  group_id INT REFERENCES chat_groups(id) ON DELETE CASCADE,          -- NULL for DMs
  body TEXT NOT NULL,
  image TEXT,                                                         -- data: URL
  reply_to INT REFERENCES messages(id) ON DELETE SET NULL,
  system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (sender_id, receiver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id, id);

CREATE TABLE IF NOT EXISTS reactions (
  message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
