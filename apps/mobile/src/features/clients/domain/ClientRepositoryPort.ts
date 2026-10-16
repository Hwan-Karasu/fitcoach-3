export interface ClientRecord {
  readonly id: string;
  readonly displayName: string;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly birthDate: string | null;
  readonly heightCmX10: number | null;
  readonly emoji: string | null;
  readonly lifecycle: "ACTIVE" | "ARCHIVED";
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface CreateClientInput {
  readonly displayName: string;
  readonly contactPhone?: string;
  readonly contactEmail?: string;
  readonly birthDate?: string | null;
  readonly heightCmX10?: number | null;
  readonly emoji?: string | null;
}

export interface ClientRepositoryPort {
  list(lifecycle: ClientRecord["lifecycle"]): Promise<readonly ClientRecord[]>;
  get(id: string): Promise<ClientRecord | null>;
  create(input: CreateClientInput): Promise<ClientRecord>;
  update(id: string, expectedRevision: number, input: CreateClientInput): Promise<ClientRecord>;
  setArchived(id: string, expectedRevision: number, archived: boolean): Promise<ClientRecord>;
}
