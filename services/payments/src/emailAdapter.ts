import { randomUUID } from 'node:crypto';
import { Logger } from 'pino';

export interface WeeklyEmailMessage {
  avisoId: string;
  codigoFuncionario: string;
  emailDestino: string;
  semanaInicio: string;
  semanaFin: string;
  valesDisponibles: number;
  valesUsados: number;
  valesNoUsados: number;
}

export interface EmailDispatchResult {
  accepted: boolean;
  providerMode: string;
  providerMessageId: string;
  summary: string;
}

/**
 * Adaptador de correo externo (modo sandbox verificable para entorno academico).
 * Preserva contrato y auditoria sin exponer credenciales reales ni requerir SMTP externo.
 */
export class EmailSandboxAdapter {
  private readonly mode: string;

  constructor(private readonly logger: Logger) {
    this.mode = process.env.EMAIL_PROVIDER_MODE || 'sandbox';
  }

  public async sendWeeklySummary(msg: WeeklyEmailMessage, correlationId?: string): Promise<EmailDispatchResult> {
    const hasConfiguredKey = Boolean(process.env.EMAIL_API_KEY);
    const messageId = `sbx-${randomUUID().slice(0, 12)}`;

    this.logger.info(
      {
        correlationId,
        providerMode: this.mode,
        hasConfiguredKey,
        avisoId: msg.avisoId,
        codigoFuncionario: msg.codigoFuncionario,
        valesDisponibles: msg.valesDisponibles,
        valesUsados: msg.valesUsados,
        valesNoUsados: msg.valesNoUsados,
        providerMessageId: messageId
      },
      'EmailSandboxAdapter: aviso semanal despachado en modo sandbox'
    );

    return {
      accepted: true,
      providerMode: this.mode,
      providerMessageId: messageId,
      summary: `SANDBOX_OK:${messageId} (disp=${msg.valesDisponibles}, usados=${msg.valesUsados}, no_usados=${msg.valesNoUsados})`
    };
  }
}
