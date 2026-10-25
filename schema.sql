BEGIN;
CREATE TABLE IF NOT EXISTS kin_users (
  id uuid PRIMARY KEY,
  handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,24}$'),
  password_hash text NOT NULL,
  recovery_hash text NOT NULL,
  character jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kin_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES kin_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kin_sessions_user ON kin_sessions(user_id);
CREATE TABLE IF NOT EXISTS kin_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  resets_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS kin_connections (
  id uuid PRIMARY KEY,
  requester uuid NOT NULL REFERENCES kin_users(id) ON DELETE CASCADE,
  recipient uuid NOT NULL REFERENCES kin_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  requester_circle text NOT NULL DEFAULT 'cast' CHECK (requester_circle IN ('cast','partners')),
  recipient_circle text NOT NULL DEFAULT 'cast' CHECK (recipient_circle IN ('cast','partners')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester <> recipient)
);
CREATE TABLE IF NOT EXISTS kin_media (
  id uuid PRIMARY KEY,
  owner uuid NOT NULL REFERENCES kin_users(id) ON DELETE CASCADE,
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 4 AND 2097152),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kin_posts (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  author uuid NOT NULL REFERENCES kin_users(id) ON DELETE CASCADE,
  caption text NOT NULL CHECK (length(trim(caption)) BETWEEN 1 AND 5000),
  mode text NOT NULL CHECK (mode IN ('ic','ooc')),
  audience text NOT NULL CHECK (audience IN ('all','cast','partners')),
  image_id uuid REFERENCES kin_media(id),
  alt text NOT NULL DEFAULT '' CHECK (length(alt) <= 250),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (image_id IS NULL OR length(trim(alt)) > 0)
);
CREATE INDEX IF NOT EXISTS kin_posts_author_created ON kin_posts(author,created_at DESC);
CREATE TABLE IF NOT EXISTS kin_replies (
  id uuid PRIMARY KEY,
  post_id text NOT NULL REFERENCES kin_posts(id) ON DELETE CASCADE,
  author uuid NOT NULL REFERENCES kin_users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  mode text NOT NULL CHECK (mode IN ('ic','ooc')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kin_replies_post ON kin_replies(post_id,created_at);
CREATE TABLE IF NOT EXISTS kin_likes (
  user_id uuid NOT NULL REFERENCES kin_users(id) ON DELETE CASCADE,
  post_id text NOT NULL REFERENCES kin_posts(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id,post_id)
);
CREATE TABLE IF NOT EXISTS kin_bookmarks (
  user_id uuid NOT NULL REFERENCES kin_users(id) ON DELETE CASCADE,
  post_id text NOT NULL REFERENCES kin_posts(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id,post_id)
);
-- Existing accounts, posts, media and connections remain roleplay records.
ALTER TABLE kin_users ADD COLUMN IF NOT EXISTS personal jsonb NOT NULL DEFAULT '{"name":"Your name","bio":"","fandom":"Personal","role":"Personal profile","pronouns":"","location":"","backstory":"","boundaries":"","portrait":""}'::jsonb;
ALTER TABLE kin_connections ADD COLUMN IF NOT EXISTS profile_kind text NOT NULL DEFAULT 'roleplay' CHECK (profile_kind IN ('roleplay','personal'));
ALTER TABLE kin_posts ADD COLUMN IF NOT EXISTS profile_kind text NOT NULL DEFAULT 'roleplay' CHECK (profile_kind IN ('roleplay','personal'));
ALTER TABLE kin_media ADD COLUMN IF NOT EXISTS profile_kind text NOT NULL DEFAULT 'roleplay' CHECK (profile_kind IN ('roleplay','personal'));
CREATE UNIQUE INDEX IF NOT EXISTS kin_connection_profile_pair ON kin_connections(profile_kind,least(requester,recipient),greatest(requester,recipient));
DROP INDEX IF EXISTS kin_connection_pair;
CREATE INDEX IF NOT EXISTS kin_posts_profile_created ON kin_posts(profile_kind,created_at DESC);
COMMIT;
