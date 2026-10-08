-- name: InsertNamed :execlastid
INSERT INTO items(name, enabled, payload, score) VALUES (@name, @enabled, @payload, @score);

-- name: InsertPositional :exec
INSERT INTO items(name) VALUES (?);

-- name: GetItem :one
SELECT id, name AS displayName, enabled, payload, score FROM items WHERE id = ?;

-- name: FindNamed :many
SELECT id, name FROM items WHERE name = @name OR name = @name ORDER BY id;

-- name: FindNumbered :many
SELECT id, name FROM items WHERE id = ?2 OR id = ?1 OR id = ?2 ORDER BY id;

-- name: ListItems :many
SELECT id, name AS "Quoted Alias", enabled FROM items ORDER BY id;

-- name: Literals :one
SELECT '?1 AS imaginaryAlias' AS literalValue, name AS actualName FROM items WHERE id = ? /* ?9 AS fakeAlias */;

-- name: DeleteItem :execrows
DELETE FROM items WHERE id = ?;

-- name: FindRepeated :many
SELECT id FROM items WHERE id = ? OR id = ? ORDER BY id;
