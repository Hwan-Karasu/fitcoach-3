# Archived dev migrations

These are the 63 pre-baseline migration steps, with data-object names normalized by removing `dev_` in D01-2. They are reference fixtures, not runtime catalogs.

`scripts/d01/BaselineSchema.ts` uses them to generate the eleven baseline files and verify schema equivalence. Historical data tests still run their original upgrade steps, then import the result into a fresh baseline database before reading it through current repositories.

Runtime `Dev*Catalog.ts` files export the matching generated baseline. Future runtime schema changes need new migration versions; changing this archive does not migrate an installed database. Do not rewrite an old migration ledger to make it look like a baseline ledger.
