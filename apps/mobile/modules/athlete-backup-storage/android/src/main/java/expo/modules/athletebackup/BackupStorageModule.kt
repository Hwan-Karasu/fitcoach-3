package expo.modules.athletebackup

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Publication only: source is an already verified immutable private snapshot, never LIVE.
 * No storage-wide permissions, imported paths or overwrites. Automatic retention requires
 * a separate installation-private native ownership receipt; manual files are ineligible.
 * All exceptions crossing the JS boundary have fixed content-free codes.
 */
class BackupStorageModule : Module() {
  private val automaticLock = Any()
  override fun definition() = ModuleDefinition {
    Name("AthleteBackupStorage")

    Function("supportsDownloads") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q }
    Function("automaticProtocolVersion") { 2 }
    AsyncFunction("createAutomaticFixture") Coroutine { ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) { AutomaticBackupFixture(context).create() } }
    }
    AsyncFunction("armAutomaticFixtureReceipt") Coroutine { token: String, id: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) { AutomaticBackupFixture(context).armReceipt(token, id); true } }
    }
    AsyncFunction("disarmAutomaticFixtureReceipt") Coroutine { token: String, id: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) { AutomaticBackupFixture(context).disarmReceipt(token, id); true } }
    }
    AsyncFunction("automaticFixturePublication") Coroutine { token: String, id: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) { AutomaticBackupFixture(context).publication(token, id) } }
    }
    AsyncFunction("publishAutomaticFixture") Coroutine { source: String, id: String, createdAt: String, hash: String, size: Double, token: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) {
        AutomaticPublications(context, AutomaticBackupFixture(context).directory(token).name).publish(source, id, createdAt, hash, size, null)
      } }
    }
    AsyncFunction("removeAutomaticFixtureFile") Coroutine { token: String, id: String, staleRow: Boolean ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) { AutomaticBackupFixture(context).removeFile(token, id, staleRow) } }
    }
    AsyncFunction("removeAutomaticFixtureDirectory") Coroutine { token: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) { AutomaticBackupFixture(context).removeDirectory(token); true } }
    }
    AsyncFunction("inspectAutomatic") Coroutine { backupId: String, uri: String, sha256: String, bytes: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) {
        try { AutomaticPublications(context).inspect(backupId, uri, sha256, bytes) }
        catch (error: CancellationException) { throw error }
        catch (error: PublicationFailure) { if (error.failureCode == "BACKUP_VERIFICATION_FAILED") "INVALID" else "UNAVAILABLE" }
        catch (_: Exception) { "UNAVAILABLE" }
      } }
    }

    AsyncFunction("publishAutomatic") Coroutine { sourceUri: String, backupId: String, createdAt: String,
      sha256: String, bytes: Double, treeUri: String? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) {
        try { AutomaticPublications(context).publish(sourceUri, backupId, createdAt, sha256, bytes, treeUri) }
        catch (error: CancellationException) { throw error }
        catch (error: PublicationFailure) { mapOf("ok" to false, "code" to error.failureCode) }
        catch (_: Exception) { mapOf("ok" to false, "code" to "BACKUP_DESTINATION_UNAVAILABLE") }
      } }
    }
    AsyncFunction("verifyAutomatic") Coroutine { backupId: String, uri: String, sha256: String, bytes: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) {
        try { AutomaticPublications(context).verify(backupId, uri, sha256, bytes); true }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { false }
      } }
    }
    AsyncFunction("removeAutomatic") Coroutine { backupId: String, uri: String, sha256: String, bytes: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) { synchronized(automaticLock) {
        try { AutomaticPublications(context).remove(backupId, uri, sha256, bytes); true }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { false }
      } }
    }

    AsyncFunction("publish") Coroutine { sourceUri: String, backupId: String, createdAt: String,
      expectedSha256: String, expectedBytes: Double, treeUri: String? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        try {
          Publisher(context).publish(sourceUri, backupId, createdAt, expectedSha256, expectedBytes, treeUri)
        } catch (error: CancellationException) {
          throw error
        } catch (error: PublicationFailure) {
          mapOf("ok" to false, "code" to error.failureCode)
        } catch (_: Exception) {
          mapOf("ok" to false, "code" to "BACKUP_DESTINATION_UNAVAILABLE")
        }
      }
    }
  }
}

internal class PublicationFailure(val failureCode: String) : Exception(failureCode)
private fun invalid(): Nothing = throw PublicationFailure("BACKUP_PUBLICATION_INVALID")
private fun unavailable(): Nothing = throw PublicationFailure("BACKUP_DESTINATION_UNAVAILABLE")
private fun mismatch(): Nothing = throw PublicationFailure("BACKUP_VERIFICATION_FAILED")

internal class Publisher(private val context: Context, private val downloadsFolder: String = "Дневник атлета") {
  private val resolver: ContentResolver get() = context.contentResolver

  fun publish(sourceUri: String, backupId: String, createdAt: String, expectedHash: String,
    expectedSize: Double, treeUri: String?, automatic: Boolean = false,
    record: ((Uri, String) -> Unit)? = null): Map<String, Any> {
    if (!Regex("^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$").matches(backupId) ||
      !Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$").matches(createdAt) ||
      !Regex("^[a-f0-9]{64}$").matches(expectedHash) || !expectedSize.isFinite() ||
      expectedSize < 100 || expectedSize > 9007199254740991.0 || expectedSize.toLong().toDouble() != expectedSize) invalid()
    val sourceLocation = URI(sourceUri)
    if (sourceLocation.scheme != "file" || sourceLocation.query != null || sourceLocation.fragment != null) invalid()
    val source = File(sourceLocation).canonicalFile
    if (!source.path.startsWith(context.filesDir.canonicalPath + File.separator) ||
      !source.name.endsWith(".atbackup") || !source.isFile || source.length() != expectedSize.toLong()) invalid()
    source.inputStream().use { input ->
      val header = ByteArray(16)
      if (input.read(header) != header.size || !header.contentEquals("SQLite format 3\u0000".toByteArray(Charsets.US_ASCII))) invalid()
    }
    verify(source.inputStream(), expectedHash, expectedSize.toLong())
    val stamp = createdAt.take(19).replace("-", "").replace(":", "").replace("T", "-")
    val filename = "athlete-diary-${if (automatic) "auto-" else ""}$stamp-$backupId.atbackup"
    return if (treeUri == null) publishDownloads(source, filename, expectedHash, expectedSize.toLong(), record)
      else publishDocument(source, filename, Uri.parse(treeUri), expectedHash, expectedSize.toLong(), record)
  }

  private fun publishDownloads(source: File, filename: String, hash: String, size: Long, record: ((Uri, String) -> Unit)?): Map<String, Any> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw PublicationFailure("BACKUP_LOCATION_UNSUPPORTED")
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
      put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream")
      put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/$downloadsFolder/")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values) ?: unavailable()
    var completed = false
    try {
      writeVerified(source, uri, hash, size)
      record?.invoke(uri, filename) // Ownership receipt precedes public visibility.
      // Until this update, other apps cannot see a partially written backup.
      val publish = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
      if (resolver.update(uri, publish, null, null) != 1) unavailable()
      verify(resolver.openInputStream(uri) ?: unavailable(), hash, size)
      if (displayName(uri) != filename) mismatch()
      completed = true
      return mapOf("ok" to true, "uri" to uri.toString(), "filename" to filename, "bytes" to size, "sha256" to hash)
    } finally {
      // This URI was returned by OUR insert, never obtained by scanning old backups.
      if (!completed) runCatching { resolver.delete(uri, null, null) }
    }
  }

  private fun publishDocument(source: File, filename: String, tree: Uri, hash: String, size: Long, record: ((Uri, String) -> Unit)?): Map<String, Any> {
    if (tree.scheme != "content" || !DocumentsContract.isTreeUri(tree)) invalid()
    if (resolver.persistedUriPermissions.none { it.uri == tree && it.isReadPermission && it.isWritePermission }) unavailable()
    val directory = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    if ((documentFlags(directory) and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) == 0) unavailable()
    // Expo File.rename uses java.io.File and cannot rename a SAF document.
    var created = DocumentsContract.createDocument(resolver, directory, "application/octet-stream", "$filename.partial") ?: unavailable()
    var completed = false
    try {
      if ((documentFlags(created) and DocumentsContract.Document.FLAG_SUPPORTS_RENAME) == 0) {
        throw PublicationFailure("BACKUP_LOCATION_UNSUPPORTED")
      }
      writeVerified(source, created, hash, size)
      created = DocumentsContract.renameDocument(resolver, created, filename) ?: unavailable()
      verify(resolver.openInputStream(created) ?: unavailable(), hash, size)
      if (displayName(created) != filename) mismatch()
      record?.invoke(created, filename)
      completed = true
      return mapOf("ok" to true, "uri" to created.toString(), "filename" to filename, "bytes" to size, "sha256" to hash)
    } finally {
      // A failed new copy must never remove any earlier user-selected document.
      if (!completed) runCatching { DocumentsContract.deleteDocument(resolver, created) }
    }
  }

  private fun writeVerified(source: File, uri: Uri, hash: String, size: Long) {
    val descriptor = resolver.openFileDescriptor(uri, "rwt") ?: unavailable()
    ParcelFileDescriptor.AutoCloseOutputStream(descriptor).use { output ->
      source.inputStream().use { input -> input.copyTo(output, 256 * 1024) }
      output.flush()
      output.fd.sync()
    }
    verify(resolver.openInputStream(uri) ?: unavailable(), hash, size)
  }

  private fun verify(input: InputStream, hash: String, size: Long) {
    val digest = MessageDigest.getInstance("SHA-256")
    var count = 0L
    input.use {
      val buffer = ByteArray(256 * 1024)
      while (true) {
        val read = it.read(buffer)
        if (read < 0) break
        count += read
        if (count > size) mismatch()
        digest.update(buffer, 0, read)
      }
    }
    val actual = digest.digest().joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
    if (count != size || actual != hash) mismatch()
  }

  private fun displayName(uri: Uri): String? = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
    if (it.moveToFirst()) it.getString(0) else null
  }

  private fun documentFlags(uri: Uri): Int = resolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_FLAGS), null, null, null)?.use {
    if (it.moveToFirst()) it.getInt(0) else 0
  } ?: 0
}
