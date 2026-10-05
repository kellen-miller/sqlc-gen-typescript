CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT 1,
  payload BLOB,
  score REAL
);
