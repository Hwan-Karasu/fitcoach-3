import { runMigrations } from "../../../shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../../../shared/db/SharedSqliteDatabase.ts";
import { UUID_V4_SQL } from "../../../shared/db/SqlIds.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../../../shared/db/WriterCoordinator.ts";
import type { AccountingMode, AppointmentCreditState, BookingCreditContext, ClientAccountingSnapshot,
  CreditScope, LedgerEntry, NewPackInput, NewPaymentInput, PackBalance, PaymentRecord, ReconcileResult,
  SessionPack } from "../domain/AccountingModel.ts";
import type { AccountingCommittedChange, AccountingRepositoryPort } from "../domain/AccountingRepositoryPort.ts";
import { choosePack, validatePack, validatePayment } from "../domain/AccountingRules.ts";
import { DEV_ACCOUNTING_LEDGER, devAccountingCatalog } from "./DevAccountingCatalog.ts";

interface PackRow {
  id: string; title: string; creditScope: CreditScope; sessionTypeId: string | null;
  sessionTypeName: string | null; grantedCount: number; totalKopeks: number; expiresOn: string | null;
  createdAt: string; ledgerBalance: number; reserved: number; paidKopeks: number;
}

/** Booking seen by Calendar; structurally matches the Calendar hook contract. */
interface Booking {
  readonly clientId: string | null;
  readonly sessionTypeId: string;
  readonly requiresCredit: boolean;
  readonly bypass: boolean;
  readonly localDate: string;
  readonly endMinute: number;
}

function localParts(at: Date): Readonly<{ today: string; minute: number }> {
  return {
    today: `${String(at.getFullYear()).padStart(4, "0")}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`,
    minute: at.getHours() * 60 + at.getMinutes(),
  };
}

async function newId(tx: SqliteStatementPort): Promise<string> {
  const id = (await tx.first<{ id: string }>(UUID_V4_SQL))?.id;
  if (!id) throw new Error("ACCOUNTING_ID_UNAVAILABLE");
  return id;
}

async function modeOf(tx: SqliteStatementPort, workspaceId: string,
  clientId: string): Promise<Readonly<{ mode: AccountingMode; inherited: boolean }>> {
  const own = await tx.first<{ mode: AccountingMode }>(`SELECT mode FROM dev_client_accounting
    WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
  if (own !== null) return { mode: own.mode, inherited: false };
  const fallback = await tx.first<{ default_mode: AccountingMode }>(`SELECT default_mode
    FROM dev_accounting_settings WHERE workspace_id = ?`, [workspaceId]);
  return { mode: fallback?.default_mode ?? "UNTRACKED", inherited: true };
}

async function packRows(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<readonly PackRow[]> {
  return tx.all<PackRow>(`SELECT p.id, p.title, p.credit_scope AS creditScope,
      p.session_type_id AS sessionTypeId, p.session_type_name AS sessionTypeName,
      p.granted_count AS grantedCount, p.total_kopeks AS totalKopeks, p.expires_on AS expiresOn,
      p.created_at AS createdAt,
      COALESCE((SELECT sum(l.delta) FROM dev_credit_ledger AS l WHERE l.pack_id = p.id), 0) AS ledgerBalance,
      (SELECT count(*) FROM dev_credit_reservations AS r WHERE r.pack_id = p.id) AS reserved,
      COALESCE((SELECT sum(m.amount_kopeks) FROM dev_payment_records AS m WHERE m.pack_id = p.id), 0) AS paidKopeks
    FROM dev_session_packs AS p WHERE p.workspace_id = ? AND p.client_id = ?
    ORDER BY p.created_at, p.id`, [workspaceId, clientId]);
}

async function unreturnedUsed(tx: SqliteStatementPort,
  appointmentId: string): Promise<{ id: string; clientId: string; packId: string } | null> {
  return tx.first(`SELECT u.id, u.client_id AS clientId, u.pack_id AS packId FROM dev_credit_ledger AS u
    WHERE u.appointment_id = ? AND u.entry_type = 'USED' AND NOT EXISTS (
      SELECT 1 FROM dev_credit_ledger AS r WHERE r.source_entry_id = u.id AND r.entry_type = 'RETURNED')`,
  [appointmentId]);
}

/** Exactly one effective USED per appointment: generation-keyed and checked before insert. */
async function insertUsed(tx: SqliteStatementPort, workspaceId: string, clientId: string, packId: string,
  appointmentId: string, now: string): Promise<void> {
  if (await unreturnedUsed(tx, appointmentId) !== null) throw new Error("ACCOUNTING_ALREADY_SETTLED");
  const generation = (await tx.first<{ n: number }>(`SELECT count(*) AS n FROM dev_credit_ledger
    WHERE appointment_id = ? AND entry_type = 'USED'`, [appointmentId]))?.n ?? 0;
  await tx.run(`INSERT INTO dev_credit_ledger (id, workspace_id, client_id, pack_id, appointment_id,
      source_entry_id, entry_type, delta, reason, operation_key, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, 'USED', -1, NULL, ?, ?)`,
  [await newId(tx), workspaceId, clientId, packId, appointmentId, `used:${appointmentId}:${generation}`, now]);
}

async function insertReturned(tx: SqliteStatementPort, workspaceId: string,
  used: { id: string; clientId: string; packId: string }, appointmentId: string, now: string): Promise<void> {
  await tx.run(`INSERT INTO dev_credit_ledger (id, workspace_id, client_id, pack_id, appointment_id,
      source_entry_id, entry_type, delta, reason, operation_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'RETURNED', 1, NULL, ?, ?)`,
  [await newId(tx), workspaceId, used.clientId, used.packId, appointmentId, used.id,
    `returned:${used.id}`, now]);
}

/**
 * Calendar side of CalendarAccountingWorkflow (§22.1.4). Runs inside Calendar's transaction;
 * the composition root wires it into the Calendar store.
 */
export const devAccountingCalendarHook = {
  async plan(tx: SqliteStatementPort, workspaceId: string, booking: Booking): Promise<string | null> {
    if (booking.clientId === null || !booking.requiresCredit || booking.bypass) return null;
    if ((await modeOf(tx, workspaceId, booking.clientId)).mode !== "FITCOACH") return null;
    const packs = await packRows(tx, workspaceId, booking.clientId);
    const chosen = choosePack(packs.map((pack) => ({ ...pack, available: pack.ledgerBalance - pack.reserved })),
      booking.sessionTypeId, localParts(new Date()).today);
    if (chosen === null) throw new Error("ACCOUNTING_INSUFFICIENT_CREDIT");
    return chosen.id;
  },
  async reserve(tx: SqliteStatementPort, workspaceId: string, appointmentId: string, booking: Booking,
    packId: string): Promise<void> {
    if (booking.clientId === null) throw new Error("ACCOUNTING_RESERVATION_INVALID");
    await tx.run(`INSERT INTO dev_credit_reservations
      (appointment_id, workspace_id, client_id, pack_id, ends_on, ends_minute, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [appointmentId, workspaceId, booking.clientId, packId, booking.localDate, booking.endMinute,
      new Date().toISOString()]);
  },
  async release(tx: SqliteStatementPort, workspaceId: string, appointmentId: string): Promise<void> {
    if (await unreturnedUsed(tx, appointmentId) !== null) throw new Error("ACCOUNTING_ALREADY_SETTLED");
    await tx.run("DELETE FROM dev_credit_reservations WHERE workspace_id = ? AND appointment_id = ?",
      [workspaceId, appointmentId]);
  },
  async move(tx: SqliteStatementPort, workspaceId: string, appointmentId: string, booking: Booking): Promise<void> {
    await tx.run(`UPDATE dev_credit_reservations SET ends_on = ?, ends_minute = ?
      WHERE workspace_id = ? AND appointment_id = ?`,
    [booking.localDate, booking.endMinute, workspaceId, appointmentId]);
  },
  async cancel(tx: SqliteStatementPort, workspaceId: string, appointmentId: string,
    settlement: "RETURN" | "CHARGE", now: string): Promise<void> {
    const reservation = await tx.first<{ clientId: string; packId: string }>(`SELECT client_id AS clientId,
      pack_id AS packId FROM dev_credit_reservations WHERE workspace_id = ? AND appointment_id = ?`,
    [workspaceId, appointmentId]);
    if (reservation !== null) {
      if (settlement === "CHARGE") {
        await insertUsed(tx, workspaceId, reservation.clientId, reservation.packId, appointmentId, now);
      }
      await tx.run("DELETE FROM dev_credit_reservations WHERE workspace_id = ? AND appointment_id = ?",
        [workspaceId, appointmentId]);
      return;
    }
    const used = await unreturnedUsed(tx, appointmentId);
    // An already charged session keeps its single USED on CHARGE; RETURN compensates it.
    if (used !== null && settlement === "RETURN") await insertReturned(tx, workspaceId, used, appointmentId, now);
  },
  async settle(tx: SqliteStatementPort, workspaceId: string, appointmentId: string, now: string): Promise<void> {
    await devAccountingCalendarHook.cancel(tx, workspaceId, appointmentId, "CHARGE", now);
  },
  async correct(tx: SqliteStatementPort, workspaceId: string, appointmentId: string, booking: Booking,
    now: string): Promise<void> {
    await tx.run("DELETE FROM dev_credit_reservations WHERE workspace_id = ? AND appointment_id = ?",
      [workspaceId, appointmentId]);
    // The original USED is never edited; a linked RETURNED compensates it (§22.1.4).
    const used = await unreturnedUsed(tx, appointmentId);
    if (used !== null) await insertReturned(tx, workspaceId, used, appointmentId, now);
    const packId = await devAccountingCalendarHook.plan(tx, workspaceId, booking);
    if (packId !== null && booking.clientId !== null) {
      await insertUsed(tx, workspaceId, booking.clientId, packId, appointmentId, now);
    }
  },
  async restore(tx: SqliteStatementPort, workspaceId: string, appointmentId: string, booking: Booking,
    charge: boolean, now: string): Promise<void> {
    const packId = await devAccountingCalendarHook.plan(tx, workspaceId, booking);
    if (packId === null || booking.clientId === null) return;
    // The cancel left a linked RETURNED, so a new USED brings the effective charge back to one.
    if (charge) await insertUsed(tx, workspaceId, booking.clientId, packId, appointmentId, now);
    else await devAccountingCalendarHook.reserve(tx, workspaceId, appointmentId, booking, packId);
  },
};

const ownedTables = ["dev_credit_reservations", "dev_payment_records", "dev_credit_ledger",
  "dev_session_packs", "dev_client_accounting"] as const;

/** Accounting side of PermanentlyDeleteArchivedClient (§15.7): packs, ledger, reservations, payments. */
export const devAccountingClientDeletionParticipant = {
  owner: "accounting.client",
  tables: [...ownedTables, "dev_accounting_purge"] as const,
  async count(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<number> {
    let total = 0;
    for (const table of ownedTables) {
      total += (await tx.first<{ n: number }>(`SELECT count(*) AS n FROM ${table}
        WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]))?.n ?? 0;
    }
    return total;
  },
  async detach(tx: SqliteStatementPort, workspaceId: string, clientId: string): Promise<void> {
    await tx.run("INSERT INTO dev_accounting_purge (client_id) VALUES (?)", [clientId]);
    // RETURNED rows reference USED rows of the same client, so they go first.
    await tx.run(`DELETE FROM dev_credit_ledger WHERE workspace_id = ? AND client_id = ?
      AND source_entry_id IS NOT NULL`, [workspaceId, clientId]);
    for (const table of ownedTables) {
      await tx.run(`DELETE FROM ${table} WHERE workspace_id = ? AND client_id = ?`, [workspaceId, clientId]);
    }
    await tx.run("DELETE FROM dev_accounting_purge WHERE client_id = ?", [clientId]);
  },
};

/** Explicitly dev-only new-install store sharing the clients/calendar dev file. */
export class DevAccountingRepository implements AccountingRepositoryPort {
  private connection: SqliteConnectionPort | null = null;
  private writer: WriterCoordinator | null = null;
  private opening: Promise<void> | null = null;
  private readonly database: SharedSqliteDatabase;
  private readonly workspaceId: string;
  private readonly listeners = new Set<(change: AccountingCommittedChange) => void>();

  constructor(database: SharedSqliteDatabase | (() => Promise<SqliteConnectionPort>), workspaceId: string) {
    this.database = database instanceof SharedSqliteDatabase ? database : new SharedSqliteDatabase(database);
    this.workspaceId = workspaceId;
  }

  /** Clients and Calendar stores must initialize first: this schema references their tables. */
  initialize(): Promise<void> {
    if (this.connection !== null) return Promise.resolve();
    if (this.opening !== null) return this.opening;
    const opening = this.openAndMigrate();
    this.opening = opening;
    void opening.finally(() => { if (this.opening === opening) this.opening = null; })
      .catch(() => undefined);
    return opening;
  }

  private async openAndMigrate(): Promise<void> {
    if (!this.workspaceId.trim()) throw new Error("ACCOUNTING_WORKSPACE_REQUIRED");
    const { connection, writer } = await this.database.acquire();
    try {
      await runMigrations(writer, devAccountingCatalog, DEV_ACCOUNTING_LEDGER);
      await writer.write(async (tx) => {
        await tx.run("INSERT OR IGNORE INTO dev_accounting_settings (workspace_id) VALUES (?)", [this.workspaceId]);
        await tx.run("DELETE FROM dev_accounting_purge");
      });
      this.connection = connection;
      this.writer = writer;
    } catch (error) {
      await this.database.release();
      throw error;
    }
  }

  private ready(): { connection: SqliteConnectionPort; writer: WriterCoordinator } {
    if (this.connection === null || this.writer === null) throw new Error("ACCOUNTING_STORE_NOT_READY");
    return { connection: this.connection, writer: this.writer };
  }

  subscribeCommittedChanges(listener: (change: AccountingCommittedChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Calendar commands change reservations inside their own transactions. */
  notifyExternalChange(): void { this.publish({ clientIds: "ALL" }); }

  private publish(change: AccountingCommittedChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* Observers cannot turn a commit into a failure. */ }
    }
  }

  async getClientSnapshot(clientId: string): Promise<ClientAccountingSnapshot> {
    const { connection } = this.ready();
    const [mode, rows, ledger, payments] = await Promise.all([
      modeOf(connection, this.workspaceId, clientId),
      packRows(connection, this.workspaceId, clientId),
      connection.all<LedgerEntry>(`SELECT id, pack_id AS packId, appointment_id AS appointmentId,
        source_entry_id AS sourceEntryId, entry_type AS entryType, delta, reason, created_at AS createdAt
        FROM dev_credit_ledger WHERE workspace_id = ? AND client_id = ?
        ORDER BY created_at DESC, rowid DESC`, [this.workspaceId, clientId]),
      connection.all<PaymentRecord>(`SELECT id, pack_id AS packId, amount_kopeks AS amountKopeks,
        paid_on AS paidOn, method, note, created_at AS createdAt FROM dev_payment_records
        WHERE workspace_id = ? AND client_id = ? ORDER BY paid_on DESC, created_at DESC`,
      [this.workspaceId, clientId]),
    ]);
    const packs: PackBalance[] = rows.map((row) => ({
      pack: { id: row.id, title: row.title, creditScope: row.creditScope, sessionTypeId: row.sessionTypeId,
        sessionTypeName: row.sessionTypeName, grantedCount: row.grantedCount, totalKopeks: row.totalKopeks,
        expiresOn: row.expiresOn, createdAt: row.createdAt },
      ledgerBalance: row.ledgerBalance, reserved: row.reserved,
      available: row.ledgerBalance - row.reserved, paidKopeks: row.paidKopeks,
    }));
    return {
      mode: mode.mode, inheritedMode: mode.inherited, packs,
      available: packs.reduce((sum, pack) => sum + Math.max(pack.available, 0), 0),
      reserved: packs.reduce((sum, pack) => sum + pack.reserved, 0),
      ledger, payments,
    };
  }

  async setClientMode(clientId: string, mode: AccountingMode | null): Promise<void> {
    if (mode !== null && !["FITCOACH", "EXTERNAL", "UNTRACKED"].includes(mode)) {
      throw new Error("ACCOUNTING_MODE_INVALID");
    }
    await this.ready().writer.write(async (tx) => {
      if (mode === null) {
        await tx.run("DELETE FROM dev_client_accounting WHERE workspace_id = ? AND client_id = ?",
          [this.workspaceId, clientId]);
      } else {
        await tx.run(`INSERT INTO dev_client_accounting (workspace_id, client_id, mode) VALUES (?, ?, ?)
          ON CONFLICT(workspace_id, client_id) DO UPDATE SET mode = excluded.mode`,
        [this.workspaceId, clientId, mode]);
      }
      // Leaving FITCOACH releases open reservations; past USED facts stay in the ledger.
      if ((await modeOf(tx, this.workspaceId, clientId)).mode !== "FITCOACH") {
        await tx.run("DELETE FROM dev_credit_reservations WHERE workspace_id = ? AND client_id = ?",
          [this.workspaceId, clientId]);
      }
    });
    this.publish({ clientIds: [clientId] });
  }

  async createPack(clientId: string, input: NewPackInput): Promise<SessionPack> {
    const valid = validatePack(input);
    const created = await this.ready().writer.write(async (tx) => {
      if (valid.sessionTypeId !== null) {
        const type = await tx.first<{ requiresCredit: number }>(`SELECT requires_credit AS requiresCredit
          FROM dev_session_types WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
        [this.workspaceId, valid.sessionTypeId]);
        if (type?.requiresCredit !== 1) throw new Error("ACCOUNTING_PACK_SCOPE_INVALID");
      }
      const id = await newId(tx);
      const now = new Date().toISOString();
      await tx.run(`INSERT INTO dev_session_packs (id, workspace_id, client_id, title, credit_scope,
          session_type_id, session_type_name, granted_count, total_kopeks, expires_on, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, this.workspaceId, clientId, valid.title, valid.creditScope, valid.sessionTypeId,
        valid.sessionTypeName, valid.grantedCount, valid.totalKopeks, valid.expiresOn, now]);
      await tx.run(`INSERT INTO dev_credit_ledger (id, workspace_id, client_id, pack_id, appointment_id,
          source_entry_id, entry_type, delta, reason, operation_key, created_at)
        VALUES (?, ?, ?, ?, NULL, NULL, 'ISSUED', ?, NULL, ?, ?)`,
      [await newId(tx), this.workspaceId, clientId, id, valid.grantedCount, `issued:${id}`, now]);
      return { id, title: valid.title, creditScope: valid.creditScope, sessionTypeId: valid.sessionTypeId,
        sessionTypeName: valid.sessionTypeName, grantedCount: valid.grantedCount,
        totalKopeks: valid.totalKopeks, expiresOn: valid.expiresOn, createdAt: now };
    });
    this.publish({ clientIds: [clientId] });
    return created;
  }

  async recordPayment(clientId: string, input: NewPaymentInput): Promise<void> {
    const valid = validatePayment(input);
    await this.ready().writer.write(async (tx) => {
      await tx.run(`INSERT INTO dev_payment_records (id, workspace_id, client_id, pack_id, amount_kopeks,
          paid_on, method, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [await newId(tx), this.workspaceId, clientId, valid.packId, valid.amountKopeks, valid.paidOn,
        valid.method, valid.note, new Date().toISOString()]);
    });
    this.publish({ clientIds: [clientId] });
  }

  async adjust(clientId: string, packId: string, delta: number, reason: string): Promise<void> {
    const why = reason.trim();
    if (!Number.isSafeInteger(delta) || delta === 0 || !why) throw new Error("ACCOUNTING_ADJUSTMENT_INVALID");
    await this.ready().writer.write(async (tx) => {
      const pack = (await packRows(tx, this.workspaceId, clientId)).find((row) => row.id === packId);
      if (pack === undefined) throw new Error("ACCOUNTING_ADJUSTMENT_INVALID");
      // A correction never hides a negative balance or an already reserved credit.
      if (pack.ledgerBalance - pack.reserved + delta < 0) throw new Error("ACCOUNTING_INSUFFICIENT_CREDIT");
      const id = await newId(tx);
      await tx.run(`INSERT INTO dev_credit_ledger (id, workspace_id, client_id, pack_id, appointment_id,
          source_entry_id, entry_type, delta, reason, operation_key, created_at)
        VALUES (?, ?, ?, ?, NULL, NULL, 'ADJUSTMENT', ?, ?, ?, ?)`,
      [id, this.workspaceId, clientId, packId, delta, why, `adjustment:${id}`, new Date().toISOString()]);
    });
    this.publish({ clientIds: [clientId] });
  }

  async bookingContext(clientId: string, sessionTypeId: string,
    requiresCredit: boolean): Promise<BookingCreditContext> {
    if (!requiresCredit) return { kind: "NOT_REQUIRED" };
    const { connection } = this.ready();
    const { mode } = await modeOf(connection, this.workspaceId, clientId);
    if (mode !== "FITCOACH") return { kind: "NOT_TRACKED", mode };
    const today = localParts(new Date()).today;
    const available = (await packRows(connection, this.workspaceId, clientId))
      .filter((pack) => (pack.expiresOn === null || pack.expiresOn >= today)
        && (pack.creditScope === "GENERAL" || pack.sessionTypeId === sessionTypeId))
      .reduce((sum, pack) => sum + Math.max(pack.ledgerBalance - pack.reserved, 0), 0);
    return available > 0 ? { kind: "AVAILABLE", available } : { kind: "NONE_AVAILABLE" };
  }

  async appointmentCredit(appointmentId: string): Promise<AppointmentCreditState> {
    const { connection } = this.ready();
    const reserved = await connection.first<{ x: number }>(`SELECT 1 AS x FROM dev_credit_reservations
      WHERE workspace_id = ? AND appointment_id = ?`, [this.workspaceId, appointmentId]);
    if (reserved !== null) return "RESERVED";
    if (await unreturnedUsed(connection, appointmentId) !== null) return "USED";
    const any = await connection.first<{ x: number }>(`SELECT 1 AS x FROM dev_credit_ledger
      WHERE appointment_id = ? LIMIT 1`, [appointmentId]);
    return any === null ? "NONE" : "RETURNED";
  }

  async reconcileDue(now: Date): Promise<ReconcileResult> {
    const { today, minute } = localParts(now);
    const stamp = now.toISOString();
    const settled = await this.ready().writer.write(async (tx) => {
      const due = await tx.all<{ appointmentId: string; clientId: string; packId: string }>(`SELECT
          appointment_id AS appointmentId, client_id AS clientId, pack_id AS packId
        FROM dev_credit_reservations WHERE workspace_id = ?
          AND (ends_on < ? OR (ends_on = ? AND ends_minute <= ?))
        ORDER BY ends_on, ends_minute, appointment_id`, [this.workspaceId, today, today, minute]);
      let count = 0;
      for (const row of due) {
        if (await unreturnedUsed(tx, row.appointmentId) === null) {
          await insertUsed(tx, this.workspaceId, row.clientId, row.packId, row.appointmentId, stamp);
          count += 1;
        }
        await tx.run("DELETE FROM dev_credit_reservations WHERE workspace_id = ? AND appointment_id = ?",
          [this.workspaceId, row.appointmentId]);
      }
      return count;
    });
    if (settled > 0) this.publish({ clientIds: "ALL" });
    return { settled };
  }

  async close(): Promise<void> {
    if (this.opening !== null) await this.opening.catch(() => undefined);
    if (this.connection === null) return;
    this.connection = null;
    this.writer = null;
    await this.database.release();
  }
}
