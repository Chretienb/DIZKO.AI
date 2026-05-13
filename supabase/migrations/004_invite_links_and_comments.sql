CREATE TABLE IF NOT EXISTS invitations (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  uuid        NOT NULL,
  user_id     uuid,
  email       text        NOT NULL,
  role        text        NOT NULL DEFAULT 'Collaborator',
  invited_by  uuid        NOT NULL,
  status      text        NOT NULL DEFAULT 'pending',
  link_token  text        UNIQUE,
  role_preset text        DEFAULT 'Collaborator',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitations_project_id ON invitations(project_id);
CREATE INDEX IF NOT EXISTS invitations_email      ON invitations(email);
CREATE INDEX IF NOT EXISTS invitations_link_token ON invitations(link_token) WHERE link_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS stem_comments (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  stem_id       uuid        NOT NULL REFERENCES stems(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL,
  user_id       uuid        NOT NULL,
  user_name     text        NOT NULL DEFAULT '',
  avatar_url    text,
  timestamp_sec float       NOT NULL DEFAULT 0,
  text          text        NOT NULL CHECK (char_length(text) <= 500),
  resolved      boolean     NOT NULL DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stem_comments_stem_id    ON stem_comments(stem_id);
CREATE INDEX IF NOT EXISTS stem_comments_project_id ON stem_comments(project_id);

ALTER PUBLICATION supabase_realtime ADD TABLE stem_comments;
