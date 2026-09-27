-- A comment containing a ; separator.
CREATE TABLE sql_syntax_probe (value TEXT NOT NULL DEFAULT 'default;value');
CREATE TABLE sql_syntax_audit (value TEXT NOT NULL);
/* A block comment containing another ; separator. */
CREATE TRIGGER sql_syntax_insert AFTER INSERT ON sql_syntax_probe
BEGIN
  INSERT INTO sql_syntax_audit VALUES ('first;entry');
  INSERT INTO sql_syntax_audit VALUES ('it''s;second');
END;
INSERT INTO sql_syntax_probe DEFAULT VALUES;
