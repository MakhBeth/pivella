import { useState, lazy, Suspense, useRef, useEffect, useCallback } from "react";
import {
  Settings,
  FileText,
  LayoutDashboard,
  Calendar,
  Download,
  Upload,
  Github,
  FilePlus,
  CalendarClock,
  Calculator,
  MoreHorizontal,
} from "lucide-react";
import { AppProvider, useApp } from "../context/AppContext";
import { Toast } from "./shared/Toast";
import { LoadingSpinner } from "./shared/LoadingSpinner";
import { useDesignStyle } from "./shared/DesignStyleSwitch";
import { UserSelector } from "./shared/UserSelector";
import { parseFatturaXML, extractXmlFromZip } from "../lib/utils/xmlParsing";
import { processBatchXmlFiles } from "../lib/utils/batchImport";
import {
  extractEmittenteFromXml,
  autoPopulateConfig,
} from "../lib/utils/configAutoPopulate";
import type { Cliente, Fattura, ImportSummary, WorkLog } from "../types";
import { MISC_CLIENT_ID } from "../types";
import { useRoute, type Route } from "../hooks/useRoute";
import "../styles/theme.css";

// Lazy load pages
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const FatturePage = lazy(() =>
  import("./pages/Fatture").then((m) => ({ default: m.FatturePage })),
);
const Calendario = lazy(() =>
  import("./pages/Calendario").then((m) => ({ default: m.Calendario })),
);
const Impostazioni = lazy(() =>
  import("./pages/Impostazioni").then((m) => ({ default: m.Impostazioni })),
);
const FatturaCortesia = lazy(() =>
  import("./pages/FatturaCortesia").then((m) => ({
    default: m.FatturaCortesia,
  })),
);
const Scadenze = lazy(() =>
  import("./pages/Scadenze").then((m) => ({ default: m.Scadenze })),
);
const Simulatore = lazy(() =>
  import("./pages/Simulatore").then((m) => ({ default: m.Simulatore })),
);
const Guida = lazy(() =>
  import("./pages/Guida").then((m) => ({ default: m.Guida })),
);

// Lazy load modals
const UploadFatturaModal = lazy(() =>
  import("./modals/UploadFatturaModal").then((m) => ({
    default: m.UploadFatturaModal,
  })),
);
const BatchUploadModal = lazy(() =>
  import("./modals/BatchUploadModal").then((m) => ({
    default: m.BatchUploadModal,
  })),
);
const UploadZipModal = lazy(() =>
  import("./modals/UploadZipModal").then((m) => ({
    default: m.UploadZipModal,
  })),
);
const ImportSummaryModal = lazy(() =>
  import("./modals/ImportSummaryModal").then((m) => ({
    default: m.ImportSummaryModal,
  })),
);
const AddClienteModal = lazy(() =>
  import("./modals/AddClienteModal").then((m) => ({
    default: m.AddClienteModal,
  })),
);
const EditClienteModal = lazy(() =>
  import("./modals/EditClienteModal").then((m) => ({
    default: m.EditClienteModal,
  })),
);
const AddWorkLogModal = lazy(() =>
  import("./modals/AddWorkLogModal").then((m) => ({
    default: m.AddWorkLogModal,
  })),
);
const EditWorkLogModal = lazy(() =>
  import("./modals/EditWorkLogModal").then((m) => ({
    default: m.EditWorkLogModal,
  })),
);
const ImportBackupModal = lazy(() =>
  import("./modals/ImportBackupModal").then((m) => ({
    default: m.ImportBackupModal,
  })),
);
const EditDataIncassoModal = lazy(() =>
  import("./modals/EditDataIncassoModal").then((m) => ({
    default: m.EditDataIncassoModal,
  })),
);
const CourtesyInvoiceModal = lazy(() =>
  import("./modals/CourtesyInvoiceModal").then((m) => ({
    default: m.CourtesyInvoiceModal,
  })),
);
const ManageServicesModal = lazy(() =>
  import("./modals/ManageServicesModal").then((m) => ({
    default: m.ManageServicesModal,
  })),
);
const NuovaFatturaModal = lazy(() =>
  import("./modals/NuovaFatturaModal").then((m) => ({
    default: m.NuovaFatturaModal,
  })),
);
const ScadenzaDetailModal = lazy(() =>
  import("./modals/ScadenzaDetailModal").then((m) => ({
    default: m.ScadenzaDetailModal,
  })),
);
const CalendarDayModal = lazy(() =>
  import("./modals/CalendarDayModal").then((m) => ({
    default: m.CalendarDayModal,
  })),
);

function ForfettarioAppInner() {
  const {
    toast,
    exportData,
    importData,
    clienti,
    fatture,
    showToast,
    addCliente,
    addFattura,
    addWorkLog,
    updateCliente,
    updateFattura,
    updateWorkLog,
    config,
    setConfig,
  } = useApp();

  // Initialize design style on app load
  useDesignStyle();

  // MISC virtual client for non-billable work (conferences, maintenance, etc.)
  const miscClient: Cliente = { id: MISC_CLIENT_ID, userId: '', nome: '🔧 Misc', billingUnit: 'ore', rate: 0, color: '#8b5cf6' };
  const clientiWithMisc = [...clienti, miscClient];

  const { currentRoute: currentPage, navigate: setCurrentPage } = useRoute();

  // First launch: show the guide once, unless the user already dismissed it
  // or landed on a specific route via deep link
  useEffect(() => {
    const dismissed = localStorage.getItem("pivella-guide-dismissed") === "true";
    const landedOnDefault = window.location.hash.replace(/^#\/?/, "") === "";
    if (!dismissed && landedOnDefault) {
      setCurrentPage("guida");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showModal, setShowModal] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [annoSelezionato, setAnnoSelezionato] = useState<number>(
    new Date().getFullYear(),
  );

  const [newCliente, setNewCliente] = useState<Partial<Cliente>>({
    nome: "",
    piva: "",
    email: "",
  });
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null);
  const [editingFattura, setEditingFattura] = useState<Fattura | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null,
  );
  const [newWorkLog, setNewWorkLog] = useState<Partial<WorkLog>>({
    clienteId: "",
    quantita: undefined,
    tipo: "ore",
    note: "",
  });
  const [editingWorkLog, setEditingWorkLog] = useState<WorkLog | null>(null);
  const [selectedScadenzeDate, setSelectedScadenzeDate] = useState<
    string | null
  >(null);

  // Mobile "Altro" menu state
  const [isAltroMenuOpen, setIsAltroMenuOpen] = useState(false);
  const altroMenuRef = useRef<HTMLDivElement>(null);
  const altroButtonRef = useRef<HTMLButtonElement>(null);
  const altroMenuItemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!isAltroMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        altroMenuRef.current &&
        !altroMenuRef.current.contains(event.target as Node)
      ) {
        setIsAltroMenuOpen(false);
        altroButtonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAltroMenuOpen]);

  // Focus trap and keyboard navigation for Altro menu
  const handleAltroKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!isAltroMenuOpen) return;

      const items = altroMenuItemsRef.current.filter(Boolean) as HTMLButtonElement[];
      const currentIndex = items.findIndex(
        (item) => item === document.activeElement
      );

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          setIsAltroMenuOpen(false);
          altroButtonRef.current?.focus();
          break;
        case "ArrowUp":
          event.preventDefault();
          if (currentIndex > 0) {
            items[currentIndex - 1].focus();
          } else {
            items[items.length - 1].focus();
          }
          break;
        case "ArrowDown":
          event.preventDefault();
          if (currentIndex < items.length - 1) {
            items[currentIndex + 1].focus();
          } else {
            items[0].focus();
          }
          break;
        case "Tab":
          // Focus trap
          if (event.shiftKey && currentIndex === 0) {
            event.preventDefault();
            items[items.length - 1].focus();
          } else if (!event.shiftKey && currentIndex === items.length - 1) {
            event.preventDefault();
            items[0].focus();
          }
          break;
        case "Home":
          event.preventDefault();
          items[0]?.focus();
          break;
        case "End":
          event.preventDefault();
          items[items.length - 1]?.focus();
          break;
      }
    },
    [isAltroMenuOpen]
  );

  // Focus first item when menu opens
  useEffect(() => {
    if (isAltroMenuOpen) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        altroMenuItemsRef.current[0]?.focus();
      });
    }
  }, [isAltroMenuOpen]);

  const handleAltroItemClick = (page: Route) => {
    setCurrentPage(page);
    setIsAltroMenuOpen(false);
  };

  // Check if current page is in the "Altro" menu
  const isAltroPageActive = ["fattura-cortesia", "scadenze", "simulatore"].includes(currentPage);

  // Upload handlers
  const handleFatturaUpload = async (file: File) => {
    const text = await file.text();
    const parsed = parseFatturaXML(text);
    if (parsed) {
      let clienteId = clienti.find((c) => c.piva === parsed.clientePiva)?.id;
      if (!clienteId && parsed.clienteNome) {
        const nuovoCliente = {
          id: Date.now().toString(),
          nome: parsed.clienteNome,
          piva: parsed.clientePiva || "",
          email: parsed.clienteEmail || "",
          indirizzo: parsed.clienteIndirizzo || "",
          numeroCivico: parsed.clienteNumeroCivico || "",
          cap: parsed.clienteCap || "",
          comune: parsed.clienteComune || "",
          provincia: parsed.clienteProvincia || "",
          nazione: parsed.clienteNazione || "",
        };
        await addCliente(nuovoCliente);
        clienteId = nuovoCliente.id;
      }

      const nuovaFattura = {
        id: Date.now().toString(),
        numero: parsed.numero,
        importo: parsed.importo,
        data: parsed.data,
        dataIncasso: parsed.dataIncasso,
        clienteId: clienteId || "",
        clienteNome: parsed.clienteNome,
        duplicateKey: `${parsed.numero}-${parsed.data}-${parsed.importo}`,
      };
      await addFattura(nuovaFattura);

      // Auto-popola impostazioni vuote con dati emittente dalla fattura
      const extractedData = extractEmittenteFromXml(text);
      if (extractedData) {
        const configUpdates = autoPopulateConfig(extractedData, config);
        if (configUpdates) {
          setConfig({ ...config, ...configUpdates });
          showToast(
            "Fattura caricata! Impostazioni aggiornate automaticamente.",
          );
          setShowModal(null);
          return;
        }
      }

      setShowModal(null);
      showToast("Fattura caricata!");
    } else {
      showToast("Errore parsing XML", "error");
    }
  };

  const handleBatchUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;

    try {
      const xmlFiles: Array<{ name: string; content: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const content = await files[i].text();
        xmlFiles.push({ name: files[i].name, content });
      }

      const { summary, newFatture, newClienti } = await processBatchXmlFiles(
        xmlFiles,
        fatture,
        clienti,
        parseFatturaXML,
        null,
      );

      // Save new clienti and fatture to DB using context methods
      for (const cliente of newClienti) {
        await addCliente(cliente);
      }
      for (const fattura of newFatture) {
        await addFattura(fattura);
      }

      // Auto-popola impostazioni vuote con dati emittente dalla prima fattura
      if (xmlFiles.length > 0) {
        const extractedData = extractEmittenteFromXml(xmlFiles[0].content);
        if (extractedData) {
          const configUpdates = autoPopulateConfig(extractedData, config);
          if (configUpdates) {
            setConfig({ ...config, ...configUpdates });
          }
        }
      }

      setShowModal("import-summary");
      setImportSummary(summary);
    } catch (error: any) {
      console.error("Batch upload error:", error);
      showToast(
        "Errore import batch: " + (error?.message || "errore sconosciuto"),
        "error",
      );
    }
  };

  const handleZipUpload = async (file: File) => {
    try {
      const xmlFiles = await extractXmlFromZip(file);
      if (xmlFiles.length === 0) {
        showToast("Nessun file XML trovato nel ZIP", "error");
        return;
      }

      const { summary, newFatture, newClienti } = await processBatchXmlFiles(
        xmlFiles,
        fatture,
        clienti,
        parseFatturaXML,
        null,
      );

      // Save new clienti and fatture to DB using context methods
      for (const cliente of newClienti) {
        await addCliente(cliente);
      }
      for (const fattura of newFatture) {
        await addFattura(fattura);
      }

      // Auto-popola impostazioni vuote con dati emittente dalla prima fattura
      if (xmlFiles.length > 0) {
        const extractedData = extractEmittenteFromXml(xmlFiles[0].content);
        if (extractedData) {
          const configUpdates = autoPopulateConfig(extractedData, config);
          if (configUpdates) {
            setConfig({ ...config, ...configUpdates });
          }
        }
      }

      setShowModal("import-summary");
      setImportSummary(summary);
    } catch (error: any) {
      showToast(
        "Errore caricamento ZIP: " + (error?.message || "errore sconosciuto"),
        "error",
      );
    }
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importData(data);
      setShowModal(null);
    } catch (error) {
      showToast("Errore import", "error");
    }
  };

  return (
    <>
      <a href="#main-content" className="skip-link">
        Salta al contenuto principale
      </a>
      <div className="app-container">
        <nav className="sidebar">
          <div className="sidebar-header">
            <div>
              <div className="logo">Piv<span className="logo-light">ell</span>a</div>
              <div className="logo-sub">Gestione P.IVA Semplificata</div>
            </div>
            <div className="mobile-header-user">
              <UserSelector compact />
            </div>
          </div>

          <UserSelector />

          <nav className="nav-items" aria-label="Navigazione principale">
            <button
              type="button"
              className={`nav-item ${currentPage === "dashboard" ? "active" : ""}`}
              onClick={() => setCurrentPage("dashboard")}
              aria-current={currentPage === "dashboard" ? "page" : undefined}
            >
              <LayoutDashboard size={20} aria-hidden="true" /> Dashboard
            </button>
            <button
              type="button"
              className={`nav-item ${currentPage === "fatture" ? "active" : ""}`}
              onClick={() => setCurrentPage("fatture")}
              aria-current={currentPage === "fatture" ? "page" : undefined}
            >
              <FileText size={20} aria-hidden="true" /> Fatture
            </button>
            <button
              type="button"
              className={`nav-item ${currentPage === "calendario" ? "active" : ""}`}
              onClick={() => setCurrentPage("calendario")}
              aria-current={currentPage === "calendario" ? "page" : undefined}
            >
              <Calendar size={20} aria-hidden="true" /> Calendario
            </button>
            {/* Desktop only: show all items */}
            <button
              type="button"
              className={`nav-item nav-item-desktop ${currentPage === "fattura-cortesia" ? "active" : ""}`}
              onClick={() => setCurrentPage("fattura-cortesia")}
              aria-current={
                currentPage === "fattura-cortesia" ? "page" : undefined
              }
            >
              <FilePlus size={20} aria-hidden="true" /> Fattura di Cortesia
            </button>
            <button
              type="button"
              className={`nav-item nav-item-desktop ${currentPage === "scadenze" ? "active" : ""}`}
              onClick={() => setCurrentPage("scadenze")}
              aria-current={currentPage === "scadenze" ? "page" : undefined}
            >
              <CalendarClock size={20} aria-hidden="true" /> Scadenze
            </button>
            <button
              type="button"
              className={`nav-item nav-item-desktop ${currentPage === "simulatore" ? "active" : ""}`}
              onClick={() => setCurrentPage("simulatore")}
              aria-current={currentPage === "simulatore" ? "page" : undefined}
            >
              <Calculator size={20} aria-hidden="true" /> Simulatore
            </button>
            {/* Mobile only: Altro dropup menu */}
            <div
              className="nav-item-altro-wrapper"
              ref={altroMenuRef}
              onKeyDown={handleAltroKeyDown}
            >
              <button
                ref={altroButtonRef}
                type="button"
                className={`nav-item nav-item-mobile ${isAltroPageActive ? "active" : ""}`}
                onClick={() => setIsAltroMenuOpen(!isAltroMenuOpen)}
                aria-expanded={isAltroMenuOpen}
                aria-controls="altro-menu"
                aria-haspopup="menu"
              >
                <MoreHorizontal size={20} aria-hidden="true" /> Altro
              </button>
              <div
                id="altro-menu"
                className={`altro-dropup-menu ${isAltroMenuOpen ? "open" : ""}`}
                role="menu"
                aria-label="Menu Altro"
                aria-hidden={!isAltroMenuOpen}
              >
                <button
                  ref={(el) => { altroMenuItemsRef.current[0] = el; }}
                  type="button"
                  className={`altro-menu-item ${currentPage === "fattura-cortesia" ? "active" : ""}`}
                  onClick={() => handleAltroItemClick("fattura-cortesia")}
                  role="menuitem"
                  tabIndex={isAltroMenuOpen ? 0 : -1}
                  aria-current={currentPage === "fattura-cortesia" ? "page" : undefined}
                >
                  <FilePlus size={18} aria-hidden="true" /> Fattura di Cortesia
                </button>
                <button
                  ref={(el) => { altroMenuItemsRef.current[1] = el; }}
                  type="button"
                  className={`altro-menu-item ${currentPage === "scadenze" ? "active" : ""}`}
                  onClick={() => handleAltroItemClick("scadenze")}
                  role="menuitem"
                  tabIndex={isAltroMenuOpen ? 0 : -1}
                  aria-current={currentPage === "scadenze" ? "page" : undefined}
                >
                  <CalendarClock size={18} aria-hidden="true" /> Scadenze
                </button>
                <button
                  ref={(el) => { altroMenuItemsRef.current[2] = el; }}
                  type="button"
                  className={`altro-menu-item ${currentPage === "simulatore" ? "active" : ""}`}
                  onClick={() => handleAltroItemClick("simulatore")}
                  role="menuitem"
                  tabIndex={isAltroMenuOpen ? 0 : -1}
                  aria-current={currentPage === "simulatore" ? "page" : undefined}
                >
                  <Calculator size={18} aria-hidden="true" /> Simulatore
                </button>
              </div>
            </div>
            <button
              type="button"
              className={`nav-item ${currentPage === "impostazioni" ? "active" : ""}`}
              onClick={() => setCurrentPage("impostazioni")}
              aria-current={currentPage === "impostazioni" ? "page" : undefined}
            >
              <Settings size={20} aria-hidden="true" /> Impostazioni
            </button>
          </nav>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1 }}
              onClick={exportData}
            >
              <Download size={16} aria-hidden="true" /> Export
            </button>
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1 }}
              onClick={() => setShowModal("import")}
            >
              <Upload size={16} aria-hidden="true" /> Import
            </button>
          </div>

          <div className="footer">
            <div className="footer-credits">
              Made by{" "}
              <a
                href="https://github.com/MakhBeth"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="MakhBeth (si apre in una nuova finestra)"
              >
                MakhBeth
              </a>
            </div>
            <div className="footer-privacy">🔒 All data stays local</div>
            <div className="footer-disclaimer">💵 I conti sono solo stime</div>
            <div className="footer-link">
              <a
                href="https://github.com/MakhBeth/pivella"
                target="_blank"
                rel="noopener noreferrer"
                lang="en"
                aria-label="View on GitHub (opens in a new window)"
              >
                <Github size={16} aria-hidden="true" /> View on GitHub
              </a>
            </div>
          </div>
        </nav>

        <main id="main-content" className="main-content">
          <Suspense fallback={<LoadingSpinner />}>
            {currentPage === "dashboard" && (
              <Dashboard
                annoSelezionato={annoSelezionato}
                setAnnoSelezionato={setAnnoSelezionato}
              />
            )}

            {currentPage === "fatture" && (
              <FatturePage
                setShowModal={setShowModal}
                setEditingFattura={setEditingFattura}
              />
            )}

            {currentPage === "calendario" && (
              <Calendario
                setShowModal={setShowModal}
                setSelectedDate={setSelectedDate}
                setEditingWorkLog={setEditingWorkLog}
                setSelectedScadenzeDate={setSelectedScadenzeDate}
              />
            )}

            {currentPage === "fattura-cortesia" && <FatturaCortesia />}

            {currentPage === "scadenze" && <Scadenze />}

            {currentPage === "simulatore" && <Simulatore />}

            {currentPage === "guida" && (
              <Guida onDismiss={() => setCurrentPage("dashboard")} />
            )}

            {currentPage === "impostazioni" && (
              <Impostazioni
                setShowModal={setShowModal}
                setEditingCliente={setEditingCliente}
                handleExport={exportData}
              />
            )}
          </Suspense>
        </main>

        {/* MODALS - Lazy loaded, rendered only when open */}
        <Suspense fallback={null}>
          {showModal === "upload-fattura" && (
            <UploadFatturaModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              onUpload={handleFatturaUpload}
            />
          )}

          {showModal === "batch-upload-fattura" && (
            <BatchUploadModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              onUpload={handleBatchUpload}
            />
          )}

          {showModal === "upload-zip" && (
            <UploadZipModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              onUpload={handleZipUpload}
            />
          )}

          {showModal === "import-summary" && (
            <ImportSummaryModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              summary={importSummary}
            />
          )}

          {showModal === "add-cliente" && (
            <AddClienteModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              newCliente={newCliente}
              setNewCliente={setNewCliente}
              onAdd={async () => {
                if (!newCliente.nome) return;

                await addCliente({
                  id: Date.now().toString(),
                  nome: newCliente.nome,
                  piva: newCliente.piva || "",
                  email: newCliente.email || "",
                });
                setNewCliente({ nome: "", piva: "", email: "" });
                setShowModal(null);
                showToast("Cliente aggiunto!");
              }}
            />
          )}

          {showModal === "edit-cliente" && (
            <EditClienteModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              cliente={editingCliente}
              setCliente={setEditingCliente}
              onUpdate={async () => {
                if (!editingCliente) return;

                await updateCliente(editingCliente);
                setEditingCliente(null);
                setShowModal(null);
                showToast("Cliente aggiornato!");
              }}
            />
          )}

          {showModal === "add-work" && (
            <AddWorkLogModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              selectedDate={selectedDate}
              newWorkLog={newWorkLog}
              setNewWorkLog={setNewWorkLog}
              clienti={clientiWithMisc}
              onAdd={async () => {
                if (
                  !selectedDate ||
                  !newWorkLog.clienteId ||
                  newWorkLog.quantita === undefined
                )
                  return;

                const workLog = {
                  id: Date.now().toString(),
                  clienteId: newWorkLog.clienteId,
                  data: selectedDate,
                  tipo: newWorkLog.tipo || "ore",
                  quantita: newWorkLog.quantita,
                  note: newWorkLog.note || "",
                };

                await addWorkLog(workLog);
                setNewWorkLog({
                  clienteId: "",
                  quantita: undefined,
                  tipo: "ore",
                  note: "",
                });
                setShowModal(null);
                showToast("Lavoro registrato!");
              }}
            />
          )}

          {showModal === "import" && (
            <ImportBackupModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              onImport={handleImport}
            />
          )}

          {showModal === "edit-work" && (
            <EditWorkLogModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              workLog={editingWorkLog}
              setWorkLog={setEditingWorkLog}
              clienti={clientiWithMisc}
              onUpdate={async () => {
                if (!editingWorkLog) return;

                await updateWorkLog(editingWorkLog);
                setEditingWorkLog(null);
                setShowModal(null);
                showToast("Attività aggiornata!");
              }}
            />
          )}

          {showModal === "edit-data-incasso" && (
            <EditDataIncassoModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              fattura={editingFattura}
              setFattura={setEditingFattura}
              onUpdate={async () => {
                if (!editingFattura) return;

                await updateFattura(editingFattura);
                setEditingFattura(null);
                setShowModal(null);
                showToast("Data incasso aggiornata!");
              }}
            />
          )}

          {showModal === "courtesy-invoice" && (
            <CourtesyInvoiceModal
              isOpen={true}
              onClose={() => setShowModal(null)}
            />
          )}

          {showModal === "manage-services" && (
            <ManageServicesModal
              isOpen={true}
              onClose={() => setShowModal(null)}
            />
          )}

          {showModal === "nuova-fattura" && (
            <NuovaFatturaModal
              isOpen={true}
              onClose={() => setShowModal(null)}
            />
          )}

          {showModal === "scadenze-detail" && (
            <ScadenzaDetailModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              selectedDate={selectedScadenzeDate}
            />
          )}

          {showModal === "calendar-day" && (
            <CalendarDayModal
              isOpen={true}
              onClose={() => setShowModal(null)}
              selectedDate={selectedDate}
              newWorkLog={newWorkLog}
              setNewWorkLog={setNewWorkLog}
              clienti={clientiWithMisc}
              onAddWorkLog={async () => {
                if (
                  !selectedDate ||
                  !newWorkLog.clienteId ||
                  newWorkLog.quantita === undefined
                )
                  return;

                const workLog = {
                  id: Date.now().toString(),
                  clienteId: newWorkLog.clienteId,
                  data: selectedDate,
                  tipo: newWorkLog.tipo || "ore",
                  quantita: newWorkLog.quantita,
                  note: newWorkLog.note || "",
                };

                await addWorkLog(workLog);
                setNewWorkLog({
                  clienteId: "",
                  quantita: undefined,
                  tipo: "ore",
                  note: "",
                });
                setShowModal(null);
                showToast("Lavoro registrato!");
              }}
              initialTab={selectedScadenzeDate ? "scadenze" : "lavoro"}
            />
          )}
        </Suspense>

        {toast && <Toast toast={toast} />}
      </div>
    </>
  );
}

export default function ForfettarioApp() {
  return (
    <AppProvider>
      <ForfettarioAppInner />
    </AppProvider>
  );
}
