/** Synthetic probe only. SQL literals bypass platform-specific parameter normalization, so
 * both drivers read exactly the same SQLite storage classes and IEEE edge values. */
export const R06_SCALAR_FIXTURE_SQL = `CREATE TABLE atoms (a, b TEXT COLLATE NOCASE, c BLOB);
      INSERT INTO atoms VALUES (9223372036854775807,'A',x'00ff'),(-9223372036854775808,'a',x'00ff'),(NULL,'',NULL),('12','a',x''),('12','a',x'');
      CREATE INDEX atoms_b ON atoms(b);
      INSERT INTO atoms VALUES (0.1,'real',NULL),(-0.0,'real',NULL),(1.2345678901234567,'real',NULL),
      (3.141592653589793,'real',NULL),(5e-324,'real',NULL),(-5e-324,'real',NULL),
      (1.7976931348623157e308,'real',NULL),(-9007199254740991.0,'real',NULL),(9007199254740991.0,'real',NULL),
      (2.2250738585072014e-308,'real',NULL),(9e999,'real',NULL),(-9e999,'real',NULL)`;
export const R06_SCALAR_FIXTURE_SHA256 = "adda84d1ba96c774abb99d0351bce08228c4e24f4722026f35534b8967a11560";
