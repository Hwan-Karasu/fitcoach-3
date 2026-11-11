package expo.modules.athletebackup

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.nio.ByteBuffer
import java.security.MessageDigest

/**
 * BKP-AUDIT-1 C5: нативный двойник `features/backup/data/SnapshotContentHash.ts`. Тот же байтовый протокол канонического хеша
 * содержимого, но без перехода через мост на каждую порцию строк и без хеширования на Hermes. Протокол менять нельзя:
 * формат `.atbackup` и значение `contentSha256` в уже созданных копиях остаются прежними.
 *
 * Правила (зеркало JS):
 *  - префикс `athlete-snapshot-content-v1\n`;
 *  - объекты sqlite_master (кроме `sqlite_%` и служебных таблиц копии) — type, name, tbl_name, sql как text/null;
 *  - для каждой таблицы: имя, имена столбцов, строки `row:` + значения, `end-table;`;
 *  - null `null:0:;`, integer `integer:<длина текста>:<текст>;` (через CAST AS TEXT, без потери int64),
 *    real `real:8:<8 байт IEEE-754 big-endian>;` (знак -0.0 сохраняется), text `text:<байт UTF-8>:<байты>;`, blob `blob:<байт>:<байты>;`;
 *  - порядок строк: по префиксу первичного ключа (уникальный, BINARY, однородные типы) — как keyset в JS; иначе по всем столбцам BINARY.
 * Любое расхождение или ошибка не должны ломать копии: JS остаётся арбитром (ContentHasher.ts), а при несовпадении
 * самопроверки на золотой фикстуре нативный путь отключается.
 */
internal class SnapshotContentHasher(private val excluded: Set<String>) {
  private val digest = MessageDigest.getInstance("SHA-256")
  private val buffer = ByteArray(64 * 1024)
  private var length = 0
  var rows = 0L
    private set

  private class Column(val name: String, val type: String, val pk: Int)
  private class SchemaObject(val type: String, val name: String, val table: String, val sql: String?)

  private fun flush() {
    if (length > 0) {
      digest.update(buffer, 0, length)
      length = 0
    }
  }

  private fun bytes(value: ByteArray) {
    if (value.size > buffer.size - length) {
      flush()
      if (value.size > buffer.size) {
        digest.update(value)
        return
      }
    }
    System.arraycopy(value, 0, buffer, length, value.size)
    length += value.size
  }

  private fun ascii(value: String) = bytes(value.toByteArray(Charsets.US_ASCII))

  private fun feedText(value: String) {
    val encoded = value.toByteArray(Charsets.UTF_8)
    ascii("text:${encoded.size}:")
    bytes(encoded)
    ascii(";")
  }

  private fun feedInteger(text: String) {
    if (!INTEGER.matches(text)) throw IllegalStateException("INTEGER_FORMAT")
    ascii("integer:${text.length}:$text;")
  }

  private fun feedReal(value: Double) {
    if (value.isNaN()) throw IllegalStateException("REAL_NAN")
    ascii("real:8:")
    bytes(ByteBuffer.allocate(8).putLong(java.lang.Double.doubleToRawLongBits(value)).array())
    ascii(";")
  }

  private fun feedBlob(value: ByteArray) {
    ascii("blob:${value.size}:")
    bytes(value)
    ascii(";")
  }

  private fun quote(name: String) = "\"" + name.replace("\"", "\"\"") + "\""

  private fun <T> SQLiteDatabase.queryAll(sql: String, read: (Cursor) -> T): List<T> =
    rawQuery(sql, null).use { cursor ->
      val result = ArrayList<T>()
      while (cursor.moveToNext()) result.add(read(cursor))
      result
    }

  private fun SQLiteDatabase.queryLong(sql: String): Long = rawQuery(sql, null).use { cursor ->
    if (cursor.moveToFirst()) cursor.getLong(0) else throw IllegalStateException("NO_ROW")
  }

  /** Зеркало keysetMode(): тот же отбор безопасных ключей, чтобы порядок строк совпал с JS побайтно. */
  private fun keyOrder(db: SQLiteDatabase, table: String, columns: List<Column>): String? {
    val first = columns.firstOrNull() ?: return null
    val count = columns.count { it.pk > 0 }
    if (count == 0 || columns.take(count).withIndex().any { (index, column) -> column.pk != index + 1 }) return null
    val prefix = columns.take(count)
    val indexes = db.queryAll("PRAGMA index_list(${quote(table)})") { c ->
      Pair(c.getString(c.getColumnIndexOrThrow("name")), c.getString(c.getColumnIndexOrThrow("origin")))
    }.filter { it.second == "pk" }
    if (indexes.size == 1) {
      val keys = db.queryAll("PRAGMA index_xinfo(${quote(indexes[0].first)})") { c ->
        Triple(
          if (c.isNull(c.getColumnIndexOrThrow("name"))) null else c.getString(c.getColumnIndexOrThrow("name")),
          c.getString(c.getColumnIndexOrThrow("coll")),
          c.getInt(c.getColumnIndexOrThrow("key")),
        )
      }.filter { it.third == 1 }
      if (keys.size != count) return null
      for ((index, key) in keys.withIndex()) {
        if (key.first != prefix[index].name || key.second.uppercase() != "BINARY") return null
      }
    } else if (indexes.isNotEmpty() || count != 1 || first.type.uppercase() != "INTEGER") {
      return null
    }
    for (key in prefix) {
      val column = quote(key.name)
      val homogeneous = listOf("text", "integer").any { mode ->
        db.queryLong("SELECT count(*) FROM ${quote(table)} WHERE typeof($column) <> '$mode'") == 0L
      }
      if (!homogeneous) return null
    }
    return prefix.joinToString(", ") { "${quote(it.name)} COLLATE BINARY" }
  }

  fun compute(db: SQLiteDatabase): String {
    ascii("athlete-snapshot-content-v1\n")
    val objects = db.queryAll("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name") { c ->
      SchemaObject(c.getString(0), c.getString(1), c.getString(2), if (c.isNull(3)) null else c.getString(3))
    }
    for (item in objects) {
      if (item.name in excluded) continue
      feedText(item.type)
      feedText(item.name)
      feedText(item.table)
      if (item.sql == null) ascii("null:0:;") else feedText(item.sql)
    }
    for (item in objects) {
      if (item.type != "table" || item.name in excluded) continue
      feedText(item.name)
      val columns = db.queryAll("PRAGMA table_info(${quote(item.name)})") { c ->
        Column(c.getString(c.getColumnIndexOrThrow("name")), c.getString(c.getColumnIndexOrThrow("type")) ?: "", c.getInt(c.getColumnIndexOrThrow("pk")))
      }
      for (column in columns) feedText(column.name)
      val fields = columns.indices.joinToString(", ") { index ->
        val col = quote(columns[index].name)
        "typeof($col) AS t$index, CASE typeof($col) WHEN 'integer' THEN CAST($col AS TEXT) ELSE $col END AS v$index"
      }
      val order = keyOrder(db, item.name, columns) ?: columns.joinToString(", ") { "${quote(it.name)} COLLATE BINARY" }
      db.rawQuery("SELECT $fields FROM ${quote(item.name)} ORDER BY $order", null).use { cursor ->
        while (cursor.moveToNext()) {
          ascii("row:")
          for (index in columns.indices) {
            when (cursor.getString(index * 2)) {
              "null" -> ascii("null:0:;")
              "integer" -> feedInteger(cursor.getString(index * 2 + 1))
              "real" -> feedReal(cursor.getDouble(index * 2 + 1))
              "text" -> feedText(cursor.getString(index * 2 + 1))
              "blob" -> feedBlob(cursor.getBlob(index * 2 + 1))
              else -> throw IllegalStateException("VALUE_KIND")
            }
          }
          rows++
        }
      }
      ascii("end-table;")
    }
    flush()
    return digest.digest().joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
  }

  private companion object {
    val INTEGER = Regex("^-?(?:0|[1-9][0-9]*)$")
  }
}
