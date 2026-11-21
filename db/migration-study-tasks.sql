CREATE TABLE app.study_tasks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  title text NOT NULL,
  subject text,
  kind text NOT NULL DEFAULT 'normal',
  due_date date,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_tasks_user_due_idx ON app.study_tasks (user_id, due_date, id);
CREATE INDEX study_tasks_user_created_idx ON app.study_tasks (user_id, created_at, id);
