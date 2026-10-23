package expo.modules.athletebackup

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONObject

/** Native, installation-private proof of creation. No URI from the TS catalog is deletion
 * authority by itself. Missing/corrupt receipts never authorize scanning external storage.
 * Atomic rename protects process-death replay, not directory-fsync/power-loss durability. */
internal class AutomaticPublications(private val context: Context) {
  private val resolver get() = context.contentResolver
  private val root get() = File(context.filesDir, "automatic-publications")
  private fun unavailable(): Nothing = throw PublicationFailure("BACKUP_DESTINATION_UNAVAILABLE")
  private fun invalid(): Nothing = throw PublicationFailure("BACKUP_PUBLICATION_INVALID")
  private fun mismatch(): Nothing = throw PublicationFailure("BACKUP_VERIFICATION_FAILED")
  private fun path(id: String): File {
    if (!Regex("^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$").matches(id)) invalid()
    return File(root, "$id.json")
  }
  private fun read(id: String): JSONObject? {
    val file = path(id); if (!file.exists()) return null
    if (!file.isFile || file.length() > 32768) invalid()
    val r = JSONObject(file.readText(Charsets.UTF_8))
    if (r.keys().asSequence().toSet() != setOf("version", "id", "createdAt", "sha256", "bytes", "tree", "uri", "filename", "removed") ||
      r.getInt("version") != 1 || r.getString("id") != id ||
      !Regex("^[a-f0-9]{64}$").matches(r.getString("sha256")) || r.getLong("bytes") < 100) invalid()
    val stamp = r.getString("createdAt").take(19).replace("-", "").replace(":", "").replace("T", "-")
    if (r.getString("filename") != "athlete-diary-auto-$stamp-$id.atbackup" || r.getString("uri").length > 8192) invalid()
    return r
  }
  private fun write(r: JSONObject) {
    val target = path(r.getString("id")); if (!root.exists() && !root.mkdirs()) unavailable()
    val next = File(root, "${target.name}-${UUID.randomUUID()}.next")
    try {
      FileOutputStream(next).use { stream -> stream.write(r.toString().toByteArray(Charsets.UTF_8)); stream.flush(); stream.fd.sync() }
      if (!next.renameTo(target)) unavailable()
    } finally { if (next.exists()) next.delete() }
  }
  private fun checked(id: String, uri: String, hash: String, size: Double): JSONObject {
    val r = read(id) ?: invalid()
    if (!size.isFinite() || size < 100 || size.toLong().toDouble() != size || r.getString("uri") != uri ||
      r.getString("sha256") != hash || r.getLong("bytes") != size.toLong()) invalid()
    return r
  }
  private fun authorized(r: JSONObject): Uri {
    val uri = Uri.parse(r.getString("uri")); if (uri.scheme != "content") invalid()
    if (r.isNull("tree")) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || uri.authority != "media" || !Regex("^/external_primary/downloads/[0-9]+$").matches(uri.path ?: "")) invalid()
    } else {
      val tree = Uri.parse(r.getString("tree"))
      if (!DocumentsContract.isTreeUri(tree) || !DocumentsContract.isDocumentUri(context, uri) ||
        resolver.persistedUriPermissions.none { it.uri == tree && it.isReadPermission && it.isWritePermission }) unavailable()
      if (uri.authority != tree.authority || DocumentsContract.getTreeDocumentId(uri) != DocumentsContract.getTreeDocumentId(tree)) invalid()
    }
    return uri
  }
  /** Null means an authoritative zero-row query, not lack of permission or a provider error. */
  private fun name(r: JSONObject, uri: Uri): String? {
    val columns = if (r.isNull("tree") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
      arrayOf(OpenableColumns.DISPLAY_NAME, MediaStore.MediaColumns.OWNER_PACKAGE_NAME) else arrayOf(OpenableColumns.DISPLAY_NAME)
    val cursor = resolver.query(uri, columns, null, null, null) ?: unavailable()
    return cursor.use {
      if (!it.moveToFirst()) null else {
        if (columns.size > 1 && it.getString(1) != context.packageName) invalid()
        it.getString(0)
      }
    }
  }
  private fun verified(r: JSONObject) {
    if (r.getBoolean("removed")) invalid()
    val uri = authorized(r); if (name(r, uri) != r.getString("filename")) mismatch()
    val digest = MessageDigest.getInstance("SHA-256"); var size = 0L
    (resolver.openInputStream(uri) ?: unavailable()).use { input ->
      val buffer = ByteArray(256 * 1024)
      while (true) {
        val count = input.read(buffer); if (count < 0) break
        size += count; if (size > r.getLong("bytes")) mismatch(); digest.update(buffer, 0, count)
      }
    }
    val hash = digest.digest().joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
    if (size != r.getLong("bytes") || hash != r.getString("sha256")) mismatch()
  }
  fun publish(source: String, id: String, createdAt: String, hash: String, size: Double, tree: String?): Map<String, Any> {
    val existing = read(id)
    if (existing != null) {
      val r = checked(id, existing.getString("uri"), hash, size)
      if (r.getString("createdAt") != createdAt || (if (r.isNull("tree")) null else r.getString("tree")) != tree) invalid()
      if (r.getBoolean("removed")) invalid()
      // A failed publish may have removed only its own newly inserted URI. Re-create
      // only after an authoritative missing-row query, never after a permission error.
      if (name(r, authorized(r)) != null) {
        verified(r)
        if (r.isNull("tree") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val values = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
          if (resolver.update(authorized(r), values, null, null) != 1) unavailable()
        }
        return mapOf("ok" to true, "uri" to r.getString("uri"), "filename" to r.getString("filename"), "sha256" to hash, "bytes" to size.toLong())
      }
    }
    return Publisher(context).publish(source, id, createdAt, hash, size, tree, true) { uri, filename ->
      write(JSONObject().put("version", 1).put("id", id).put("createdAt", createdAt).put("sha256", hash).put("bytes", size.toLong())
        .put("tree", tree ?: JSONObject.NULL).put("uri", uri.toString()).put("filename", filename).put("removed", false))
    }
  }
  fun verify(id: String, uri: String, hash: String, size: Double) { verified(checked(id, uri, hash, size)) }
  fun remove(id: String, uri: String, hash: String, size: Double) {
    val r = checked(id, uri, hash, size); if (r.getBoolean("removed")) return
    val target = authorized(r)
    if (name(r, target) != null) {
      verified(r)
      val deleted = if (r.isNull("tree")) resolver.delete(target, null, null) == 1 else DocumentsContract.deleteDocument(resolver, target)
      if (!deleted || name(r, target) != null) unavailable()
    }
    write(r.put("removed", true)) // A retry after a successful delete never touches a reused URI.
  }
}
