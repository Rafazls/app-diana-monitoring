/**
 * Ponte para os tipos de visão do contrato compartilhado.
 *
 * Eles saíram daqui para `@diana/contracts` porque a web precisa exatamente dos
 * mesmos tipos que esta API devolve. O restante do serviço segue importando
 * `../domain/viewTypes.js` normalmente.
 */
export type {
  AlertSummary,
  AlertView,
  AlertViewExplanation,
  AlertViewSignal,
  FeedbackRecord,
  FeedbackVerdict,
  GuardianPriority,
  GuardianSettings,
  GuardianSettingsItem,
  GuardianSettingsSection,
} from "@diana/contracts";
