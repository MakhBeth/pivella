import { calcolaContributiPrevidenziali } from '../../../src/lib/utils/forfettario';
import type { Config } from '../../../src/types';
import { emittenteConfigurato, valuteDisponibili } from '../../../src/lib/sync/validate';
import { defineTool, snapshotOf, userIdSchema } from './shared';

/** `Config` senza il logo della fattura di cortesia (13.1, regole generali). */
export function configSenzaLogo(config: Config): Config {
  if (!config.courtesyInvoice) return config;
  const { logoBase64: _logo, logoMimeType: _mime, ...courtesyInvoice } = config.courtesyInvoice;
  return { ...config, courtesyInvoice };
}

export const getConfig = defineTool({
  name: 'get_config',
  title: 'Configurazione fiscale',
  description: 'Configurazione del profilo: regime forfettario (coefficiente, aliquota, ATECO, gestione previdenziale), dati emittente, IBAN, valute. Il logo è escluso. emittenteConfigurato dice se si possono proporre fatture.',
  input: { userId: userIdSchema },
  readOnly: true,
  async handler(ctx, { userId }) {
    const snap = await snapshotOf(ctx, userId);
    const config = snap.config ? configSenzaLogo(snap.config) : null;
    const structured = { config, emittenteConfigurato: emittenteConfigurato(snap.config), valute: valuteDisponibili(snap.config) };
    const text = config
      ? `Config di ${snap.user.nome}: P.IVA ${config.partitaIva || 'non impostata'}, apertura ${config.annoApertura}, ${calcolaContributiPrevidenziali(0, config).label}, emittente ${structured.emittenteConfigurato ? 'configurato' : 'non configurato'}`
      : `Il profilo ${snap.user.nome} non ha ancora una configurazione`;
    return { structured, text };
  },
});
