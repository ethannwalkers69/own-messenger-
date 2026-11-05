-- Para sa bagong database (walang laman).
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  last_name TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  name TEXT,
  is_group BOOLEAN NOT NULL DEFAULT false,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE members (
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INT NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  reply_to INT REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_conv ON messages (conversation_id, id);
CREATE TABLE reactions (
  message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
