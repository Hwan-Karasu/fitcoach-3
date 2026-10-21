/** Клиент, которому можно назначить программу или мезоцикл (только поля отображения, из владельца Clients). */
export interface TrainingParticipantCandidate {
  readonly id: string;
  readonly displayName: string;
}
