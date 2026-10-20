export interface ClientRecord {
  readonly id: string;
  readonly displayName: string;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly birthDate: string | null;
  readonly heightCmX10: number | null;
  /** Пол для расчёта КБЖУ; `null` — не указан. */
  readonly sex?: "MALE" | "FEMALE" | null;
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
  /** `undefined` при правке сохраняет прежнее значение, `null` очищает. */
  readonly sex?: "MALE" | "FEMALE" | null;
  readonly emoji?: string | null;
}

export interface ClientRepositoryPort {
  list(lifecycle: ClientRecord["lifecycle"]): Promise<readonly ClientRecord[]>;
  get(id: string): Promise<ClientRecord | null>;
  create(input: CreateClientInput): Promise<ClientRecord>;
  update(id: string, expectedRevision: number, input: CreateClientInput): Promise<ClientRecord>;
  setArchived(id: string, expectedRevision: number, archived: boolean): Promise<ClientRecord>;
  /**
   * Правка только пола и роста (расчёт КБЖУ): остальные поля карточки не затрагиваются, revision растёт, несохранённый черновик редактора карточки не удаляется.
   * Устаревшая revision — `CLIENT_STALE_OR_WRONG_SCOPE`.
   */
  updateBody(id: string, expectedRevision: number, patch: Readonly<{ sex: "MALE" | "FEMALE" | null; heightCmX10: number | null }>): Promise<ClientRecord>;
}
