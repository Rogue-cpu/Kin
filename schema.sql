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
CREATE TABLE IF NOT EXISTS kin_chats (
 id uuid PRIMARY KEY, profile_kind text NOT NULL CHECK(profile_kind IN ('personal','roleplay')),
 creator uuid NOT NULL REFERENCES kin_users(id), title text NOT NULL DEFAULT '' CHECK(length(title)<=80),
 is_group boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kin_chat_members (
 chat_id uuid NOT NULL REFERENCES kin_chats(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES kin_users(id), PRIMARY KEY(chat_id,user_id)
);
CREATE INDEX IF NOT EXISTS kin_chat_members_user ON kin_chat_members(user_id,chat_id);
CREATE TABLE IF NOT EXISTS kin_messages (
 seq bigserial PRIMARY KEY, id uuid NOT NULL UNIQUE, chat_id uuid NOT NULL REFERENCES kin_chats(id) ON DELETE CASCADE,
 sender uuid NOT NULL REFERENCES kin_users(id), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kin_messages_chat_seq ON kin_messages(chat_id,seq DESC);
CREATE TABLE IF NOT EXISTS kin_chat_assets (
 id uuid PRIMARY KEY, chat_id uuid NOT NULL REFERENCES kin_chats(id) ON DELETE CASCADE,
 owner uuid NOT NULL REFERENCES kin_users(id), mime text NOT NULL, bytes bytea NOT NULL,
 fingerprint text NOT NULL, duration integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(octet_length(bytes) BETWEEN 1 AND 3145728),
 CHECK(mime IN ('image/jpeg','audio/webm','audio/ogg','audio/mp4'))
);
ALTER TABLE kin_messages ADD COLUMN IF NOT EXISTS attachment_id uuid REFERENCES kin_chat_assets(id);
ALTER TABLE kin_messages DROP CONSTRAINT IF EXISTS kin_messages_body_check;
ALTER TABLE kin_messages DROP CONSTRAINT IF EXISTS kin_messages_content_check;
CREATE TABLE IF NOT EXISTS kin_calls (
 id uuid PRIMARY KEY,chat_id uuid NOT NULL REFERENCES kin_chats(id) ON DELETE CASCADE,
 caller uuid NOT NULL REFERENCES kin_users(id), video boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '60 seconds', ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS kin_calls_chat ON kin_calls(chat_id,created_at DESC);
CREATE TABLE IF NOT EXISTS kin_call_members (
 call_id uuid NOT NULL REFERENCES kin_calls(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES kin_users(id),
 state text NOT NULL CHECK(state IN ('joined','left','declined')),seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(call_id,user_id)
);
CREATE TABLE IF NOT EXISTS kin_call_signals (
 seq bigserial PRIMARY KEY, call_id uuid NOT NULL REFERENCES kin_calls(id) ON DELETE CASCADE,
 sender uuid NOT NULL REFERENCES kin_users(id), recipient uuid NOT NULL REFERENCES kin_users(id),
 type text NOT NULL CHECK(type IN ('offer','answer','candidate')), payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kin_call_signals_recipient ON kin_call_signals(call_id,recipient,seq);
ALTER TABLE kin_call_members ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE kin_messages ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES kin_messages(id) ON DELETE SET NULL;
ALTER TABLE kin_replies ADD COLUMN IF NOT EXISTS parent_reply_id uuid REFERENCES kin_replies(id) ON DELETE SET NULL;
ALTER TABLE kin_chat_assets DROP CONSTRAINT IF EXISTS kin_chat_assets_mime_check;
ALTER TABLE kin_chat_assets ADD CONSTRAINT kin_chat_assets_mime_check CHECK(mime IN ('image/jpeg','image/gif','audio/webm','audio/ogg','audio/mp4'));
ALTER TABLE kin_messages ADD COLUMN IF NOT EXISTS giphy_id text CHECK(giphy_id IS NULL OR giphy_id ~ '^[A-Za-z0-9]{1,64}$');
ALTER TABLE kin_messages DROP CONSTRAINT IF EXISTS kin_messages_content_check;
ALTER TABLE kin_messages ADD CONSTRAINT kin_messages_content_check CHECK(length(body)<=4000 AND (length(body)>0 OR attachment_id IS NOT NULL OR giphy_id IS NOT NULL) AND NOT(attachment_id IS NOT NULL AND giphy_id IS NOT NULL));
COMMIT;
