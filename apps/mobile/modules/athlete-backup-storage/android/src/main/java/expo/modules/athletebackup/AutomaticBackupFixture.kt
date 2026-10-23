package expo.modules.athletebackup

import android.content.Context
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.system.Os
import java.io.File
import java.util.UUID
import org.json.JSONObject

/** Debug-only fault injection. A fresh private marker and fixed UUID directory are
 * mandatory. Never recursively deletes directories or operates on the real backup folder. */
@Suppress("DEPRECATION")
internal class AutomaticBackupFixture(private val context: Context) {
  private val uuid = Regex("^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$")
  private fun requireFixture(value: Boolean) { if (!value) throw PublicationFailure("BACKUP_PUBLICATION_INVALID") }
  private fun guard() {
    requireFixture(context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
  }
  private val markers get() = File(context.filesDir, "r06-automatic-fixtures")
  private fun target(token: String): File {
    guard(); requireFixture(uuid.matches(token))
    val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).canonicalFile
    val file = File(downloads, "R06-ATLD-test-$token").canonicalFile
    requireFixture(file.parentFile == downloads && file.name == "R06-ATLD-test-$token")
    return file
  }
  fun directory(token: String): File {
    val file = target(token); val marker = File(markers, token)
    requireFixture(marker.isFile && marker.length() == token.length.toLong() && marker.readText() == token)
    return file
  }
  fun create(): String {
    guard(); val token = UUID.randomUUID().toString(); val file = target(token)
    requireFixture(!file.exists() && file.mkdir())
    requireFixture(markers.isDirectory || markers.mkdirs())
    val marker = File(markers, token); requireFixture(marker.createNewFile()); marker.writeText(token)
    return token
  }
  fun removeFile(token: String, id: String, staleRow: Boolean): String {
    val folder = directory(token); requireFixture(uuid.matches(id))
    val receipt = JSONObject(File(context.filesDir, "automatic-publications/$id.json").readText())
    val uri = Uri.parse(receipt.getString("uri")); requireFixture(receipt.getString("id") == id && receipt.isNull("tree"))
    AutomaticPublications(context).verify(id, uri.toString(), receipt.getString("sha256"), receipt.getLong("bytes").toDouble())
    val columns = arrayOf(MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.OWNER_PACKAGE_NAME, MediaStore.MediaColumns.DATA)
    val cursor = context.contentResolver.query(uri, columns, null, null, null) ?: throw PublicationFailure("BACKUP_DESTINATION_UNAVAILABLE")
    val expected = File(folder, receipt.getString("filename")).canonicalFile
    requireFixture(expected.parentFile == folder)
    cursor.use {
      requireFixture(it.moveToFirst() && it.getString(0) == "${Environment.DIRECTORY_DOWNLOADS}/${folder.name}/" &&
        it.getString(1) == context.packageName && File(it.getString(2)).canonicalFile == expected)
    }
    if (staleRow) Os.remove(expected.path)
    else requireFixture(context.contentResolver.delete(uri, null, null) == 1)
    requireFixture(!expected.exists())
    val remaining = context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns._ID), null, null, null)
      ?: throw PublicationFailure("BACKUP_DESTINATION_UNAVAILABLE")
    val rowPresent = remaining.use { it.moveToFirst() }
    if (!staleRow) requireFixture(!rowPresent)
    // Do not tombstone the native receipt: the production inspector must discover absence.
    return if (rowPresent) "ROW_PRESENT" else "ROW_ABSENT"
  }
  fun removeDirectory(token: String) {
    val file = directory(token)
    requireFixture(file.isDirectory && file.list()?.isEmpty() == true && file.delete() && !file.exists())
  }
}
