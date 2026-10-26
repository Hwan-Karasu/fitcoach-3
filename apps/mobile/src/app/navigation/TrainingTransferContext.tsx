import { createContext, useContext } from "react";
import type { TrainingTransferPort } from "../../features/import/public.ts";

export const TrainingTransferContext = createContext<TrainingTransferPort | null>(null);
export function useTrainingTransfer(): TrainingTransferPort {
  const port = useContext(TrainingTransferContext);
  if (!port) throw new Error("Training transfer is not configured");
  return port;
}
