export interface ClientFormDraft {
  readonly displayName: string;
  readonly contactPhone: string;
  readonly contactEmail: string;
  readonly birthDate: string;
  readonly heightDraft: string;
  readonly emoji: string | null;
}

export interface ClientRecoveryDraft {
  readonly id: string;
  readonly clientId: string | null;
  readonly mode: "create" | "edit";
  readonly baseClientRevision: number | null;
  readonly questionnaireRevision: null;
  readonly draftSchemaVersion: 1;
  readonly updatedAt: string;
  readonly formData: ClientFormDraft;
  readonly questionnaireAnswers: readonly [];
}

export interface ClientRecoveryDraftPort {
  loadDraft(clientId: string | null): Promise<ClientRecoveryDraft | null>;
  saveDraft(input: Readonly<{
    clientId: string | null;
    baseClientRevision: number | null;
    formData: ClientFormDraft;
  }>): Promise<ClientRecoveryDraft>;
  discardDraft(clientId: string | null): Promise<void>;
}
