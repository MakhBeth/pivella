import { useState } from "react";
import {
  LayoutDashboard,
  FileText,
  Calendar,
  FilePlus,
  CalendarClock,
  Calculator,
  Settings,
  Check,
  X,
} from '../shared/icons';
import type { IconComponent } from '../shared/icons';
import styles from "./Guida.module.css";

export const GUIDE_DISMISSED_KEY = "pivella-guide-dismissed";

interface GuidaProps {
  onDismiss: () => void;
}

interface PageSection {
  icon: IconComponent;
  color: string;
  title: string;
  text: string;
}

const PAGE_SECTIONS: PageSection[] = [
  {
    icon: LayoutDashboard,
    color: "var(--accent-primary)",
    title: "Dashboard",
    text: "Il colpo d'occhio sull'anno: quanto hai fatturato, quanto hai incassato, quanto sei vicino alla soglia dei 85.000€ del forfettario e una stima di tasse e contributi da accantonare. È la pagina da guardare quando ti chiedi \"come sto andando?\".",
  },
  {
    icon: FileText,
    color: "var(--accent-green)",
    title: "Fatture",
    text: "Qui vivono le tue fatture. Puoi caricarle una alla volta, in blocco o direttamente dallo ZIP del cassetto fiscale: Pivella legge l'XML della fattura elettronica e si compila da sola. Per ogni fattura tieni traccia della data di incasso, che nel forfettario è quella che conta davvero (principio di cassa!).",
  },
  {
    icon: Calendar,
    color: "var(--accent-orange)",
    title: "Calendario",
    text: "Registra le giornate o le ore lavorate per ciascun cliente. Ideale per i freelance che lavorano in time & material: a fine mese sai esattamente quanto fatturare a chi, senza andare a ripescare appunti sparsi.",
  },
  {
    icon: FilePlus,
    color: "var(--accent-blue)",
    title: "Fattura di Cortesia",
    text: "Genera un PDF \"di cortesia\" da mandare al cliente: la fattura elettronica vera passa dallo SDI, ma un PDF leggibile da allegare alla mail fa sempre comodo. Scegli fattura e lingua, e il PDF è pronto.",
  },
  {
    icon: CalendarClock,
    color: "var(--accent-red)",
    title: "Scadenze",
    text: "Le scadenze fiscali calcolate sui tuoi numeri: acconti, saldi, contributi INPS. Niente più \"quanto devo mettere da parte per giugno?\": lo vedi qui, con le date e gli importi stimati.",
  },
  {
    icon: Calculator,
    color: "var(--text-primary)",
    title: "Simulatore",
    text: "Vuoi sapere cosa succede se quest'anno fatturi di più (o di meno)? Il simulatore ti fa giocare con i numeri: inserisci un fatturato ipotetico e vedi subito tasse, contributi e netto stimato.",
  },
  {
    icon: Settings,
    color: "var(--accent-green)",
    title: "Impostazioni",
    text: "I tuoi dati (P.IVA, codice ATECO, coefficiente di redditività), la gestione di più utenti e, importantissimo, il backup: i dati stanno solo sul tuo computer, quindi esporta il backup ogni tanto e mettilo al sicuro.",
  },
];

const INTERVIEW: Array<{ question: string; answer: string }> = [
  {
    question: "Perché nasce Pivella?",
    answer:
      "Ciao, sono Davide 👋. Qualche anno fa ho aperto la partita IVA e mi sono ritrovato con la classica domanda da forfettario: \"ok, ma quanto devo mettere da parte?\". Ho cercato un'app decente per gestirmi: o erano gestionali mastodontici pensati per le aziende, o costavano un abbonamento per farmi due moltiplicazioni, o volevano tutti i miei dati su qualche server chissà dove. Alla fine ho fatto quello che fa ogni sviluppatore testardo: me la sono costruita da solo. Prima era un foglio di calcolo, poi il foglio è cresciuto, e alla fine è diventato Pivella. La condivido perché sospetto di non essere l'unico ad essersi fatto quella domanda.",
  },
  {
    question: "Ma è a pagamento?",
    answer:
      "No. Pivella è open source e gratis per tutti. Non ci sono server: vive tutta sul tuo computer, nel browser. Pensala come un file Excel evoluto, che però conosce il regime forfettario. Forse un domani potrebbero esserci funzionalità a pagamento, ad esempio se arrivasse un collegamento diretto con l'Agenzia delle Entrate, ma giusto per coprire i costi vivi dei server (qualche centesimo a fattura), onde evitare che qualcuno si faccia le proprie operazioni aggratis usando i miei soldi. Tutto quello che vedi oggi resta gratuito.",
  },
];

export function Guida({ onDismiss }: GuidaProps) {
  const [alreadyDismissed] = useState(
    () => localStorage.getItem(GUIDE_DISMISSED_KEY) === "true",
  );

  const handleDismiss = () => {
    localStorage.setItem(GUIDE_DISMISSED_KEY, "true");
    onDismiss();
  };

  let revealIndex = 0;
  const reveal = () =>
    ({ "--reveal-i": revealIndex++ }) as React.CSSProperties;

  return (
    <>
      <div className={`card ${styles.hero} ${styles.reveal}`} style={reveal()}>
        <div className={styles.heroDecor} aria-hidden="true" />
        <h1 className={styles.heroTitle}>
          Ciao da Piv<em>ell</em>a
        </h1>
        <p className={styles.heroText}>
          Pivella è un'app per gestire la tua partita IVA in regime
          forfettario: carichi le fatture, segni gli incassi, e lei ti dice
          quanto stai guadagnando, quante tasse dovrai pagare e quando. Tutto
          qui. Niente registrazioni, niente cloud: i dati restano sul tuo
          computer.
        </p>
        {alreadyDismissed ? (
          <button
            className={`btn btn-ghost ${styles.heroAction}`}
            onClick={() => {
              window.location.hash = "#/impostazioni";
            }}
          >
            <X size={18} aria-hidden="true" /> Chiudi la guida
          </button>
        ) : (
          <button
            className={`btn btn-ghost ${styles.heroAction}`}
            onClick={handleDismiss}
          >
            <X size={18} aria-hidden="true" /> Salta, non mostrare più
          </button>
        )}
      </div>

      <h2 className={`${styles.sectionLabel} ${styles.reveal}`} style={reveal()}>
        Le pagine, una per una
      </h2>

      <div className="grid-2">
        {PAGE_SECTIONS.map(({ icon: Icon, color, title, text }) => (
          <div
            key={title}
            className={`card ${styles.pageCard} ${styles.reveal}`}
            style={{ ...reveal(), "--chip-color": color } as React.CSSProperties}
          >
            <div className={styles.cardHead}>
              <span className={styles.chip}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <h2>{title}</h2>
            </div>
            <p>{text}</p>
          </div>
        ))}
      </div>

      <h2 className={`${styles.sectionLabel} ${styles.reveal}`} style={reveal()}>
        Due parole con chi l'ha fatta
      </h2>

      <div className={`card ${styles.reveal}`} style={reveal()}>
        <div className={styles.chatThread}>
          {INTERVIEW.map(({ question, answer }) => (
            <div key={question} className={styles.chatCard}>
              <div className={styles.question}>{question}</div>
              <div className={styles.answer}>
                <span className={styles.avatar} aria-hidden="true">
                  D
                </span>
                <p className={styles.answerBubble}>{answer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!alreadyDismissed && (
        <div
          className={`card ${styles.dismissCard} ${styles.reveal}`}
          style={reveal()}
        >
          <button className="btn btn-primary" onClick={handleDismiss}>
            <Check size={18} aria-hidden="true" /> Ho capito, non mostrare più
          </button>
          <p className={styles.dismissHint}>
            Potrai sempre ritrovare questa guida in Impostazioni.
          </p>
        </div>
      )}
    </>
  );
}
