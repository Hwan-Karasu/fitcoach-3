/** D01-2: runtime catalog; the 63-step dev history is archived under scripts/d01/history. */
import { clientsBaseline } from "./ClientsBaseline.generated.ts";
import { immutableScope } from "../../../shared/db/SchemaGuards.ts";
export const devClientCatalog = [...clientsBaseline, { version: 2, checksum: "d01-clients-v2-owner-20261022",
  statements: [immutableScope("clients", ["id", "workspace_id"])] }];
export const DEV_CLIENTS_LEDGER = "clients_schema_migrations";
