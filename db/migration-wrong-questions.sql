CREATE TABLE app.wrong_questions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  subject text NOT NULL,
  grade text,
  chapter text,
  source text NOT NULL,
  question text NOT NULL,
  correct_answer text NOT NULL,
  my_answer text NOT NULL,
  reason text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'todo',
  review_count integer NOT NULL DEFAULT 0,
  last_reviewed_at timestamptz,
  visibility text NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wrong_questions_user_created_idx ON app.wrong_questions (user_id, created_at, id);
CREATE INDEX wrong_questions_user_status_idx ON app.wrong_questions (user_id, status);
CREATE INDEX wrong_questions_visibility_created_idx ON app.wrong_questions (visibility, created_at, id);
