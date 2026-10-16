import { EmptyPanel, PrototypeNotice, PrototypeScreen } from "./ScreenPieces.tsx";

export function WorkspaceRoutePreview({ context }: Readonly<{ context: string }>) {
  return (
    <PrototypeScreen description={context}>
      <PrototypeNotice>
        Этот раздел пока не подключён к сохранённым данным клиента. Показатели и действия не имитируются.
      </PrototypeNotice>
      <EmptyPanel
        title="Данные пока не подключены"
        body="Раздел получит реальные сведения после реализации локального хранилища и клиентских сценариев."
      />
    </PrototypeScreen>
  );
}
