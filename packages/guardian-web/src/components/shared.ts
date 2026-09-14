import type { GuardianPriority } from "@diana/contracts";

/** Rótulo e cor por prioridade — um só lugar para a UI inteira concordar. */
export const PRIORITY_LABEL: Record<GuardianPriority, string> = {
  alta: "Prioridade alta",
  media: "Prioridade média",
  baixa: "Prioridade baixa",
};

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
