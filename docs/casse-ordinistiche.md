# Previdenza — Pivella 6.1.0 e pivella-mcp 0.2.0

In Impostazioni si selezionano la gestione, la cassa e l’anno dei contributi. Importo annuo e contributi deducibili versati sono manuali e salvati separatamente per cassa e anno. Dashboard, Scadenze e riepilogo MCP usano il proprio anno di riferimento; il Simulatore usa quello corrente. Nel Simulatore si possono cambiare gestione, cassa, contributi annui e quota deducibile per una prova locale, senza salvare le modifiche nel profilo. Aliquote, minimi, agevolazioni e calendario della cassa non sono automatizzati.

Una configurazione mancante genera un avviso di stima incompleta nell’app e nel riepilogo MCP. Zero esplicito è un valore valido, diverso da un campo vuoto. Le scadenze non possono essere salvate o rigenerate con configurazione della cassa incompleta o importo deducibile non valido.

Nel campo dei contributi versati di Scadenze, `0` indica ora una deduzione pari a zero anche per INPS (prima era trattato come campo vuoto). Un input non valido mostra un errore e usa temporaneamente la deduzione configurata nella sola anteprima; il salvataggio è bloccato. Cambiando anno, gestione o cassa viene azzerato l’override locale.

Il riepilogo MCP include `contributiDeducibili`, `entePrevidenziale` e `avvisi`; `get_config` restituisce anche nel testo il nome della cassa.

## Compatibilità

Per usare le casse professionali, aggiornare l’app a Pivella 6.1.0 e il server a pivella-mcp 0.2.0. Le versioni precedenti non riconoscono `cassa_ordinistica` e possono applicare erroneamente il calcolo INPS Gestione Separata. Per la verifica locale avviare il server MCP dal checkout aggiornato (`npm run mcp`); aggiornare anche le altre installazioni dell’app che leggono lo stesso file di sincronizzazione. Questa modifica non impone un blocco remoto alle vecchie installazioni.

## Default e guida alla previdenza

Per Artigiani e Commercianti l’importo vuoto nelle Impostazioni attiva il calcolo automatico per gli anni 2025 e 2026. Il modello considera un titolare iscritto per l’intero anno, minimale, aliquota sulla quota eccedente, maggiorazione di un punto oltre la prima fascia e massimale individuale (selettore dell’anzianità anteriore al 1996). La riduzione del 35% è facoltativa e lascia invariata la maternità di €7,44. L’importo personalizzato già presente continua a prevalere, con riduzione della sola parte diversa dalla maternità.

Per periodi inferiori all’anno, riduzione nuovi iscritti 2025, pensionati over 65, affittacamere e altre situazioni particolari, la UI rimanda al simulatore ufficiale INPS e permette un importo personalizzato. Gli anni senza parametri generano un avviso e non possono produrre scadenze salvate finché manca un importo verificato. Il calendario automatico resta limitato a imposta sostitutiva e Gestione Separata.

Fonti: circolari INPS 38/2025 e 14/2026 (collegate nella UI e in `src/lib/constants/previdenza.ts`); per la maternità non ridotta, messaggio INPS 1947/2017: https://servizi2.inps.it/servizi/Bussola/VisualizzaDoc.aspx?sVirtualURL=%2FMessaggi%2FMessaggio+numero+1947+del+10-05-2017.htm

La Gestione Separata offre un selettore tra sola copertura (26,07%) e pensione/altra copertura obbligatoria (24%), con link alla circolare 8/2026. Sono aliquote per liberi professionisti ordinari; i casi sportivi sono rinviati alla fonte ufficiale. Le casse professionali restano manuali, con link al sito dell’ente e guida al reperimento di prospetto contributivo e attestazione fiscale. I nuovi selettori delle Impostazioni fanno parte della config esportata/sincronizzata; le prove nel Simulatore restano locali.
