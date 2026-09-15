// Parametri per titolari iscritti per l'intero anno. Fonti INPS consultate il 15/09/2026.
export const INPS_SIMULATORE_URL = 'https://servizi2.inps.it/servizi/SimulatoreImportiDovuti';
export const INPS_GS_URL = 'https://www.inps.it/it/it/inps-comunica/notizie/dettaglio-news-page.news.2026.02.gestione-separata-le-aliquote-contributive-per-il-2026.html';
export const INPS_AC_PARAMS: Record<number, { minimo: number; soglia: number; massimale: number; massimaleAnte1996: number; fonte: string }> = {
  2025: { minimo: 18555, soglia: 55448, massimale: 120607, massimaleAnte1996: 92413,
    fonte: 'https://www.inps.it/content/dam/inps-site/it/scorporati/circolari-e-messaggi/2025/02/Circolare_14820/Allegati/15892_Circolare-numero-38-del-07-02-2025.pdf' },
  2026: { minimo: 18808, soglia: 56224, massimale: 122295, massimaleAnte1996: 93707,
    fonte: 'https://www.inps.it/content/dam/inps-site/it/scorporati/circolari-e-messaggi/2026/02/Circolare_15162/Allegati/16561_Circolare-numero-14-del-09-02-2026.pdf' },
};

export const CASSE_SITI: Record<import('../../types').CassaOrdinisticaId, string> = {
  forense: 'https://www.cassaforense.it/', geometri: 'https://www.cassageometri.it/',
  notariato: 'https://cassanotariato.it/', cnpadc: 'https://www.cnpadc.it/', cnpr: 'https://www.cassaragionieri.it/',
  enpab: 'https://www.enpab.it/', enpacl: 'https://www.enpacl.it/', enpaf: 'https://www.enpaf.it/',
  enpaia_agrotecnici: 'https://www.enpaia.it/', enpaia_periti_agrari: 'https://www.enpaia.it/',
  enpam: 'https://www.enpam.it/', enpap: 'https://www.enpap.it/', enpapi: 'https://www.enpapi.it/',
  enpav: 'https://www.enpav.it/', epap: 'https://epap.it/', eppi: 'https://www.eppi.it/',
  inarcassa: 'https://www.inarcassa.it/', inpgi: 'https://www.inpgi.it/',
  altra: 'https://www.adepp.info/la-nostra-storia/i-nostri-associati/',
};
