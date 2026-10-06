import type { EmittenteConfig, NuovaFatturaRiga } from '../../types';

export interface FatturaXMLData {
  emittente: EmittenteConfig;
  partitaIva: string;
  cliente: {
    denominazione?: string;
    nome?: string;
    cognome?: string;
    partitaIva?: string;
    codiceFiscale?: string;
    indirizzo?: string;
    numeroCivico?: string;
    cap?: string;
    comune?: string;
    provincia?: string;
    nazione: string;
  };
  numero: string;
  data: string; // YYYY-MM-DD
  righe: NuovaFatturaRiga[]; // Amounts in original currency
  iban?: string;
  bic?: string;
  beneficiario?: string;
  // Multi-currency support
  valuta?: string; // ISO 4217 code (e.g. "GBP"). Omit or "EUR" for euro invoices.
  tassoCambio?: number; // ECB rate: 1 EUR = X foreign currency
  dataCambio?: string; // Date of the ECB rate (YYYY-MM-DD)
}

// I campi testo dell'XSD FatturaPA (String*LatinType) ammettono solo Basic Latin
// e Latin-1 Supplement: la punteggiatura tipografica diventa l'equivalente ASCII,
// il resto fuori range diventa '?' perché lo SdI scarterebbe il file.
const LATIN1_SOSTITUZIONI: Array<[RegExp, string]> = [
  [/[\u2010-\u2015\u2212]/g, '-'],
  [/[\u2018\u2019\u201A\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u2033]/g, '"'],
  [/\u2026/g, '...'],
  [/\u20AC/g, 'EUR'],
  [/\u2022/g, '-'],
  [/[\u2000-\u200A\u202F\u205F]/g, ' '],
  [/[\u200B-\u200D\u2060\uFEFF]/g, ''],
];

function toLatin1(text: string): string {
  let out = text.normalize('NFC');
  for (const [re, sub] of LATIN1_SOSTITUZIONI) out = out.replace(re, sub);
  return Array.from(out, (ch) => (ch.codePointAt(0)! > 0xff ? '?' : ch)).join('');
}

// Escape caratteri speciali XML
function escapeXml(text: string | undefined | null): string {
  if (text == null) return '';
  return toLatin1(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Formatta numero con 2 decimali
function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

// Genera progressivo invio (5 caratteri alfanumerici)
function generateProgressivoInvio(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateFatturaXML(data: FatturaXMLData): string {
  const { emittente, partitaIva, cliente, numero, data: dataFattura, righe, iban, bic, beneficiario } = data;

  const isMultiCurrency = data.valuta && data.valuta !== 'EUR' && data.tassoCambio;
  const tassoCambio = data.tassoCambio || 1;

  // Converte importo da valuta estera a EUR (se necessario)
  const toEUR = (amount: number) => isMultiCurrency ? amount / tassoCambio : amount;

  // Calcola totali in EUR (per SDI, gli importi DEVONO essere in EUR - Art. 21 DPR 633/72)
  const totaleImponibileValuta = righe.reduce((sum, r) => sum + (r.quantita * r.prezzoUnitario), 0);
  const totaleImponibileEUR = toEUR(totaleImponibileValuta);
  const bolloImporto = totaleImponibileEUR > 77.47 ? 2.00 : 0;
  const totaleDocumentoEUR = totaleImponibileEUR;

  const progressivoInvio = generateProgressivoInvio();

  // Genera linee dettaglio (importi in EUR per SDI)
  // Se multi-valuta, aggiunge AltriDatiGestionali con importi originali
  const lineeXml = righe.map((riga, index) => {
    const prezzoTotaleValuta = riga.quantita * riga.prezzoUnitario;
    const prezzoUnitarioEUR = toEUR(riga.prezzoUnitario);
    const prezzoTotaleEUR = toEUR(prezzoTotaleValuta);

    const altriDatiXml = isMultiCurrency ? `
        <AltriDatiGestionali>
          <TipoDato>VALUTA</TipoDato>
          <RiferimentoTesto>${data.valuta} - Importo originale: ${formatAmount(prezzoTotaleValuta)}</RiferimentoTesto>
          <RiferimentoNumero>${formatAmount(prezzoTotaleValuta)}</RiferimentoNumero>
          <RiferimentoData>${data.dataCambio || dataFattura}</RiferimentoData>
        </AltriDatiGestionali>` : '';

    return `      <DettaglioLinee>
        <NumeroLinea>${index + 1}</NumeroLinea>
        <Descrizione>${escapeXml(riga.descrizione)}</Descrizione>
        <Quantita>${formatAmount(riga.quantita)}</Quantita>
        <PrezzoUnitario>${formatAmount(prezzoUnitarioEUR)}</PrezzoUnitario>
        <PrezzoTotale>${formatAmount(prezzoTotaleEUR)}</PrezzoTotale>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N2.2</Natura>${altriDatiXml}
      </DettaglioLinee>`;
  }).join('\n');

  // Sezione bollo (solo se > 77.47€ di imponibile EUR)
  const bolloXml = bolloImporto > 0 ? `
        <DatiBollo>
          <BolloVirtuale>SI</BolloVirtuale>
          <ImportoBollo>${formatAmount(bolloImporto)}</ImportoBollo>
        </DatiBollo>` : '';

  // Causale con info cambio valuta (se multi-valuta)
  const causaleXml = isMultiCurrency
    ? `
        <Causale>Importi convertiti in EUR al cambio BCE del ${data.dataCambio || dataFattura}: 1 EUR = ${tassoCambio} ${data.valuta}. Totale in ${data.valuta}: ${formatAmount(totaleImponibileValuta)}</Causale>`
    : '';

  // Sezione cliente - determina se usare Denominazione o Nome/Cognome
  const clienteAnagrafica = cliente.denominazione
    ? `<Denominazione>${escapeXml(cliente.denominazione)}</Denominazione>`
    : `<Nome>${escapeXml(cliente.nome || '')}</Nome>
          <Cognome>${escapeXml(cliente.cognome || '')}</Cognome>`;

  // ID Fiscale cliente
  const clienteIdFiscale = cliente.partitaIva
    ? `<IdFiscaleIVA>
          <IdPaese>${cliente.nazione}</IdPaese>
          <IdCodice>${escapeXml(cliente.partitaIva)}</IdCodice>
        </IdFiscaleIVA>`
    : '';

  const clienteCF = cliente.codiceFiscale && cliente.nazione === 'IT'
    ? `<CodiceFiscale>${escapeXml(cliente.codiceFiscale)}</CodiceFiscale>`
    : '';

  // Sezione pagamento (ImportoPagamento in EUR per SDI)
  const pagamentoXml = iban ? `
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <Beneficiario>${escapeXml(beneficiario || `${emittente.nome} ${emittente.cognome}`)}</Beneficiario>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <DataRiferimentoTerminiPagamento>${dataFattura}</DataRiferimentoTerminiPagamento>
        <DataScadenzaPagamento>${dataFattura}</DataScadenzaPagamento>
        <ImportoPagamento>${formatAmount(totaleDocumentoEUR)}</ImportoPagamento>
        <IBAN>${escapeXml(iban)}</IBAN>${bic ? `
        <BIC>${escapeXml(bic)}</BIC>` : ''}
      </DettaglioPagamento>
    </DatiPagamento>` : '';

  // Divisa è sempre EUR per SDI (Art. 21 DPR 633/72)
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns2:FatturaElettronica versione="FPR12" xmlns:ns2="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${escapeXml(emittente.codiceFiscale)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${progressivoInvio}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>0000000</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${escapeXml(partitaIva)}</IdCodice>
        </IdFiscaleIVA>
        <CodiceFiscale>${escapeXml(emittente.codiceFiscale)}</CodiceFiscale>
        <Anagrafica>
          <Nome>${escapeXml(emittente.nome)}</Nome>
          <Cognome>${escapeXml(emittente.cognome)}</Cognome>
        </Anagrafica>
        <RegimeFiscale>RF19</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(emittente.indirizzo)}</Indirizzo>
        <NumeroCivico>${escapeXml(emittente.numeroCivico)}</NumeroCivico>
        <CAP>${escapeXml(emittente.cap)}</CAP>
        <Comune>${escapeXml(emittente.comune)}</Comune>
        <Provincia>${escapeXml(emittente.provincia)}</Provincia>
        <Nazione>${escapeXml(emittente.nazione || 'IT')}</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        ${clienteIdFiscale}
        ${clienteCF}
        <Anagrafica>
          ${clienteAnagrafica}
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(cliente.indirizzo || '')}</Indirizzo>
        ${cliente.numeroCivico ? `<NumeroCivico>${escapeXml(cliente.numeroCivico)}</NumeroCivico>` : ''}
        <CAP>${escapeXml(cliente.cap || '')}</CAP>
        <Comune>${escapeXml(cliente.comune || '')}</Comune>
        ${cliente.provincia ? `<Provincia>${escapeXml(cliente.provincia)}</Provincia>` : ''}
        <Nazione>${cliente.nazione}</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${dataFattura}</Data>
        <Numero>${escapeXml(numero)}</Numero>${bolloXml}
        <ImportoTotaleDocumento>${formatAmount(totaleDocumentoEUR)}</ImportoTotaleDocumento>${causaleXml}
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
${lineeXml}
      <DatiRiepilogo>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N2.2</Natura>
        <ImponibileImporto>${formatAmount(totaleImponibileEUR)}</ImponibileImporto>
        <Imposta>0.00</Imposta>
      </DatiRiepilogo>
    </DatiBeniServizi>${pagamentoXml}
  </FatturaElettronicaBody>
</ns2:FatturaElettronica>
`;

  return xml;
}

// Genera nome file standard FatturaPA: IT{PIVA}_{progressivo}.xml
export function generateFileName(partitaIva: string, progressivo: string): string {
  return `IT${partitaIva}_${progressivo}.xml`;
}

// Download XML come file
export function downloadXML(xml: string, filename: string): void {
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Dati parsati da XML esistente
export interface ParsedFatturaXML {
  numero: string;
  data: string;
  cliente: {
    denominazione?: string;
    nome?: string;
    cognome?: string;
    partitaIva?: string;
    codiceFiscale?: string;
    indirizzo?: string;
    numeroCivico?: string;
    cap?: string;
    comune?: string;
    provincia?: string;
    nazione: string;
  };
  righe: NuovaFatturaRiga[];
}

// Helper per estrarre testo da tag XML
function getXmlText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

// Helper per estrarre sezione XML
function getXmlSection(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[0] : '';
}

// Parse XML FatturaPA esistente
export function parseFatturaXMLForEdit(xmlContent: string): ParsedFatturaXML | null {
  try {
    // Estrai dati generali documento
    const datiGenerali = getXmlSection(xmlContent, 'DatiGeneraliDocumento');
    const numero = getXmlText(datiGenerali, 'Numero');
    const data = getXmlText(datiGenerali, 'Data');

    // Estrai cliente (CessionarioCommittente)
    const cessionario = getXmlSection(xmlContent, 'CessionarioCommittente');
    const anagraficaCliente = getXmlSection(cessionario, 'Anagrafica');
    const sedeCliente = getXmlSection(cessionario, 'Sede');
    const idFiscaleCliente = getXmlSection(cessionario, 'IdFiscaleIVA');

    const cliente = {
      denominazione: getXmlText(anagraficaCliente, 'Denominazione') || undefined,
      nome: getXmlText(anagraficaCliente, 'Nome') || undefined,
      cognome: getXmlText(anagraficaCliente, 'Cognome') || undefined,
      partitaIva: getXmlText(idFiscaleCliente, 'IdCodice') || undefined,
      codiceFiscale: getXmlText(cessionario, 'CodiceFiscale') || undefined,
      indirizzo: getXmlText(sedeCliente, 'Indirizzo') || undefined,
      numeroCivico: getXmlText(sedeCliente, 'NumeroCivico') || undefined,
      cap: getXmlText(sedeCliente, 'CAP') || undefined,
      comune: getXmlText(sedeCliente, 'Comune') || undefined,
      provincia: getXmlText(sedeCliente, 'Provincia') || undefined,
      nazione: getXmlText(sedeCliente, 'Nazione') || getXmlText(idFiscaleCliente, 'IdPaese') || 'IT',
    };

    // Estrai righe (DettaglioLinee)
    const righe: NuovaFatturaRiga[] = [];
    const dettaglioLineeRegex = /<DettaglioLinee>([\s\S]*?)<\/DettaglioLinee>/gi;
    let match;
    while ((match = dettaglioLineeRegex.exec(xmlContent)) !== null) {
      const lineaXml = match[1];
      righe.push({
        descrizione: getXmlText(lineaXml, 'Descrizione'),
        quantita: parseFloat(getXmlText(lineaXml, 'Quantita')) || 1,
        prezzoUnitario: parseFloat(getXmlText(lineaXml, 'PrezzoUnitario')) || 0,
      });
    }

    return {
      numero,
      data,
      cliente,
      righe: righe.length > 0 ? righe : [{ descrizione: '', quantita: 1, prezzoUnitario: 0 }],
    };
  } catch (error) {
    console.error('Errore parsing XML:', error);
    return null;
  }
}
