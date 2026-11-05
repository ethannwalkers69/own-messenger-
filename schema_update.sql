-- Existing columns (safe to re-run)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Profile
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;   -- small data: URL
ALTER TABLE users ADD COLUMN IF NOT EXISTS color TEXT;    -- avatar color when no photo

-- Groups
CREATE TABLE IF NOT EXISTS chat_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  last_read_id INT NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);
ALTER TABLE messages ALTER COLUMN receiver_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS group_id INT REFERENCES chat_groups(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id, id);

-- Replies
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to INT REFERENCES messages(id) ON DELETE SET NULL;

-- Reactions (one reaction per user per message; tap again to remove)
CREATE TABLE IF NOT EXISTS reactions (
  message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- Group leader tools (leader = chat_groups.created_by; can be transferred)
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT now();

-- System messages ("X left", "X renamed the group...")
ALTER TABLE messages ADD COLUMN IF NOT EXISTS system BOOLEAN NOT NULL DEFAULT false;

-- Edit / delete / images
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image TEXT;   -- data: URL, served via /api/messages/:id/image
