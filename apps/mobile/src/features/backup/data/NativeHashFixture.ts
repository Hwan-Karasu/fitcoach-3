/** BKP-AUDIT-1 C5: золотая фикстура для самопроверки нативного канонического хеша на устройстве. Содержит классы значений, на
 * которых нативный и JS-пути могут разойтись: int64-края, REAL (−0.0, ±∞, субнормальные), NULL, BLOB/пустой BLOB, Юникод и эмодзи,
 * перевод строки, табуляция и NUL внутри текста, составной PRIMARY KEY (keyset), INTEGER PRIMARY KEY с отрицательными ключами, таблица без PK (порядок
 * по всем столбцам), смешанные типы, дубликаты строк и индекс. Эталон посчитан независимым узловым оракулом
 * (scripts/r06/SqliteBackup.ts: canonicalContentSha256) и закреплён тестом native-hash-fixture. Не менять без пересчёта эталона. */
export const NATIVE_HASH_FIXTURE_SQL = `CREATE TABLE atoms (a, b TEXT COLLATE NOCASE, c BLOB);
INSERT INTO atoms VALUES (9223372036854775807,'A',x'00ff'),(-9223372036854775808,'a',x'00ff'),(NULL,'',NULL),('12','a',x''),('12','a',x'');
CREATE INDEX atoms_b ON atoms(b);
INSERT INTO atoms VALUES (0.1,'real',NULL),(-0.0,'real',NULL),(1.2345678901234567,'real',NULL),
(3.141592653589793,'real',NULL),(5e-324,'real',NULL),(-5e-324,'real',NULL),
(1.7976931348623157e308,'real',NULL),(-9007199254740991.0,'real',NULL),(9007199254740991.0,'real',NULL),
(2.2250738585072014e-308,'real',NULL),(9e999,'real',NULL),(-9e999,'real',NULL);
CREATE TABLE pairs (k1 INTEGER, k2 TEXT, v TEXT, PRIMARY KEY (k1, k2)) WITHOUT ROWID;
INSERT INTO pairs VALUES (2,'б','Привет, мир ✓'),(-1,'a','日本語'),(2,'a','emoji 😀'),(9223372036854775807,'z','');
CREATE TABLE plain (id INTEGER PRIMARY KEY, note TEXT);
INSERT INTO plain VALUES (-5,'x'),(7,NULL),(300,'line1' || char(10) || 'line2'),(301,'nul' || char(0) || 'inside'),(302,'tab' || char(9) || 'end');
CREATE TABLE loose (x, y);
INSERT INTO loose VALUES (1,'b'),(1,'a'),(NULL,'a'),('t',2.5),(2.5,x'ff'),(x'00',''),(1,'a')`;
export const NATIVE_HASH_FIXTURE_SHA256 = "851c03b68ddd93ad4bba1536d9d55cb0662c314ef071d82f784458aa5ead7764";
