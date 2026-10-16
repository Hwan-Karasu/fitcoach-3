/** Random RFC 4122 v4 UUID generated inside the transaction that inserts the row. */
export const UUID_V4_SQL = `SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) ||
  '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', 1 + abs(random() % 4), 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))) AS id`;
