"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import {
  api, calcCustoAnalise, calcCustoTotal,
  type Processo, type Documento, type EventoCronologia,
  type Analise, type TarefaRevisao, type Minuta, type Snapshot, type Peca, type Prazo,
  type SyncDataJudResult, type Atendimento, type TimesheetEntry,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtData(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("pt-BR");
}

function fmtDataHora(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ── Export helpers ────────────────────────────────────────────────────────

function jsonToHtmlReport(
  titulo: string,
  subtitulo: string,
  conteudo: Record<string, unknown>,
  processo?: Processo | null,
): string {
  const renderVal = (v: unknown, depth = 0): string => {
    if (v === null || v === undefined) return "<em>—</em>";
    if (typeof v === "boolean") return v ? "Sim" : "Não";
    if (typeof v === "number") return String(v);
    if (typeof v === "string") return v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
    if (Array.isArray(v)) {
      if (!v.length) return "<em>Nenhum</em>";
      if (typeof v[0] === "string")
        return `<ul>${v.map((s: unknown) => `<li>${renderVal(s, depth+1)}</li>`).join("")}</ul>`;
      return v.map((item) => `<div class="sub">${renderVal(item, depth+1)}</div>`).join("");
    }
    if (typeof v === "object") {
      return Object.entries(v as Record<string,unknown>).map(([k, val]) =>
        `<div class="row"><span class="key">${k.replace(/_/g," ").toUpperCase()}</span> ${renderVal(val, depth+1)}</div>`
      ).join("");
    }
    return String(v);
  };

  const processoInfo = processo
    ? `<p class="meta">${[processo.numero_cnj, processo.tribunal, processo.vara].filter(Boolean).join(" | ")}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${titulo}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', serif; font-size: 12pt; color: #1a1a1a; padding: 2cm; }
  h1 { font-size: 16pt; margin-bottom: 4px; }
  h2 { font-size: 13pt; border-bottom: 1px solid #999; padding-bottom: 4px; margin: 18px 0 8px; color: #2c2c2c; }
  .meta { font-size: 10pt; color: #666; margin-bottom: 16px; }
  .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 20px; }
  .aviso { background: #fff8e1; border-left: 3px solid #f0a500; padding: 8px 12px; font-size: 10pt; margin-bottom: 16px; }
  .row { margin: 4px 0 6px; }
  .key { font-weight: bold; font-size: 10pt; color: #555; text-transform: uppercase; letter-spacing: 0.5px; display: block; }
  .sub { border-left: 3px solid #ddd; margin: 6px 0; padding-left: 10px; }
  ul { margin: 4px 0 4px 16px; }
  li { margin-bottom: 3px; }
  em { color: #aaa; font-style: italic; }
  @media print {
    body { padding: 1.5cm; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>${titulo}</h1>
  ${processoInfo}
  <p class="meta">Gerado em ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} · ${subtitulo}</p>
</div>
<div class="aviso">⚠ Análise gerada por IA — requer validação do advogado responsável antes de qualquer utilização.</div>
<div>${renderVal(conteudo)}</div>
</body>
</html>`;
}

function exportarPDF(titulo: string, html: string) {
  const w = window.open("", "_blank");
  if (!w) { alert("Permita popups para exportar PDF."); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

function exportarWord(titulo: string, html: string) {
  const blob = new Blob([
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"><title>${titulo}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
</head><body>${html}</body></html>`
  ], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${titulo.replace(/[^a-zA-Z0-9À-ú ]/g, "").slice(0, 60)}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatBytes(b?: number) {
  if (!b) return "";
  if (b < 1024 * 1024) return ` · ${(b / 1024).toFixed(0)} KB`;
  return ` · ${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ── Componentes base ──────────────────────────────────────────────────────

function Spinner({ sm }: { sm?: boolean }) {
  const s = sm ? "h-4 w-4" : "h-5 w-5";
  return (
    <svg className={`animate-spin ${s} text-gold`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function RelevBadge({ r }: { r: string }) {
  const map: Record<string, string> = {
    critica: "bg-red-100 text-red-700",
    alta:    "bg-orange-100 text-orange-700",
    media:   "bg-yellow-100 text-yellow-700",
    baixa:   "bg-green-100 text-green-700",
  };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[r] ?? "bg-gray-100 text-gray-600"}`}>{r}</span>;
}

function StatusBadge({ s, map }: { s: string; map: Record<string, string> }) {
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[s] ?? "bg-gray-100 text-gray-600"}`}>{s}</span>;
}

function SearchBar({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "Buscar…"}
        className="w-full pl-8 pr-3 py-2 border border-border rounded-lg text-sm bg-bg text-text-main placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-gold/40" />
    </div>
  );
}

function Btn({ onClick, disabled, variant = "ghost", children, className = "" }: {
  onClick?: () => void; disabled?: boolean;
  variant?: "gold" | "danger" | "ghost" | "green" | "orange";
  children: React.ReactNode; className?: string;
}) {
  const cls: Record<string, string> = {
    gold:   "bg-gold text-navy hover:bg-gold-light",
    danger: "text-red-500 hover:text-red-700 hover:bg-red-50",
    ghost:  "text-muted hover:text-text-main hover:bg-bg",
    green:  "text-green-600 hover:text-green-700 hover:bg-green-50",
    orange: "text-orange-600 hover:text-orange-700 hover:bg-orange-50",
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${cls[variant]} ${className}`}>
      {children}
    </button>
  );
}

// ── Modal genérico ────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-surface rounded-2xl shadow-2xl flex flex-col max-h-[90vh] ${wide ? "w-full max-w-3xl" : "w-full max-w-lg"}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-base font-bold text-text-main">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-text-main p-1 rounded transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

// ── Ícones de tab ─────────────────────────────────────────────────────────
const TAB_ICONS: Record<string, React.ReactNode> = {
  documentos:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  pecas:        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  cronologia:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>,
  prazos:       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  analises:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  revisao:      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  atendimentos: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  minutas:      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  snapshots:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>,
  chat:         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  atividade:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
};

const TABS = [
  { id: "documentos",   label: "Documentos" },
  { id: "pecas",        label: "Peças" },
  { id: "cronologia",   label: "Cronologia" },
  { id: "prazos",       label: "Prazos" },
  { id: "analises",     label: "Análises IA" },
  { id: "revisao",      label: "Revisão" },
  { id: "atendimentos", label: "Atendimentos" },
  { id: "minutas",      label: "Minutas" },
  { id: "snapshots",    label: "Versões" },
  { id: "chat",         label: "Chat IA" },
  { id: "atividade",    label: "Atividade" },
] as const;
type Tab = (typeof TABS)[number]["id"];

// ════════════════════════════════════════════════════════════════════════════
// ABA: DOCUMENTOS
// ════════════════════════════════════════════════════════════════════════════

function AbaDocumentos({ processoId }: { processoId: string }) {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletando, setDeletando] = useState<string | null>(null);
  const [modalConteudo, setModalConteudo] = useState<{ doc: Documento; pecas: Peca[] } | null>(null);
  const [carregandoPecas, setCarregandoPecas] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    api.documentos.listar(processoId).then(setDocs).finally(() => setLoading(false));
  }, [processoId]);

  async function handleDelete(docId: string, nome: string) {
    if (!confirm(`Excluir "${nome}"?\nTodas as peças e textos associados serão removidos.`)) return;
    setDeletando(docId);
    try {
      await api.documentos.deletar(processoId, docId);
      setDocs(prev => prev.filter(d => d.id !== docId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setDeletando(null);
    }
  }

  async function handleVerConteudo(doc: Documento) {
    setCarregandoPecas(doc.id);
    try {
      const pecas = await api.documentos.pecas(processoId, doc.id);
      setModalConteudo({ doc, pecas });
    } catch {
      alert("Erro ao carregar peças");
    } finally {
      setCarregandoPecas(null);
    }
  }

  const docStatusMap: Record<string, string> = {
    processado:  "bg-green-100 text-green-700",
    processando: "bg-yellow-100 text-yellow-700",
    aguardando:  "bg-gray-100 text-gray-600",
    erro:        "bg-red-100 text-red-700",
  };

  const docsFiltrados = docs.filter(d =>
    d.nome_original.toLowerCase().includes(busca.toLowerCase()) ||
    d.status.toLowerCase().includes(busca.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1"><SearchBar value={busca} onChange={setBusca} placeholder="Buscar documentos…" /></div>
          <a href={`/upload?processo=${processoId}`}
            className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all whitespace-nowrap">
            + Enviar Documento
          </a>
        </div>

        {!docs.length && (
          <div className="text-center py-16 text-muted text-sm">
            Nenhum documento ainda.{" "}
            <a href={`/upload?processo=${processoId}`} className="text-gold underline">Enviar agora</a>
          </div>
        )}

        {docsFiltrados.map(d => (
          <div key={d.id}
            className="bg-bg rounded-xl border border-border p-4 flex items-start justify-between gap-4 hover:border-gold/40 transition-colors cursor-pointer"
            onClick={() => d.status === "processado" && handleVerConteudo(d)}>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-main truncate">{d.nome_original}</p>
                <p className="text-xs text-muted mt-0.5">
                  {d.total_paginas ? `${d.total_paginas} pág.` : "—"}
                  {d.ocr_utilizado && " · OCR"}
                  {formatBytes(d.tamanho_bytes)}
                  {" · "}{fmtData(d.uploaded_at)}
                </p>
                {d.erro_msg && <p className="text-xs text-red-500 mt-1 line-clamp-2">⚠ {d.erro_msg}</p>}
                {d.status === "processado" && <p className="text-xs text-gold mt-0.5">Clique para ver conteúdo</p>}
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
              <StatusBadge s={d.status} map={docStatusMap} />
              {d.status === "processado" && (
                <Btn onClick={() => handleVerConteudo(d)} disabled={carregandoPecas === d.id}>
                  {carregandoPecas === d.id ? <Spinner sm /> : "Ver peças"}
                </Btn>
              )}
              {d.status === "erro" && (
                <a href={`/upload?processo=${processoId}`}
                  className="text-xs font-semibold text-orange-600 hover:text-orange-500 px-3 py-1.5 rounded-lg hover:bg-orange-50 transition-all">
                  Re-enviar
                </a>
              )}
              <Btn variant="danger" onClick={() => handleDelete(d.id, d.nome_original)} disabled={deletando === d.id}>
                {deletando === d.id ? "…" : "Excluir"}
              </Btn>
            </div>
          </div>
        ))}
      </div>

      {/* Modal conteúdo do documento */}
      {modalConteudo && (
        <Modal title={modalConteudo.doc.nome_original} onClose={() => setModalConteudo(null)} wide>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 text-xs text-muted">
              <span>{modalConteudo.doc.total_paginas} páginas</span>
              {modalConteudo.doc.ocr_utilizado && <span className="text-orange-500">OCR aplicado</span>}
              <span>{fmtData(modalConteudo.doc.uploaded_at)}</span>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                {modalConteudo.pecas.length} peça{modalConteudo.pecas.length !== 1 ? "s" : ""} indexada{modalConteudo.pecas.length !== 1 ? "s" : ""}
              </p>
              <div className="space-y-2">
                {modalConteudo.pecas.map(p => (
                  <div key={p.id} className="bg-bg rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-text-main">{p.tipo_peca.replace(/_/g, " ").toUpperCase()}</span>
                      <span className="text-xs text-muted">pág. {p.pagina_inicio}–{p.pagina_fim}</span>
                    </div>
                    {p.resumo && <p className="text-xs text-muted mt-1">{p.resumo}</p>}
                    {p.autor && <p className="text-xs text-muted">Autor: {p.autor}</p>}
                    {p.data_documento && <p className="text-xs text-muted">Data: {fmtData(String(p.data_documento))}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-border flex gap-2 justify-end">
              <a href={`/upload?processo=${processoId}`}
                className="text-xs font-semibold text-gold px-3 py-2 rounded-lg hover:bg-gold/10 transition-all">
                + Enviar novo documento
              </a>
              <Btn variant="danger" onClick={() => {
                setModalConteudo(null);
                handleDelete(modalConteudo.doc.id, modalConteudo.doc.nome_original);
              }}>
                Excluir documento
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA: CRONOLOGIA
// ════════════════════════════════════════════════════════════════════════════

const TIPOS_EVENTO = [
  "peticao_inicial", "citacao", "contestacao", "audiencia", "pericia",
  "decisao_interlocutoria", "sentenca", "recurso", "acordao",
  "intimacao", "cumprimento_sentenca", "outro",
];
const RELEVANCIAS = ["baixa", "media", "alta", "critica"];

type EventoForm = {
  tipo_evento: string;
  descricao: string;
  data_evento: string;
  data_aproximada: boolean;
  relevancia: string;
  fonte: string;
};

const EVENTO_FORM_VAZIO: EventoForm = {
  tipo_evento: "outro", descricao: "", data_evento: "",
  data_aproximada: false, relevancia: "media", fonte: "manual",
};

function ModalEvento({ inicial, onSalvar, onFechar, loading }: {
  inicial: EventoForm; onSalvar: (f: EventoForm) => void;
  onFechar: () => void; loading: boolean;
}) {
  const [form, setForm] = useState(inicial);
  const set = (k: keyof EventoForm, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal title={inicial.descricao ? "Editar Evento" : "Novo Evento"} onClose={onFechar}>
      <form onSubmit={e => { e.preventDefault(); onSalvar(form); }} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Tipo de Evento</label>
          <select value={form.tipo_evento} onChange={e => set("tipo_evento", e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40">
            {TIPOS_EVENTO.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Data</label>
            <input type="date" value={form.data_evento} onChange={e => set("data_evento", e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Relevância</label>
            <select value={form.relevancia} onChange={e => set("relevancia", e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40">
              {RELEVANCIAS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Descrição *</label>
          <textarea value={form.descricao} onChange={e => set("descricao", e.target.value)}
            required rows={3} placeholder="Descreva o evento..."
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40 resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Fonte</label>
            <input value={form.fonte} onChange={e => set("fonte", e.target.value)}
              placeholder="manual, petição, etc."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
              <input type="checkbox" checked={form.data_aproximada}
                onChange={e => set("data_aproximada", e.target.checked)}
                className="rounded" />
              Data aproximada
            </label>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Btn onClick={onFechar}>Cancelar</Btn>
          <button type="submit" disabled={loading}
            className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all disabled:opacity-50">
            {loading ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const PASSOS_CRON = [
  "Carregando peças do processo…",
  "Analisando petição inicial…",
  "Processando citações e intimações…",
  "Extraindo despachos e decisões…",
  "Analisando recursos e acórdãos…",
  "Processando sentenças…",
  "Identificando embargos e agravos…",
  "Consolidando ordem cronológica…",
  "Validando lógica processual…",
  "Salvando eventos…",
];

function AbaCronologia({ processoId }: { processoId: string }) {
  const [eventos, setEventos] = useState<EventoCronologia[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalEvento, setModalEvento] = useState<{ form: EventoForm; id?: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [deletando, setDeletando] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [gerandoCron, setGerandoCron] = useState(false);
  const [passoCron, setPassoCron] = useState(0);
  const [progresso, setProgresso] = useState(0);
  const [vistaTimeline, setVistaTimeline] = useState(true);

  useEffect(() => {
    api.cronologia.listar(processoId).then(setEventos).finally(() => setLoading(false));
  }, [processoId]);

  async function gerarCronologia() {
    if (!confirm("Gerar cronologia com IA irá analisar todas as peças do processo.\nEventos existentes serão mantidos e novos serão adicionados.\n\nContinuar?")) return;
    setGerandoCron(true);
    setPassoCron(0);
    setProgresso(0);

    try {
      const resp = await api.analises.stream(processoId, "cronologia");
      if (!resp.body) throw new Error("Stream indisponível");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE: chunks delimitados por "\n\n"
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === "progress") {
              setProgresso(ev.pct ?? 0);
              // Mapeia a mensagem do servidor para o índice mais próximo no PASSOS_CRON
              const idx = PASSOS_CRON.findIndex(p => p === ev.msg);
              setPassoCron(idx >= 0 ? idx : Math.round((ev.pct / 100) * (PASSOS_CRON.length - 1)));
            } else if (ev.type === "done") {
              setProgresso(100);
              setPassoCron(PASSOS_CRON.length - 1);
              await new Promise(r => setTimeout(r, 800));
              const evs = await api.cronologia.listar(processoId);
              setEventos(evs);
            } else if (ev.type === "error") {
              throw new Error(ev.msg ?? "Erro ao gerar cronologia");
            }
          } catch (parseErr) {
            // Ignora chunks malformados
          }
        }
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao gerar cronologia");
    } finally {
      setGerandoCron(false);
      setPassoCron(0);
      setProgresso(0);
    }
  }

  async function salvarEvento(form: EventoForm) {
    setSalvando(true);
    try {
      const body = {
        tipo_evento: form.tipo_evento,
        descricao: form.descricao,
        relevancia: form.relevancia,
        fonte: form.fonte,
        data_aproximada: form.data_aproximada,
        ...(form.data_evento ? { data_evento: form.data_evento } : {}),
      };
      if (modalEvento?.id) {
        const ev = await api.cronologia.atualizar(processoId, modalEvento.id, body);
        setEventos(prev => prev.map(e => e.id === modalEvento.id ? ev : e));
      } else {
        const ev = await api.cronologia.criar(processoId, body);
        setEventos(prev => [...prev, ev].sort((a, b) =>
          (a.data_evento ?? "").localeCompare(b.data_evento ?? "")));
      }
      setModalEvento(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function deletarEvento(id: string) {
    if (!confirm("Excluir este evento da cronologia?")) return;
    setDeletando(id);
    try {
      await api.cronologia.deletar(processoId, id);
      setEventos(prev => prev.filter(e => e.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setDeletando(null);
    }
  }

  async function validar(id: string) {
    const ev = await api.cronologia.validar(processoId, id);
    setEventos(prev => prev.map(e => e.id === id ? ev : e));
  }

  const eventosFiltrados = eventos.filter(ev =>
    ev.descricao.toLowerCase().includes(busca.toLowerCase()) ||
    ev.tipo_evento.toLowerCase().includes(busca.toLowerCase()) ||
    ev.relevancia.toLowerCase().includes(busca.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <>
      {/* Painel de geração */}
      <div className={`rounded-xl border mb-4 p-4 transition-all ${gerandoCron ? "border-gold bg-gold/5" : "border-border bg-gray-50"}`}>
        {gerandoCron ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Spinner />
              <div className="flex-1">
                <p className="text-sm font-semibold text-text-main">{PASSOS_CRON[passoCron]}</p>
                <p className="text-xs text-muted">Processando peça por peça para máxima precisão…</p>
              </div>
            </div>
            <div className="w-full bg-border rounded-full h-2 overflow-hidden">
              <div
                className="bg-gold h-2 rounded-full transition-all duration-[4000ms] ease-linear"
                style={{ width: `${progresso}%` }}
              />
            </div>
            <p className="text-xs text-muted text-right">{progresso}%</p>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-text-main">Gerar Cronologia com IA</p>
              <p className="text-xs text-muted">
                Extrai atos processuais peça por peça com validação de lógica processual.
                {eventos.length > 0 && ` (${eventos.length} eventos já salvos)`}
              </p>
            </div>
            <button onClick={gerarCronologia}
              className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all whitespace-nowrap flex-shrink-0">
              🤖 Gerar com IA
            </button>
          </div>
        )}
      </div>

      {/* Barra de controles */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1"><SearchBar value={busca} onChange={setBusca} placeholder="Buscar eventos…" /></div>
        {/* Toggle lista / timeline */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setVistaTimeline(false)}
            className={`px-3 py-2 text-xs font-semibold transition-colors ${!vistaTimeline ? "bg-gold text-navy" : "bg-bg text-muted hover:text-text-main"}`}
            title="Vista em lista">
            ≡ Lista
          </button>
          <button
            onClick={() => setVistaTimeline(true)}
            className={`px-3 py-2 text-xs font-semibold transition-colors ${vistaTimeline ? "bg-gold text-navy" : "bg-bg text-muted hover:text-text-main"}`}
            title="Linha do tempo">
            ◈ Timeline
          </button>
        </div>
        <button onClick={() => setModalEvento({ form: EVENTO_FORM_VAZIO })}
          className="border border-border text-text-main font-semibold rounded-lg px-4 py-2 text-sm hover:border-gold hover:text-gold transition-all whitespace-nowrap">
          + Manual
        </button>
      </div>

      {!eventos.length && (
        <div className="text-center py-16 text-muted text-sm">
          Nenhum evento. Gere uma análise de cronologia ou adicione manualmente.
        </div>
      )}

      {/* ── VISTA TIMELINE ── */}
      {vistaTimeline && eventosFiltrados.length > 0 && (() => {
        // Agrupa por ano
        const porAno: Record<string, EventoCronologia[]> = {};
        eventosFiltrados.forEach(ev => {
          const ano = ev.data_evento ? ev.data_evento.slice(0, 4) : "Sem data";
          if (!porAno[ano]) porAno[ano] = [];
          porAno[ano].push(ev);
        });
        const anos = Object.keys(porAno).sort();

        const corPonto: Record<string, string> = {
          critica: "bg-red-500 ring-red-200",
          alta:    "bg-orange-400 ring-orange-200",
          media:   "bg-gold ring-yellow-200",
          baixa:   "bg-green-400 ring-green-200",
        };
        const corBorda: Record<string, string> = {
          critica: "border-red-300",
          alta:    "border-orange-300",
          media:   "border-yellow-300",
          baixa:   "border-green-300",
        };

        return (
          <div className="relative ml-2">
            {/* Linha vertical principal */}
            <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gradient-to-b from-gold via-border to-transparent" />

            <div className="space-y-0">
              {anos.map(ano => (
                <div key={ano}>
                  {/* Cabeçalho do ano */}
                  <div className="flex items-center gap-3 mb-4 mt-6 first:mt-0">
                    <div className="w-10 h-10 rounded-full bg-navy text-white text-xs font-black flex items-center justify-center z-10 relative shrink-0">
                      {ano.slice(2)}
                    </div>
                    <span className="text-sm font-bold text-navy">{ano}</span>
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted">{porAno[ano].length} evento{porAno[ano].length !== 1 ? "s" : ""}</span>
                  </div>

                  {/* Eventos do ano */}
                  <div className="space-y-3 pb-2">
                    {porAno[ano].map(ev => {
                      const rel = ev.relevancia as string;
                      const dataFmt = ev.data_evento
                        ? new Date(ev.data_evento + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
                        : "?";
                      return (
                        <div key={ev.id} className="flex gap-4 items-start group">
                          {/* Ponto na linha */}
                          <div className="relative flex-shrink-0 w-10 flex justify-center">
                            <div className={`w-4 h-4 rounded-full z-10 relative ring-4 mt-2 ${corPonto[rel] ?? "bg-muted ring-muted/20"}`} />
                          </div>
                          {/* Card */}
                          <div
                            className={`flex-1 bg-bg border rounded-xl p-4 cursor-pointer hover:shadow-md transition-all hover:border-gold/50 ${corBorda[rel] ?? "border-border"}`}
                            onClick={() => setModalEvento({
                              id: ev.id,
                              form: {
                                tipo_evento: ev.tipo_evento, descricao: ev.descricao,
                                data_evento: ev.data_evento ?? "", data_aproximada: ev.data_aproximada,
                                relevancia: ev.relevancia, fonte: ev.fonte,
                              },
                            })}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center flex-wrap gap-2 mb-1">
                                  <span className="text-xs font-bold text-text-main bg-surface border border-border rounded px-2 py-0.5 font-mono">
                                    {dataFmt}{ev.data_aproximada ? " ~" : ""}
                                  </span>
                                  <RelevBadge r={ev.relevancia} />
                                  {!ev.validado && <span className="text-[10px] text-muted italic bg-surface px-1.5 py-0.5 rounded">não validado</span>}
                                  {ev.fonte === "manual" && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-semibold">manual</span>}
                                </div>
                                <p className="text-sm font-semibold text-text-main capitalize">
                                  {ev.tipo_evento.replace(/_/g, " ")}
                                </p>
                                <p className="text-sm text-muted mt-1 leading-relaxed">{ev.descricao}</p>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                {!ev.validado && <Btn variant="green" onClick={() => validar(ev.id)}>✓</Btn>}
                                <Btn variant="danger" onClick={() => deletarEvento(ev.id)} disabled={deletando === ev.id}>
                                  {deletando === ev.id ? "…" : "✕"}
                                </Btn>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── VISTA LISTA ── */}
      {!vistaTimeline && (
        <div className="relative">
          {eventos.length > 0 && <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />}
          <div className="space-y-4 pl-10">
            {eventosFiltrados.map(ev => (
              <div key={ev.id} className="relative">
                <div className={`absolute -left-6 top-3 w-3 h-3 rounded-full border-2 border-surface
                  ${ev.relevancia === "critica" ? "bg-red-500" : ev.relevancia === "alta" ? "bg-orange-400" : ev.relevancia === "media" ? "bg-gold" : "bg-green-400"}`} />
                <div
                  className="bg-bg rounded-xl border border-border p-4 hover:border-gold/40 transition-colors cursor-pointer"
                  onClick={() => setModalEvento({
                    id: ev.id,
                    form: {
                      tipo_evento: ev.tipo_evento, descricao: ev.descricao,
                      data_evento: ev.data_evento ?? "", data_aproximada: ev.data_aproximada,
                      relevancia: ev.relevancia, fonte: ev.fonte,
                    },
                  })}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted">
                          {ev.data_evento ? fmtData(String(ev.data_evento)) : "Data?"}
                          {ev.data_aproximada && " ~"}
                        </span>
                        <RelevBadge r={ev.relevancia} />
                        {!ev.validado && <span className="text-xs text-muted italic">(não validado)</span>}
                        {ev.fonte === "manual" && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">manual</span>}
                      </div>
                      <p className="text-sm font-semibold text-text-main">{ev.tipo_evento.replace(/_/g, " ")}</p>
                      <p className="text-sm text-muted mt-1">{ev.descricao}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      {!ev.validado && <Btn variant="green" onClick={() => validar(ev.id)}>Validar</Btn>}
                      <Btn onClick={() => setModalEvento({
                        id: ev.id,
                        form: {
                          tipo_evento: ev.tipo_evento, descricao: ev.descricao,
                          data_evento: ev.data_evento ?? "", data_aproximada: ev.data_aproximada,
                          relevancia: ev.relevancia, fonte: ev.fonte,
                        },
                      })}>Editar</Btn>
                      <Btn variant="danger" onClick={() => deletarEvento(ev.id)} disabled={deletando === ev.id}>
                        {deletando === ev.id ? "…" : "Excluir"}
                      </Btn>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {modalEvento && (
        <ModalEvento
          inicial={modalEvento.form}
          onSalvar={salvarEvento}
          onFechar={() => setModalEvento(null)}
          loading={salvando}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA: ANÁLISES IA
// ════════════════════════════════════════════════════════════════════════════

const TIPOS_ANALISE = [
  { id: "estrategia_vencedora",  label: "🏆 Estratégia Vencedora", premium: true,
    descricao: "Plano de vitória completo: probabilidade de êxito, argumento campeão, top 5 argumentos, jurisprudência de ouro e plano de ataque 30 dias" },
  { id: "diagnostico_completo",  label: "⚖ Diagnóstico Completo",
    descricao: "Análise completa como um advogado sênior: cronologia, falhas, teses, riscos e estratégia" },
  { id: "descricao_documentos",  label: "📋 Descrição dos Autos",
    descricao: "Descrição fiel e detalhada de cada peça processual com transcrição literal dos dispositivos" },
  { id: "estado_atual",          label: "Estado Atual" },
  { id: "resumo_executivo",      label: "Resumo Executivo" },
  { id: "riscos",                label: "Riscos" },
  { id: "teses",                 label: "Teses Jurídicas" },
  { id: "cronologia",            label: "Cronologia IA" },
  { id: "analise_provas",        label: "🔍 Análise de Provas",
    descricao: "Avalia o conjunto probatório: peso de cada prova, provas faltantes e cerceamento de defesa" },
  { id: "jurisprudencia_citada", label: "⚖ Jurisprudência Citada",
    descricao: "Cataloga todos os precedentes, súmulas e artigos citados no processo com avaliação de qual parte favorece" },
  { id: "impacto_atualizacao",   label: "Impacto da Atualização" },
  { id: "proximos_passos",       label: "Próximos Passos" },
  { id: "estrategia",            label: "Estratégia" },
];

function ModalAnalise({ analise, processoId, processo, onUpdate, onClose, onDelete }: {
  analise: Analise; processoId: string; processo?: Processo | null;
  onUpdate: (a: Analise) => void; onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [loading, setLoading] = useState<"aprovar" | "rejeitar" | "excluir" | null>(null);
  const [exportMenu, setExportMenu] = useState(false);

  async function aprovar() {
    setLoading("aprovar");
    try {
      const a = await api.analises.aprovar(processoId, analise.id);
      onUpdate(a);
    } finally { setLoading(null); }
  }

  async function rejeitar() {
    const comentario = prompt("Motivo da rejeição:");
    if (comentario === null) return;
    setLoading("rejeitar");
    try {
      const a = await api.analises.rejeitar(processoId, analise.id, comentario);
      onUpdate(a);
    } finally { setLoading(null); }
  }

  async function excluir() {
    const label = TIPOS_ANALISE.find(t => t.id === analise.tipo)?.label ?? analise.tipo.replace(/_/g, " ");
    if (!confirm(`Excluir a análise "${label}"?`)) return;
    setLoading("excluir");
    try {
      await api.analises.deletar(processoId, analise.id);
      onDelete(analise.id);
      onClose();
    } finally { setLoading(null); }
  }

  const revisaoMap: Record<string, string> = {
    pendente:  "bg-yellow-100 text-yellow-700",
    aprovada:  "bg-green-100 text-green-700",
    rejeitada: "bg-red-100 text-red-700",
    editada:   "bg-blue-100 text-blue-700",
  };

  const label = TIPOS_ANALISE.find(t => t.id === analise.tipo)?.label ?? analise.tipo.replace(/_/g, " ");

  return (
    <Modal title={label} onClose={onClose} wide>
      <div className="space-y-4">
        {/* Meta */}
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge s={analise.status_revisao} map={revisaoMap} />
          {analise.confianca !== undefined && (
            <span className="text-xs text-muted">confiança {Math.round(analise.confianca * 100)}%</span>
          )}
          <span className="text-xs text-muted">{fmtDataHora(analise.created_at)}</span>
          <span className="text-xs text-muted">{analise.tokens_input}+{analise.tokens_output} tokens</span>
          <span className="text-xs font-semibold text-green-700">
            {calcCustoAnalise(analise.modelo_ia, analise.tokens_input ?? 0, analise.tokens_output ?? 0).label}
          </span>
        </div>

        {/* Conteúdo formatado */}
        <div className="bg-bg rounded-xl border border-border p-4 max-h-[60vh] overflow-y-auto">
          {analise.tipo === "estrategia_vencedora"
            ? <EstrategiaVencedoraRenderer d={analise.conteudo_json} />
            : analise.tipo === "diagnostico_completo"
            ? <DiagnosticoRenderer d={analise.conteudo_json} />
            : analise.tipo === "descricao_documentos"
            ? <DescricaoDocumentosRenderer d={analise.conteudo_json} />
            : <AnaliseConteudo conteudo={analise.conteudo_json} />
          }
        </div>

        {/* Ações */}
        {analise.status_revisao === "pendente" && (
          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <Btn variant="danger" onClick={rejeitar} disabled={!!loading}>
              {loading === "rejeitar" ? "…" : "Rejeitar"}
            </Btn>
            <button onClick={aprovar} disabled={!!loading}
              className="bg-green-600 text-white font-semibold rounded-lg px-4 py-2 text-sm hover:bg-green-700 transition-all disabled:opacity-50">
              {loading === "aprovar" ? "Aprovando…" : "✓ Aprovar"}
            </button>
          </div>
        )}
        {analise.status_revisao === "aprovada" && (
          <p className="text-xs text-green-600 text-right">✓ Aprovada em {fmtData(analise.revisado_at)}</p>
        )}
        {/* Barra inferior: excluir + exportar */}
        <div className="flex items-center justify-between pt-2 border-t border-border gap-2">
          <Btn variant="danger" onClick={excluir} disabled={!!loading}>
            {loading === "excluir" ? "Excluindo…" : "🗑 Excluir"}
          </Btn>
          <div className="relative">
            <button
              onClick={() => setExportMenu(v => !v)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:border-gold hover:text-gold transition-all flex items-center gap-1"
            >
              ↓ Exportar
            </button>
            {exportMenu && (
              <div className="absolute right-0 bottom-9 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden min-w-[150px]"
                   onMouseLeave={() => setExportMenu(false)}>
                <button className="w-full text-left text-xs px-4 py-3 hover:bg-bg transition-colors"
                  onClick={() => {
                    const titulo = TIPOS_ANALISE.find(t => t.id === analise.tipo)?.label ?? analise.tipo;
                    const sub = `${analise.modelo_ia} · confiança ${Math.round((analise.confianca ?? 0)*100)}%`;
                    exportarPDF(titulo, jsonToHtmlReport(titulo, sub, analise.conteudo_json, processo));
                    setExportMenu(false);
                  }}>
                  🖨 PDF (imprimir)
                </button>
                <button className="w-full text-left text-xs px-4 py-3 hover:bg-bg transition-colors"
                  onClick={() => {
                    const titulo = TIPOS_ANALISE.find(t => t.id === analise.tipo)?.label ?? analise.tipo;
                    const sub = `${analise.modelo_ia} · confiança ${Math.round((analise.confianca ?? 0)*100)}%`;
                    exportarWord(titulo, jsonToHtmlReport(titulo, sub, analise.conteudo_json, processo));
                    setExportMenu(false);
                  }}>
                  📄 Word (.doc)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Renderizador: Estratégia Vencedora ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EstrategiaVencedoraRenderer({ d }: { d: any }) {
  const prob = d?.probabilidade_exito ?? {};
  const campeao = d?.argumento_campeao ?? {};
  const top5: any[] = d?.top_argumentos ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const contra: any[] = d?.contra_argumentos_adversario ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const provas = d?.provas_decisivas ?? {};
  const jurisp: any[] = d?.jurisprudencia_de_ouro ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const plano30: any[] = d?.plano_30_dias ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const negociacao = d?.negociacao ?? {};
  const armadilhas: any[] = d?.armadilhas_criticas ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any

  const probTotal = (prob.vitoria_total ?? 0) + (prob.vitoria_parcial ?? 0);
  const corProb = probTotal >= 60 ? "text-green-600" : probTotal >= 40 ? "text-yellow-600" : "text-red-500";

  function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-surface px-4 py-2.5 border-b border-border">
          <p className="text-sm font-bold text-text-main">{title}</p>
        </div>
        <div className="p-4">{children}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ① Probabilidade de Êxito */}
      <div className="bg-gradient-to-r from-navy/5 to-gold/10 border border-gold/30 rounded-xl p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-muted mb-3">① Veredito de Probabilidade</p>
        <div className="flex items-center gap-6 mb-3 flex-wrap">
          <div className="text-center">
            <p className={`text-4xl font-black ${corProb}`}>{prob.vitoria_total ?? "—"}%</p>
            <p className="text-xs text-muted mt-0.5">Vitória Total</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-yellow-600">{prob.vitoria_parcial ?? "—"}%</p>
            <p className="text-xs text-muted mt-0.5">Vitória Parcial</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-400">{prob.derrota_total ?? "—"}%</p>
            <p className="text-xs text-muted mt-0.5">Derrota Total</p>
          </div>
          <div className="flex-1 min-w-[200px]">
            {/* Barra de probabilidade */}
            <div className="h-3 rounded-full bg-red-200 overflow-hidden">
              <div className="h-full flex">
                <div className="bg-green-500 transition-all" style={{ width: `${prob.vitoria_total ?? 0}%` }} />
                <div className="bg-yellow-400 transition-all" style={{ width: `${prob.vitoria_parcial ?? 0}%` }} />
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-muted mt-1">
              <span>🟢 Vitória</span><span>🟡 Parcial</span><span>🔴 Derrota</span>
            </div>
          </div>
        </div>
        {prob.justificativa && <p className="text-xs text-text-main italic border-l-2 border-gold pl-3">{prob.justificativa}</p>}
        {prob.jurisprudencia_base && (
          <p className="text-xs text-muted mt-2">📚 Base: {prob.jurisprudencia_base}</p>
        )}
        <div className="grid grid-cols-2 gap-3 mt-3">
          {(prob.fatores_positivos ?? []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1">✅ Fatores positivos</p>
              <ul className="space-y-0.5">{(prob.fatores_positivos ?? []).map((f: string, i: number) => (
                <li key={i} className="text-xs text-text-main">• {f}</li>
              ))}</ul>
            </div>
          )}
          {(prob.fatores_negativos ?? []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-600 mb-1">⚠️ Fatores negativos</p>
              <ul className="space-y-0.5">{(prob.fatores_negativos ?? []).map((f: string, i: number) => (
                <li key={i} className="text-xs text-text-main">• {f}</li>
              ))}</ul>
            </div>
          )}
        </div>
      </div>

      {/* ② Argumento Campeão */}
      {campeao.titulo && (
        <Section title="② Argumento Campeão 🥇">
          <div className="bg-gold/10 border border-gold/30 rounded-lg p-4">
            <p className="text-sm font-bold text-text-main mb-1">{campeao.titulo}</p>
            {campeao.fundamento_legal && (
              <p className="text-xs font-semibold text-gold mb-2">{campeao.fundamento_legal}</p>
            )}
            {campeao.descricao && <p className="text-xs text-text-main mb-2">{campeao.descricao}</p>}
            {campeao.precedente_vinculante && (
              <p className="text-xs bg-navy/5 rounded px-2 py-1 font-mono">📌 {campeao.precedente_vinculante}</p>
            )}
            {campeao.fonte_no_processo && (
              <p className="text-xs text-muted mt-2">Fonte: {campeao.fonte_no_processo}</p>
            )}
          </div>
        </Section>
      )}

      {/* ③ Top 5 Argumentos */}
      {top5.length > 0 && (
        <Section title="③ Top 5 Argumentos por Impacto">
          <div className="space-y-3">
            {top5.map((arg: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <div key={i} className="flex gap-3 items-start">
                <div className="w-7 h-7 rounded-full bg-gold text-navy text-xs font-black flex items-center justify-center shrink-0">
                  {arg.rank ?? i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-main">{arg.titulo}</p>
                  {arg.fundamento_legal && <p className="text-xs text-gold">{arg.fundamento_legal}</p>}
                  {arg.precedente && <p className="text-xs text-muted italic">Precedente: {arg.precedente}</p>}
                  {arg.como_articular && <p className="text-xs text-text-main mt-0.5">{arg.como_articular}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ④ Contra-argumentos do Adversário */}
      {contra.length > 0 && (
        <Section title="④ O Que o Adversário Vai Arguir (e Como Neutralizar)">
          <div className="space-y-3">
            {contra.map((c: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <div key={i} className={`border rounded-lg p-3 ${c.grau_perigo === "alto" ? "border-red-300 bg-red-50" : c.grau_perigo === "medio" ? "border-yellow-300 bg-yellow-50" : "border-border bg-bg"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.grau_perigo === "alto" ? "bg-red-500 text-white" : c.grau_perigo === "medio" ? "bg-yellow-400 text-navy" : "bg-muted/20 text-muted"}`}>
                    {c.grau_perigo?.toUpperCase() ?? "—"}
                  </span>
                  <p className="text-xs font-semibold text-text-main">{c.argumento_provavel}</p>
                </div>
                {c.como_neutralizar && (
                  <p className="text-xs text-green-700"><span className="font-semibold">↳ Neutralizar:</span> {c.como_neutralizar}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ⑤ Provas Decisivas */}
      {(provas.provas_a_produzir?.length > 0 || provas.provas_a_destacar?.length > 0) && (
        <Section title="⑤ Provas Decisivas">
          <div className="space-y-3">
            {provas.provas_a_produzir?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-orange-700 mb-2">🔬 Provas a Produzir</p>
                {provas.provas_a_produzir.map((p: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={i} className="flex gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded h-fit ${p.urgencia === "imediata" ? "bg-red-100 text-red-600" : p.urgencia === "breve" ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600"}`}>
                      {p.urgencia}
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-text-main">{p.descricao}</p>
                      {p.objetivo && <p className="text-xs text-muted">Objetivo: {p.objetivo}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {provas.provas_a_destacar?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-green-700 mb-1">✅ Provas a Destacar (já nos autos)</p>
                <ul className="space-y-0.5">{provas.provas_a_destacar.map((p: string, i: number) => (
                  <li key={i} className="text-xs text-text-main">• {p}</li>
                ))}</ul>
              </div>
            )}
            {provas.provas_a_impugnar?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-red-600 mb-1">❌ Provas a Impugnar</p>
                <ul className="space-y-0.5">{provas.provas_a_impugnar.map((p: string, i: number) => (
                  <li key={i} className="text-xs text-text-main">• {p}</li>
                ))}</ul>
              </div>
            )}
            {provas.alerta_provas_ilicitas && (
              <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2">
                <p className="text-xs font-bold text-red-600">⚠️ Alerta Provas Ilícitas</p>
                <p className="text-xs text-red-700">{provas.alerta_provas_ilicitas}</p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ⑥ Jurisprudência de Ouro */}
      {jurisp.length > 0 && (
        <Section title="⑥ Jurisprudência de Ouro">
          <div className="space-y-2">
            {jurisp.map((j: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <div key={i} className="bg-navy/5 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-navy px-2 py-0.5 rounded bg-navy/10">{j.tribunal}</span>
                  {j.numero_referencia && <span className="text-xs text-muted font-mono">{j.numero_referencia}</span>}
                </div>
                {j.ementa_resumida && <p className="text-xs italic text-text-main mb-1">"{j.ementa_resumida}"</p>}
                {j.argumento_suportado && <p className="text-xs text-blue-700">↳ Suporta: {j.argumento_suportado}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ⑦ Plano de Ataque 30 Dias */}
      {plano30.length > 0 && (
        <Section title="⑦ Plano de Ataque — Próximos 30 Dias">
          <div className="space-y-2">
            {plano30.map((a: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <div key={i} className="flex gap-3 items-start border border-border rounded-lg p-3">
                <div className="w-7 h-7 rounded-full bg-navy text-white text-xs font-black flex items-center justify-center shrink-0">
                  {a.prioridade ?? i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-text-main">{a.acao}</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {a.prazo && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">⏰ {a.prazo}</span>}
                    {a.responsavel && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">👤 {a.responsavel}</span>}
                  </div>
                  {a.fundamento && <p className="text-xs text-muted mt-1">{a.fundamento}</p>}
                  {a.consequencia_de_nao_agir && (
                    <p className="text-xs text-red-600 mt-1">⚠️ Se não agir: {a.consequencia_de_nao_agir}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ⑧ Negociação */}
      {negociacao.momento_ideal && (
        <Section title="⑧ Análise de Acordo">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-muted mb-1">Momento ideal</p>
              <p className="text-sm font-bold text-text-main">{negociacao.momento_ideal?.replace(/_/g, " ")}</p>
              {negociacao.piso_recomendado && <p className="text-xs text-muted mt-1">Piso: {negociacao.piso_recomendado}</p>}
              {negociacao.teto_aceitavel && <p className="text-xs text-muted">Teto: {negociacao.teto_aceitavel}</p>}
            </div>
            <div>
              {negociacao.vantagens_de_litigar?.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-navy mb-1">Vantagens de litigar</p>
                  <ul className="space-y-0.5">{negociacao.vantagens_de_litigar.map((v: string, i: number) => (
                    <li key={i} className="text-xs text-text-main">• {v}</li>
                  ))}</ul>
                </div>
              )}
              {negociacao.vantagens_de_acordar?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-green-700 mb-1">Vantagens de acordar</p>
                  <ul className="space-y-0.5">{negociacao.vantagens_de_acordar.map((v: string, i: number) => (
                    <li key={i} className="text-xs text-text-main">• {v}</li>
                  ))}</ul>
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* ⑨ Armadilhas Críticas */}
      {armadilhas.length > 0 && (
        <Section title="⑨ Armadilhas Críticas — Não Cometa Esses Erros">
          <div className="space-y-2">
            {armadilhas.map((a: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <div key={i} className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-xs font-bold text-red-700">💣 {a.armadilha}</p>
                {a.consequencia && <p className="text-xs text-red-600 mt-0.5">Consequência: {a.consequencia}</p>}
                {a.como_evitar && <p className="text-xs text-green-700 mt-1">✅ Como evitar: {a.como_evitar}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Mensagem ao Cliente */}
      {d?.mensagem_ao_cliente && (
        <div className="bg-gold/10 border border-gold/30 rounded-xl p-4">
          <p className="text-xs font-bold text-gold mb-2">💬 Mensagem ao Cliente</p>
          <p className="text-sm text-text-main leading-relaxed italic">"{d.mensagem_ao_cliente}"</p>
        </div>
      )}

    </div>
  );
}

// ── Renderizador especializado para Descrição de Documentos ─────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DescricaoDocumentosRenderer({ d }: { d: any }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs: any[] = d?.documentos ?? [];

  const relevanciaStyle: Record<string, string> = {
    essencial: "border-l-red-500 bg-red-50/30",
    alta:      "border-l-orange-400 bg-orange-50/30",
    media:     "border-l-yellow-400 bg-yellow-50/30",
    baixa:     "border-l-gray-300 bg-bg",
  };
  const relevanciaBadge: Record<string, string> = {
    essencial: "bg-red-100 text-red-700",
    alta:      "bg-orange-100 text-orange-700",
    media:     "bg-yellow-100 text-yellow-700",
    baixa:     "bg-gray-100 text-gray-500",
  };

  return (
    <div className="space-y-5 text-sm">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between bg-navy/5 rounded-xl px-4 py-3">
        <span className="text-sm font-bold text-navy">
          📋 {docs.length} peça{docs.length !== 1 ? "s" : ""} descritas
        </span>
        {d?.observacoes_gerais && (
          <span className="text-xs text-muted max-w-[60%] text-right">{d.observacoes_gerais}</span>
        )}
      </div>

      {docs.length === 0 && (
        <p className="text-muted text-sm text-center py-6">Nenhuma peça encontrada.</p>
      )}

      {docs.map((doc: any, i: number) => {
        const rel = String(doc.relevancia_documental ?? "media").toLowerCase();
        return (
          <div key={i} className={`rounded-xl border border-border border-l-4 ${relevanciaStyle[rel] ?? "border-l-gray-300"} p-4 space-y-3`}>
            {/* Cabeçalho da peça */}
            <div className="flex flex-wrap items-start gap-2 justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-text-main text-sm uppercase">
                  {String(doc.tipo_peca ?? "").replace(/_/g, " ")}
                </span>
                <span className="text-xs text-muted">{doc.paginas}</span>
                {doc.data_documento && (
                  <span className="text-xs bg-navy/10 text-navy px-2 py-0.5 rounded font-semibold">
                    {doc.data_documento}
                  </span>
                )}
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${relevanciaBadge[rel] ?? "bg-gray-100 text-gray-500"}`}>
                {doc.relevancia_documental ?? "media"}
              </span>
            </div>

            {/* Autor / órgão */}
            {(doc.autor || doc.orgao_juizo) && (
              <div className="flex flex-wrap gap-4 text-xs text-muted">
                {doc.autor && <span><strong>Autor:</strong> {doc.autor}</span>}
                {doc.orgao_juizo && <span><strong>Órgão:</strong> {doc.orgao_juizo}</span>}
                {doc.destinatario && <span><strong>Para:</strong> {doc.destinatario}</span>}
              </div>
            )}

            {/* Função processual */}
            {doc.funcao_processual && (
              <p className="text-xs text-muted italic">{doc.funcao_processual}</p>
            )}

            {/* Descrição fiel */}
            {doc.descricao_fiel && (
              <p className="text-sm text-text-main leading-relaxed">{doc.descricao_fiel}</p>
            )}

            {/* Dispositivo literal */}
            {doc.transcricao_dispositivo && (
              <div className="bg-navy/5 rounded-lg p-3 border-l-2 border-navy">
                <p className="text-xs font-bold text-navy uppercase mb-1">Dispositivo (transcrição literal)</p>
                <p className="text-xs text-text-main leading-relaxed whitespace-pre-wrap font-mono">{doc.transcricao_dispositivo}</p>
              </div>
            )}

            {/* Pedidos */}
            {Array.isArray(doc.pedidos) && doc.pedidos.length > 0 && (
              <div>
                <p className="text-xs font-bold text-text-main uppercase mb-1">Pedidos</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  {doc.pedidos.map((p: string, j: number) => (
                    <li key={j} className="text-xs text-text-main">{p}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Fundamentos legais + valores */}
            <div className="flex flex-wrap gap-4">
              {Array.isArray(doc.fundamentos_legais_citados) && doc.fundamentos_legais_citados.length > 0 && (
                <div className="flex-1 min-w-[200px]">
                  <p className="text-xs font-bold text-text-main uppercase mb-1">Fundamentos</p>
                  <div className="flex flex-wrap gap-1">
                    {doc.fundamentos_legais_citados.map((f: string, j: number) => (
                      <span key={j} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{f}</span>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(doc.valores_mencionados) && doc.valores_mencionados.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-text-main uppercase mb-1">Valores</p>
                  <div className="flex flex-wrap gap-1">
                    {doc.valores_mencionados.map((v: string, j: number) => (
                      <span key={j} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded font-semibold">{v}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Partes mencionadas */}
            {Array.isArray(doc.partes_mencionadas) && doc.partes_mencionadas.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {doc.partes_mencionadas.map((p: string, j: number) => (
                  <span key={j} className="text-xs bg-surface border border-border px-2 py-0.5 rounded">{p}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Renderizador especializado para Diagnóstico Completo ────────────────────

function RiscoTag({ s }: { s: string }) {
  const m: Record<string, string> = {
    critica: "bg-red-100 text-red-700 border-red-200",
    alta: "bg-orange-100 text-orange-700 border-orange-200",
    alto: "bg-orange-100 text-orange-700 border-orange-200",
    media: "bg-yellow-100 text-yellow-700 border-yellow-200",
    medio: "bg-yellow-100 text-yellow-700 border-yellow-200",
    baixa: "bg-green-100 text-green-700 border-green-200",
    baixo: "bg-green-100 text-green-700 border-green-200",
  };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${m[s.toLowerCase()] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>{s}</span>;
}

function PerspTag({ p }: { p: string }) {
  const m: Record<string, string> = {
    favoravel: "bg-green-100 text-green-700",
    desfavoravel: "bg-red-100 text-red-700",
    incerta: "bg-yellow-100 text-yellow-700",
    equilibrada: "bg-blue-100 text-blue-700",
  };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${m[p] ?? "bg-gray-100 text-gray-600"}`}>{p}</span>;
}

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
      <span className="text-base">{icon}</span>
      <h4 className="text-sm font-bold text-text-main uppercase tracking-wide">{title}</h4>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DiagnosticoRenderer({ d }: { d: any }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cronologia: any[] = d.cronologia_marcos ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const falhas: any = d.falhas_e_oportunidades;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vantagens: any[] = falhas?.vantagem_do_cliente ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const riscosDoCli: any[] = falhas?.risco_do_cliente ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teses: any = d.teses_juridicas;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const naoLevantadas: any[] = teses?.nao_levantadas_mas_deveriam ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adversario: any[] = teses?.do_adversario_que_preocupam ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const levantadas: any[] = teses?.levantadas_pelo_cliente ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const estrategia: any = d.estrategia_recomendada;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proxPassos: any[] = d.proximos_passos ?? [];
  const alertas: string[] = d.alertas_criticos ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const avaliacao: any = d.avaliacao_chances;

  return (
    <div className="space-y-6 text-sm">
      {/* Cabeçalho executivo */}
      <div className="bg-navy/5 rounded-xl p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {d.instancia && <span className="text-xs bg-navy/10 text-navy px-2 py-0.5 rounded font-semibold">{String(d.instancia)}</span>}
          {d.fase_processual && <span className="text-xs text-muted">{String(d.fase_processual)}</span>}
          {d.valor_causa && <span className="text-xs text-muted">Valor: {String(d.valor_causa)}</span>}
          {d.nivel_risco_global && <RiscoTag s={String(d.nivel_risco_global)} />}
          {avaliacao?.perspectiva && <PerspTag p={String(avaliacao.perspectiva)} />}
        </div>
        {d.situacao_executiva && (
          <p className="text-sm text-text-main leading-relaxed font-medium">{String(d.situacao_executiva)}</p>
        )}
        {avaliacao && (
          <div className="mt-2 space-y-1">
            {avaliacao.percentual_estimado && (
              <p className="text-xs text-muted"><strong>Estimativa:</strong> {String(avaliacao.percentual_estimado)}</p>
            )}
            {avaliacao.justificativa && (
              <p className="text-xs text-muted">{String(avaliacao.justificativa)}</p>
            )}
          </div>
        )}
      </div>

      {/* Alertas críticos */}
      {alertas.length > 0 && (
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <SectionTitle icon="🚨" title="Alertas Críticos" />
          <ul className="space-y-1.5">
            {alertas.map((a, i) => (
              <li key={i} className="flex gap-2 text-red-700 text-xs"><span className="flex-shrink-0">▶</span><span>{a}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* Cronologia de marcos */}
      {cronologia.length > 0 && (
        <div>
          <SectionTitle icon="📅" title="Cronologia — Marcos do Processo" />
          <div className="relative">
            <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
            <div className="space-y-3 pl-8">
              {cronologia.map((ev, i) => {
                const relev = String(ev.relevancia ?? "media");
                const dotColor = relev === "critica" ? "bg-red-500" : relev === "alta" ? "bg-orange-400" : "bg-gold";
                return (
                  <div key={i} className="relative">
                    <div className={`absolute -left-5 top-2 w-2.5 h-2.5 rounded-full ${dotColor}`} />
                    <div className="bg-bg rounded-lg border border-border p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted">
                          {ev.data ? new Date(String(ev.data) + "T12:00:00").toLocaleDateString("pt-BR") : "Data?"}
                        </span>
                        <RelevBadge r={relev} />
                        {ev.tipo && <span className="text-xs text-muted">{String(ev.tipo).replace(/_/g, " ")}</span>}
                      </div>
                      <p className="text-xs text-text-main">{String(ev.descricao ?? "")}</p>
                      {ev.fonte_peca && <p className="text-xs text-muted mt-1 italic">{String(ev.fonte_peca)}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Falhas e oportunidades */}
      {(vantagens.length > 0 || riscosDoCli.length > 0) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {vantagens.length > 0 && (
            <div className="bg-green-50 rounded-xl border border-green-200 p-4">
              <SectionTitle icon="✅" title="Oportunidades para o Cliente" />
              <div className="space-y-3">
                {vantagens.map((v, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <RiscoTag s={String(v.potencial ?? "medio")} />
                      <span className="text-xs font-semibold text-green-800">{String(v.tipo ?? "").replace(/_/g, " ")}</span>
                    </div>
                    <p className="text-xs text-text-main">{String(v.descricao ?? "")}</p>
                    {v.fundamento_legal && <p className="text-xs text-muted">⚖ {String(v.fundamento_legal)}</p>}
                    {v.como_explorar && <p className="text-xs text-green-700 font-medium">→ {String(v.como_explorar)}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {riscosDoCli.length > 0 && (
            <div className="bg-red-50 rounded-xl border border-red-200 p-4">
              <SectionTitle icon="⚠️" title="Riscos para o Cliente" />
              <div className="space-y-3">
                {riscosDoCli.map((r, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <RiscoTag s={String(r.severidade ?? "media")} />
                      <span className="text-xs font-semibold text-red-800">{String(r.tipo ?? "").replace(/_/g, " ")}</span>
                    </div>
                    <p className="text-xs text-text-main">{String(r.descricao ?? "")}</p>
                    {r.fundamento_legal && <p className="text-xs text-muted">⚖ {String(r.fundamento_legal)}</p>}
                    {r.como_mitigar && <p className="text-xs text-orange-700 font-medium">→ Mitigação: {String(r.como_mitigar)}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Teses jurídicas */}
      {teses && (
        <div className="space-y-4">
          <SectionTitle icon="⚖" title="Teses Jurídicas" />
          {levantadas.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Levantadas pelo cliente</p>
              <div className="space-y-2">
                {levantadas.map((t, i) => (
                  <div key={i} className="bg-bg rounded-lg border border-border p-3 flex items-start gap-3">
                    <RiscoTag s={String(t.forca ?? "razoavel")} />
                    <div>
                      <p className="text-xs text-text-main">{String(t.tese ?? "")}</p>
                      {t.fundamento && <p className="text-xs text-muted mt-0.5">⚖ {String(t.fundamento)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {naoLevantadas.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide mb-2">⚡ Teses não levantadas — deveriam ser</p>
              <div className="space-y-2">
                {naoLevantadas.map((t, i) => (
                  <div key={i} className="bg-orange-50 rounded-lg border border-orange-200 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <RiscoTag s={String(t.potencial ?? "medio")} />
                      <span className="text-xs font-semibold text-orange-800">potencial</span>
                    </div>
                    <p className="text-xs text-text-main">{String(t.tese ?? "")}</p>
                    {t.fundamento && <p className="text-xs text-muted mt-0.5">⚖ {String(t.fundamento)}</p>}
                    {t.observacao && <p className="text-xs text-orange-700 mt-0.5 italic">{String(t.observacao)}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {adversario.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Teses do adversário que preocupam</p>
              <div className="space-y-2">
                {adversario.map((t, i) => (
                  <div key={i} className="bg-bg rounded-lg border border-border p-3 flex items-start gap-3">
                    <RiscoTag s={String(t.risco ?? "medio")} />
                    <div>
                      <p className="text-xs text-text-main">{String(t.tese ?? "")}</p>
                      {t.fundamento && <p className="text-xs text-muted mt-0.5">⚖ {String(t.fundamento)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Estratégia recomendada */}
      {estrategia && (
        <div className="bg-navy/5 rounded-xl border border-navy/20 p-4 space-y-3">
          <SectionTitle icon="🎯" title={`Estratégia: ${String(estrategia.nome ?? "")}`} />
          {estrategia.descricao && <p className="text-xs text-text-main leading-relaxed">{String(estrategia.descricao)}</p>}
          {Array.isArray(estrategia.acoes_concretas) && estrategia.acoes_concretas.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Ações concretas</p>
              <ul className="space-y-1">
                {(estrategia.acoes_concretas as string[]).map((a, i) => (
                  <li key={i} className="flex gap-2 text-xs text-text-main"><span className="text-gold flex-shrink-0">{i+1}.</span><span>{a}</span></li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(estrategia.pecas_a_protocolar) && estrategia.pecas_a_protocolar.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Peças a protocolar</p>
              <ul className="space-y-1">
                {(estrategia.pecas_a_protocolar as string[]).map((p, i) => (
                  <li key={i} className="flex gap-2 text-xs text-text-main"><span className="text-blue-500 flex-shrink-0">•</span><span>{p}</span></li>
                ))}
              </ul>
            </div>
          )}
          {estrategia.probabilidade_sucesso && (
            <p className="text-xs text-green-700 font-semibold">📊 {String(estrategia.probabilidade_sucesso)}</p>
          )}
        </div>
      )}

      {/* Próximos passos */}
      {proxPassos.length > 0 && (
        <div>
          <SectionTitle icon="📋" title="Próximos Passos" />
          <div className="space-y-2">
            {proxPassos.map((p, i) => {
              const urg = String(p.urgencia ?? "normal");
              const urgColor = urg === "critica" ? "border-red-400 bg-red-50" : urg === "urgente" ? "border-orange-400 bg-orange-50" : urg === "alta" ? "border-yellow-400 bg-yellow-50" : "border-border bg-bg";
              return (
                <div key={i} className={`rounded-lg border-l-4 p-3 ${urgColor}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <RiscoTag s={urg} />
                    {p.prazo_legal && <span className="text-xs text-muted">{String(p.prazo_legal)}</span>}
                    {p.vencimento_estimado && <span className="text-xs font-mono text-orange-600">{new Date(String(p.vencimento_estimado) + "T12:00:00").toLocaleDateString("pt-BR")}</span>}
                  </div>
                  <p className="text-xs font-semibold text-text-main">{String(p.acao ?? "")}</p>
                  {p.consequencia_inacao && <p className="text-xs text-red-600 mt-0.5">⚠ Se não agir: {String(p.consequencia_inacao)}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Renderizador genérico (fallback) ──────────────────────────────────────────

function AnaliseConteudo({ conteudo }: { conteudo: Record<string, unknown> }) {
  // Renderiza o JSON de forma legível e organizada
  const renderValue = (v: unknown, depth = 0): React.ReactNode => {
    if (v === null || v === undefined) return <span className="text-muted">—</span>;
    if (typeof v === "boolean") return <span className={v ? "text-green-600" : "text-red-500"}>{v ? "Sim" : "Não"}</span>;
    if (typeof v === "number") return <span className="text-blue-600">{v}</span>;
    if (typeof v === "string") return <span className="text-text-main">{v}</span>;
    if (Array.isArray(v)) {
      if (!v.length) return <span className="text-muted italic">Nenhum</span>;
      if (typeof v[0] === "string") return (
        <ul className="space-y-1 mt-1">
          {v.map((item, i) => <li key={i} className="flex gap-2"><span className="text-gold flex-shrink-0">•</span><span>{item}</span></li>)}
        </ul>
      );
      return <div className="space-y-2 mt-1">{v.map((item, i) => <div key={i} className="pl-3 border-l-2 border-border">{renderValue(item, depth+1)}</div>)}</div>;
    }
    if (typeof v === "object") {
      return (
        <div className={depth > 0 ? "space-y-1" : "space-y-3"}>
          {Object.entries(v as Record<string, unknown>).map(([k, val]) => (
            <div key={k}>
              <span className="text-xs font-bold text-muted uppercase tracking-wide">{k.replace(/_/g, " ")}: </span>
              {renderValue(val, depth+1)}
            </div>
          ))}
        </div>
      );
    }
    return <span>{String(v)}</span>;
  };

  return <div className="text-sm">{renderValue(conteudo)}</div>;
}

function AbaAnalises({ processoId, processo, onRefreshProcesso }: { processoId: string; processo?: Processo | null; onRefreshProcesso: () => void }) {
  const [analises, setAnalises] = useState<Analise[]>([]);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState<string | null>(null);
  const [streamMsg, setStreamMsg] = useState<string>("");
  const [streamPct, setStreamPct] = useState<number>(0);
  const [modalAnalise, setModalAnalise] = useState<Analise | null>(null);
  const [deletandoAnalise, setDeletandoAnalise] = useState<string | null>(null);
  const [docsSelecionados, setDocsSelecionados] = useState<string[]>([]);
  const [mostrarSeletor, setMostrarSeletor] = useState(false);
  const [tipoSelecionado, setTipoSelecionado] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    Promise.all([
      api.analises.listar(processoId),
      api.documentos.listar(processoId),
    ]).then(([a, d]) => {
      setAnalises(a);
      const processados = d.filter(x => x.status === "processado");
      setDocs(processados);
      setDocsSelecionados(processados.map(x => x.id));
    }).finally(() => setLoading(false));
  }, [processoId]);

  function iniciarGeracao(tipoId: string) {
    setTipoSelecionado(tipoId);
    setMostrarSeletor(true);
  }

  async function confirmarGeracao() {
    if (!tipoSelecionado) return;
    setMostrarSeletor(false);
    setGerando(tipoSelecionado);
    setStreamMsg("Iniciando análise…");
    setStreamPct(0);

    const docIds = docsSelecionados.length < docs.length ? docsSelecionados : undefined;
    const tipoLabel = TIPOS_ANALISE.find(t => t.id === tipoSelecionado)?.label ?? tipoSelecionado.replace(/_/g, " ");
    const inicioMs = Date.now();

    try {
      const resp = await api.analises.stream(processoId, tipoSelecionado, undefined, docIds);
      if (!resp.body) throw new Error("Stream indisponível");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === "progress") {
              setStreamMsg(ev.msg ?? "");
              setStreamPct(ev.pct ?? 0);
            } else if (ev.type === "done") {
              setStreamPct(100);
              setStreamMsg("Análise concluída!");
              setAnalises(prev => [ev.analise as Analise, ...prev]);

              // Auto-registra tempo de análise no timesheet
              const duracaoMin = Math.max(1, Math.round((Date.now() - inicioMs) / 60000));
              api.timesheet.lancar(processoId, {
                descricao: `Análise IA: ${tipoLabel}`,
                tipo: "analise_ia",
                duracao_min: duracaoMin,
                data_lancamento: new Date().toISOString().split("T")[0],
              }).catch(() => {}); // silencioso — timesheet é best-effort
            } else if (ev.type === "error") {
              throw new Error(ev.msg ?? "Erro ao gerar análise");
            }
          } catch {
            // Ignora chunks malformados
          }
        }
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao gerar análise");
    } finally {
      setGerando(null);
      setTipoSelecionado(null);
      setStreamMsg("");
      setStreamPct(0);
    }
  }

  async function handleDeleteAnalise(analiseId: string, tipo: string) {
    const label = getLabelAnalise(tipo);
    if (!confirm(`Excluir a análise "${label}"?`)) return;
    setDeletandoAnalise(analiseId);
    try {
      await api.analises.deletar(processoId, analiseId);
      setAnalises(prev => prev.filter(a => a.id !== analiseId));
      if (modalAnalise?.id === analiseId) setModalAnalise(null);
      onRefreshProcesso(); // update tarefas_pendentes badge
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setDeletandoAnalise(null);
    }
  }

  function toggleDoc(id: string) {
    setDocsSelecionados(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  const revisaoMap: Record<string, string> = {
    pendente:  "bg-yellow-100 text-yellow-700",
    aprovada:  "bg-green-100 text-green-700",
    rejeitada: "bg-red-100 text-red-700",
    editada:   "bg-blue-100 text-blue-700",
  };

  function getLabelAnalise(tipo: string) {
    const t = TIPOS_ANALISE.find(x => x.id === tipo);
    return t?.label ?? tipo.replace(/_/g, " ");
  }

  const analisesFiltradas = analises.filter(a => {
    const label = getLabelAnalise(a.tipo);
    return label.toLowerCase().includes(busca.toLowerCase()) ||
      a.status_revisao.toLowerCase().includes(busca.toLowerCase());
  });

  return (
    <>
      <div className="space-y-6">
        {/* Painel gerar análise */}
        <div className={`rounded-xl border p-5 space-y-4 transition-all ${gerando ? "border-gold bg-gold/5" : "bg-gray-50 border-border"}`}>
          {gerando ? (
            /* ── Progresso em tempo real ── */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Spinner sm />
                  <p className="text-sm font-bold text-gold">{getLabelAnalise(gerando)}</p>
                </div>
                <span className="text-xs text-muted font-semibold">{streamPct}%</span>
              </div>
              <p className="text-xs text-text-main">{streamMsg || "Aguardando…"}</p>
              <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-gold rounded-full transition-all duration-700"
                  style={{ width: `${streamPct}%` }}
                />
              </div>
              <p className="text-xs text-muted text-center">
                A análise pode levar de 30 segundos a alguns minutos dependendo do tamanho do processo.
              </p>
            </div>
          ) : (
            <>
              <div>
                <h3 className="text-sm font-bold text-text-main mb-1">Gerar nova análise</h3>
                <p className="text-xs text-muted">
                  Clique no tipo desejado. Você poderá escolher quais documentos usar antes de confirmar.
                </p>
              </div>

              {/* Estratégia Vencedora — destaque premium */}
              {(() => {
                const dc = TIPOS_ANALISE.find(t => t.premium);
                if (!dc) return null;
                return (
                  <button onClick={() => iniciarGeracao(dc.id)} disabled={!!gerando}
                    className="w-full flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all border-gold/60 bg-gradient-to-r from-gold/5 to-transparent hover:border-gold hover:from-gold/10">
                    <div className="text-2xl flex-shrink-0">🏆</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-text-main">{dc.label}</p>
                      <p className="text-xs text-muted mt-0.5">{dc.descricao}</p>
                    </div>
                    <span className="text-xs font-semibold text-gold flex-shrink-0">Gerar →</span>
                  </button>
                );
              })()}

              {/* Análises individuais */}
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Análises individuais</p>
                <div className="flex flex-wrap gap-2">
                  {TIPOS_ANALISE.filter(t => !t.premium).map(t => (
                    <button key={t.id} onClick={() => iniciarGeracao(t.id)} disabled={!!gerando}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all border-border hover:border-gold hover:text-gold hover:bg-gold/5 disabled:opacity-50 disabled:cursor-not-allowed">
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {loading && <div className="flex justify-center py-8"><Spinner /></div>}

        {/* Custo total + busca */}
        {!loading && analises.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <SearchBar value={busca} onChange={setBusca} placeholder="Buscar análises…" />
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-muted">Custo total IA</p>
              <p className="text-sm font-bold text-green-700">{calcCustoTotal(analises).label}</p>
            </div>
          </div>
        )}

        {/* Lista de análises */}
        {analisesFiltradas.map(a => (
          <div key={a.id}
            className="bg-bg rounded-xl border border-border hover:border-gold/40 transition-colors cursor-pointer"
            onClick={() => setModalAnalise(a)}>
            <div className="flex items-start justify-between gap-3 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${a.tipo === "diagnostico_completo" ? "text-gold" : "text-text-main"}`}>
                    {getLabelAnalise(a.tipo)}
                  </span>
                  <StatusBadge s={a.status_revisao} map={revisaoMap} />
                  {a.confianca !== undefined && (
                    <span className="text-xs text-muted">confiança {Math.round(a.confianca * 100)}%</span>
                  )}
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {fmtDataHora(a.created_at)} · {a.modelo_ia} · {(a.tokens_input ?? 0)+(a.tokens_output ?? 0)} tokens
                  {" · "}<span className="text-green-700 font-semibold">{calcCustoAnalise(a.modelo_ia, a.tokens_input ?? 0, a.tokens_output ?? 0).label}</span>
                </p>
              </div>
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                {a.status_revisao === "pendente" && (
                  <>
                    <Btn variant="green" onClick={async () => {
                      const upd = await api.analises.aprovar(processoId, a.id);
                      setAnalises(prev => prev.map(x => x.id === a.id ? upd : x));
                    }}>Aprovar</Btn>
                    <Btn variant="danger" onClick={async () => {
                      const c = prompt("Motivo da rejeição:");
                      if (c === null) return;
                      const upd = await api.analises.rejeitar(processoId, a.id, c);
                      setAnalises(prev => prev.map(x => x.id === a.id ? upd : x));
                    }}>Rejeitar</Btn>
                  </>
                )}
                <Btn onClick={() => setModalAnalise(a)}>Ver</Btn>
                <Btn variant="danger"
                  onClick={() => handleDeleteAnalise(a.id, a.tipo)}
                  disabled={deletandoAnalise === a.id}>
                  {deletandoAnalise === a.id ? "…" : "Excluir"}
                </Btn>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal seletor de documentos */}
      {mostrarSeletor && (
        <Modal title={`Gerar: ${getLabelAnalise(tipoSelecionado ?? "")}`} onClose={() => setMostrarSeletor(false)}>
          <div className="space-y-4">
            <p className="text-sm text-muted">Selecione os documentos a usar nesta análise:</p>
            {docs.length === 0 ? (
              <p className="text-sm text-red-500">Nenhum documento processado.</p>
            ) : (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-text-main cursor-pointer pb-2 border-b border-border">
                  <input type="checkbox"
                    checked={docsSelecionados.length === docs.length}
                    onChange={() => setDocsSelecionados(
                      docsSelecionados.length === docs.length ? [] : docs.map(d => d.id)
                    )} />
                  Todos ({docs.length})
                </label>
                {docs.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
                    <input type="checkbox"
                      checked={docsSelecionados.includes(d.id)}
                      onChange={() => toggleDoc(d.id)} />
                    <span className="truncate">{d.nome_original}</span>
                    <span className="text-xs text-muted flex-shrink-0">{d.total_paginas} pág.</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2 border-t border-border">
              <Btn onClick={() => setMostrarSeletor(false)}>Cancelar</Btn>
              <button onClick={confirmarGeracao}
                disabled={docsSelecionados.length === 0}
                className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all disabled:opacity-50">
                Gerar Análise ({docsSelecionados.length} doc{docsSelecionados.length !== 1 ? "s" : ""})
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal de análise aberta */}
      {modalAnalise && (
        <ModalAnalise
          analise={modalAnalise}
          processoId={processoId}
          processo={processo}
          onUpdate={upd => {
            setAnalises(prev => prev.map(x => x.id === upd.id ? upd : x));
            setModalAnalise(upd);
          }}
          onDelete={id => setAnalises(prev => prev.filter(x => x.id !== id))}
          onClose={() => setModalAnalise(null)}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA: REVISÃO
// ════════════════════════════════════════════════════════════════════════════

function ModalTarefa({ tarefa, onUpdate, onClose }: {
  tarefa: TarefaRevisao; onUpdate: (t: TarefaRevisao) => void; onClose: () => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);

  async function atualizar(status: string) {
    const comentario = status === "rejeitado" ? (prompt("Comentário:") ?? "") : undefined;
    setLoading(status);
    try {
      const t = await api.revisao.atualizar(tarefa.id, { status, comentario });
      onUpdate(t);
    } finally { setLoading(null); }
  }

  const statusMap: Record<string, string> = {
    pendente:   "bg-yellow-100 text-yellow-700",
    em_revisao: "bg-yellow-50 text-yellow-600",
    aprovado:   "bg-green-100 text-green-700",
    rejeitado:  "bg-red-100 text-red-700",
    cancelado:  "bg-gray-100 text-gray-500",
  };

  return (
    <Modal title={tarefa.titulo} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge s={tarefa.status} map={statusMap} />
          <span className={`text-xs font-bold ${tarefa.prioridade === "urgente" ? "text-red-600" : tarefa.prioridade === "alta" ? "text-orange-500" : "text-muted"}`}>
            {tarefa.prioridade.toUpperCase()}
          </span>
        </div>
        {tarefa.descricao && <p className="text-sm text-muted">{tarefa.descricao}</p>}
        {tarefa.deadline && <p className="text-sm text-orange-500 font-medium">Prazo: {fmtData(tarefa.deadline)}</p>}
        {tarefa.comentario && (
          <div className="bg-bg rounded-lg p-3 border border-border">
            <p className="text-xs font-semibold text-muted mb-1">Comentário:</p>
            <p className="text-sm text-text-main">{tarefa.comentario}</p>
          </div>
        )}
        {tarefa.status === "pendente" && (
          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <Btn variant="danger" onClick={() => atualizar("rejeitado")} disabled={!!loading}>
              {loading === "rejeitado" ? "…" : "Rejeitar"}
            </Btn>
            <button onClick={() => atualizar("aprovado")} disabled={!!loading}
              className="bg-green-600 text-white font-semibold rounded-lg px-4 py-2 text-sm hover:bg-green-700 transition-all disabled:opacity-50">
              {loading === "aprovado" ? "…" : "✓ Aprovar"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function AbaRevisao({ processoId, onRefreshProcesso }: { processoId: string; onRefreshProcesso: () => void }) {
  const [tarefas, setTarefas] = useState<TarefaRevisao[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalTarefa, setModalTarefa] = useState<TarefaRevisao | null>(null);
  const [deletando, setDeletando] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [timesheetAberto, setTimesheetAberto] = useState<string | null>(null);

  async function handleDeletar(id: string, titulo: string) {
    if (!confirm(`Excluir a tarefa "${titulo}"?`)) return;
    setDeletando(id);
    try {
      await api.revisao.deletar(id);
      setTarefas(prev => prev.filter(t => t.id !== id));
      onRefreshProcesso();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setDeletando(null);
    }
  }

  useEffect(() => {
    api.revisao.tarefas(undefined, processoId).then(setTarefas).finally(() => setLoading(false));
  }, [processoId]);

  const statusMap: Record<string, string> = {
    pendente:   "bg-yellow-100 text-yellow-700",
    em_revisao: "bg-yellow-50 text-yellow-600",
    aprovado:   "bg-green-100 text-green-700",
    rejeitado:  "bg-red-100 text-red-700",
    cancelado:  "bg-gray-100 text-gray-500",
  };

  const tarefasFiltradas = tarefas.filter(t =>
    t.titulo.toLowerCase().includes(busca.toLowerCase()) ||
    t.status.toLowerCase().includes(busca.toLowerCase()) ||
    t.prioridade.toLowerCase().includes(busca.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!tarefas.length) return <div className="text-center py-16 text-muted text-sm">Nenhuma tarefa de revisão.</div>;

  return (
    <>
      <div className="mb-4">
        <SearchBar value={busca} onChange={setBusca} placeholder="Buscar tarefas…" />
      </div>
      <div className="space-y-3">
        {tarefasFiltradas.map(t => (
          <div key={t.id}
            className="bg-bg rounded-xl border border-border p-4 hover:border-gold/40 transition-colors cursor-pointer"
            onClick={() => setModalTarefa(t)}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold uppercase ${t.prioridade === "urgente" ? "text-red-600" : t.prioridade === "alta" ? "text-orange-500" : "text-muted"}`}>
                    {t.prioridade}
                  </span>
                  <StatusBadge s={t.status} map={statusMap} />
                </div>
                <p className="text-sm font-semibold text-text-main">{t.titulo}</p>
                {t.descricao && <p className="text-xs text-muted mt-1 line-clamp-2">{t.descricao}</p>}
                {t.deadline && <p className="text-xs text-orange-500 mt-1">Prazo: {fmtData(t.deadline)}</p>}
              </div>
              <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setTimesheetAberto(timesheetAberto === t.id ? null : t.id)}
                  title="Timesheet"
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors font-semibold ${
                    timesheetAberto === t.id
                      ? "bg-gold text-navy border-gold"
                      : "border-border text-muted hover:border-gold/40 hover:text-text-main"
                  }`}>
                  ⏱
                </button>
                {t.status === "pendente" && (
                  <>
                    <Btn variant="green" onClick={async () => {
                      const upd = await api.revisao.atualizar(t.id, { status: "aprovado" });
                      setTarefas(prev => prev.map(x => x.id === t.id ? upd : x));
                      onRefreshProcesso();
                    }}>Aprovar</Btn>
                    <Btn variant="danger" onClick={async () => {
                      const c = prompt("Comentário:") ?? "";
                      const upd = await api.revisao.atualizar(t.id, { status: "rejeitado", comentario: c });
                      setTarefas(prev => prev.map(x => x.id === t.id ? upd : x));
                      onRefreshProcesso();
                    }}>Rejeitar</Btn>
                  </>
                )}
                <Btn variant="danger"
                  onClick={() => handleDeletar(t.id, t.titulo)}
                  disabled={deletando === t.id}>
                  {deletando === t.id ? "…" : "Excluir"}
                </Btn>
              </div>
            </div>
            {timesheetAberto === t.id && (
              <div onClick={e => e.stopPropagation()}>
                <TimesheetTarefa
                  processoId={processoId}
                  tarefaId={t.id}
                  tarefaTitulo={t.titulo}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {modalTarefa && (
        <ModalTarefa
          tarefa={modalTarefa}
          onUpdate={upd => {
            setTarefas(prev => prev.map(x => x.id === upd.id ? upd : x));
            setModalTarefa(upd);
            onRefreshProcesso();
          }}
          onClose={() => setModalTarefa(null)}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA: MINUTAS
// ════════════════════════════════════════════════════════════════════════════

const TIPOS_MINUTA = [
  // Petições
  { id: "peticao_inicial",            label: "Petição Inicial",                    cat: "📄 Petições" },
  { id: "tutela_antecipada",          label: "Tutela Antecipada / Cautelar",        cat: "📄 Petições" },
  { id: "impugnacao_cumprimento",     label: "Impugnação ao Cumprimento",           cat: "📄 Petições" },
  // Recursos
  { id: "apelacao_civel",             label: "Recurso de Apelação Cível",           cat: "⚖ Recursos" },
  { id: "embargos_declaracao",        label: "Embargos de Declaração",              cat: "⚖ Recursos" },
  { id: "agravo_instrumento",         label: "Agravo de Instrumento",               cat: "⚖ Recursos" },
  { id: "recurso_ordinario_trabalhista", label: "Recurso Ordinário Trabalhista",    cat: "⚖ Recursos" },
  { id: "recurso_especial",           label: "Recurso Especial (REsp)",             cat: "⚖ Recursos" },
  // Remédios
  { id: "habeas_corpus",              label: "Habeas Corpus",                       cat: "🛡 Remédios Constitucionais" },
  { id: "mandado_seguranca",          label: "Mandado de Segurança",                cat: "🛡 Remédios Constitucionais" },
  // Pareceres
  { id: "parecer",                    label: "Parecer Jurídico",                    cat: "📋 Pareceres" },
  { id: "resumo_executivo",           label: "Resumo Executivo",                    cat: "📋 Pareceres" },
];

function ModalMinuta({ minuta, processoId, onUpdate, onClose }: {
  minuta: Minuta; processoId: string;
  onUpdate: (m: Minuta) => void; onClose: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(minuta.conteudo_md);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const m = await api.minutas.editar(processoId, minuta.id, { conteudo_md: texto });
      onUpdate(m);
      setEditando(false);
    } finally { setSalvando(false); }
  }

  async function aprovar() {
    const m = await api.minutas.editar(processoId, minuta.id, { status: "aprovado" });
    onUpdate(m);
  }

  const statusMap: Record<string, string> = {
    rascunho:   "bg-yellow-100 text-yellow-700",
    em_revisao: "bg-blue-100 text-blue-700",
    aprovado:   "bg-green-100 text-green-700",
    publicado:  "bg-purple-100 text-purple-700",
  };

  return (
    <Modal title={minuta.titulo} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge s={minuta.status} map={statusMap} />
          <span className="text-xs text-muted">{TIPOS_MINUTA.find(t => t.id === minuta.tipo)?.label}</span>
          <span className="text-xs text-muted">v{minuta.versao} · {fmtData(minuta.created_at)}</span>
        </div>

        {editando ? (
          <textarea value={texto} onChange={e => setTexto(e.target.value)}
            rows={20}
            className="w-full border border-border rounded-lg p-3 text-sm bg-bg text-text-main font-mono focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        ) : (
          <div className="bg-bg rounded-xl border border-border p-4 max-h-[50vh] overflow-y-auto">
            <pre className="text-sm text-text-main leading-relaxed whitespace-pre-wrap font-sans">{minuta.conteudo_md}</pre>
          </div>
        )}

        <div className="flex gap-2 justify-between pt-2 border-t border-border">
          <div className="flex gap-2">
            {!editando ? (
              <Btn onClick={() => setEditando(true)}>✏ Editar</Btn>
            ) : (
              <>
                <Btn onClick={() => setEditando(false)}>Cancelar</Btn>
                <button onClick={salvar} disabled={salvando}
                  className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all disabled:opacity-50">
                  {salvando ? "Salvando…" : "Salvar"}
                </button>
              </>
            )}
          </div>
          {minuta.status !== "aprovado" && !editando && (
            <button onClick={aprovar}
              className="bg-green-600 text-white font-semibold rounded-lg px-4 py-2 text-sm hover:bg-green-700 transition-all">
              ✓ Aprovar
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AbaMinutas({ processoId }: { processoId: string }) {
  const [minutas, setMinutas] = useState<Minuta[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [modalMinuta, setModalMinuta] = useState<Minuta | null>(null);
  const [form, setForm] = useState({ tipo: "resumo_executivo", titulo: "", instrucoes: "" });
  const [busca, setBusca] = useState("");

  useEffect(() => {
    api.minutas.listar(processoId).then(setMinutas).finally(() => setLoading(false));
  }, [processoId]);

  async function gerar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo) { alert("Informe um título."); return; }
    setGerando(true);
    try {
      const m = await api.minutas.solicitar(processoId, form.tipo, form.titulo, form.instrucoes || undefined);
      setMinutas(prev => [m, ...prev]);
      setForm({ tipo: "resumo_executivo", titulo: "", instrucoes: "" });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro");
    } finally {
      setGerando(false);
    }
  }

  const statusMap: Record<string, string> = {
    rascunho:   "bg-yellow-100 text-yellow-700",
    em_revisao: "bg-blue-100 text-blue-700",
    aprovado:   "bg-green-100 text-green-700",
    publicado:  "bg-purple-100 text-purple-700",
  };

  return (
    <>
      <div className="space-y-6">
        <form onSubmit={gerar} className="bg-gray-50 rounded-xl border border-border p-5 space-y-3">
          <h3 className="text-sm font-bold text-text-main">Gerar nova minuta</h3>
          <p className="text-xs text-orange-600 font-semibold">
            ⚠ Toda minuta gerada por IA requer revisão humana antes de qualquer uso externo.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Tipo de documento</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40">
                {Array.from(new Set(TIPOS_MINUTA.map(t => t.cat))).map(cat => (
                  <optgroup key={cat} label={cat}>
                    {TIPOS_MINUTA.filter(t => t.cat === cat).map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Título</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
                placeholder="Ex: Recurso de Apelação n. X" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Instruções adicionais (opcional)</label>
            <textarea value={form.instrucoes} onChange={e => setForm(f => ({ ...f, instrucoes: e.target.value }))}
              rows={2} placeholder="Instruções específicas..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40 resize-none" />
          </div>
          <button type="submit" disabled={gerando}
            className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all disabled:opacity-50">
            {gerando ? "Gerando…" : "Gerar Minuta"}
          </button>
        </form>

        {loading && <div className="flex justify-center py-8"><Spinner /></div>}

        {!loading && minutas.length > 0 && (
          <SearchBar value={busca} onChange={setBusca} placeholder="Buscar minutas…" />
        )}

        {minutas.filter(m =>
          m.titulo.toLowerCase().includes(busca.toLowerCase()) ||
          m.status.toLowerCase().includes(busca.toLowerCase())
        ).map(m => (
          <div key={m.id}
            className="bg-bg rounded-xl border border-border hover:border-gold/40 transition-colors cursor-pointer"
            onClick={() => setModalMinuta(m)}>
            <div className="flex items-start justify-between gap-3 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-text-main">{m.titulo}</span>
                  <StatusBadge s={m.status} map={statusMap} />
                  <span className="text-xs text-muted">v{m.versao}</span>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {TIPOS_MINUTA.find(t => t.id === m.tipo)?.label} · {fmtData(m.created_at)}
                </p>
              </div>
              <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                {m.status !== "aprovado" && (
                  <Btn variant="green" onClick={async () => {
                    const upd = await api.minutas.editar(processoId, m.id, { status: "aprovado" });
                    setMinutas(prev => prev.map(x => x.id === m.id ? upd : x));
                  }}>Aprovar</Btn>
                )}
                <Btn onClick={() => setModalMinuta(m)}>Abrir</Btn>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modalMinuta && (
        <ModalMinuta
          minuta={modalMinuta}
          processoId={processoId}
          onUpdate={upd => {
            setMinutas(prev => prev.map(x => x.id === upd.id ? upd : x));
            setModalMinuta(upd);
          }}
          onClose={() => setModalMinuta(null)}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA: SNAPSHOTS
// ════════════════════════════════════════════════════════════════════════════

function AbaSnapshots({ processoId }: { processoId: string }) {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [modalSnap, setModalSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    api.snapshots.listar(processoId).then(setSnaps).finally(() => setLoading(false));
  }, [processoId]);

  async function criar() {
    setCriando(true);
    try {
      const s = await api.snapshots.criar(processoId);
      setSnaps(prev => [s, ...prev]);
    } finally { setCriando(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">{snaps.length} versão{snaps.length !== 1 ? "ões" : ""} salva{snaps.length !== 1 ? "s" : ""}</p>
          <button onClick={criar} disabled={criando}
            className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all disabled:opacity-50">
            {criando ? "Salvando…" : "+ Criar Snapshot"}
          </button>
        </div>
        {!snaps.length && (
          <div className="text-center py-16 text-muted text-sm">
            Snapshots são criados automaticamente após cada upload.
          </div>
        )}
        {snaps.map(s => (
          <div key={s.id}
            className="bg-bg rounded-xl border border-border hover:border-gold/40 transition-colors cursor-pointer"
            onClick={() => setModalSnap(s)}>
            <div className="flex items-center justify-between p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-text-main">v{s.versao}</span>
                  <span className="text-xs text-muted bg-bg border border-border px-2 py-0.5 rounded-full">{s.trigger}</span>
                </div>
                {s.resumo_mudancas && <p className="text-xs text-muted mt-1">{s.resumo_mudancas}</p>}
                <p className="text-xs text-muted mt-0.5">{fmtData(s.created_at)}</p>
              </div>
              <Btn onClick={() => setModalSnap(s)}>Ver estado</Btn>
            </div>
          </div>
        ))}
      </div>

      {modalSnap && (
        <Modal title={`Snapshot v${modalSnap.versao} — ${modalSnap.trigger}`} onClose={() => setModalSnap(null)} wide>
          <div className="space-y-3">
            <p className="text-xs text-muted">{fmtData(modalSnap.created_at)}</p>
            {modalSnap.resumo_mudancas && <p className="text-sm text-text-main">{modalSnap.resumo_mudancas}</p>}
            <pre className="bg-bg rounded-lg p-4 text-xs text-muted overflow-auto max-h-96 font-mono whitespace-pre-wrap">
              {JSON.stringify(modalSnap.estado_json, null, 2)}
            </pre>
          </div>
        </Modal>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA: CHAT
// ════════════════════════════════════════════════════════════════════════════

// ── Renderer simples de Markdown para o chat ─────────────────────────────────
function ChatMarkdown({ text }: { text: string }) {
  // Converte Markdown básico em elementos React sem dependência externa
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      elements.push(<h4 key={i} className="text-sm font-bold text-text-main mt-3 mb-1">{line.slice(4)}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={i} className="text-sm font-bold text-text-main mt-3 mb-1 border-b border-border pb-1">{line.slice(3)}</h3>);
    } else if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
      elements.push(<p key={i} className="text-sm font-bold text-text-main mt-2">{line.slice(2, -2)}</p>);
    } else if (line.startsWith("- ") || line.startsWith("• ")) {
      elements.push(
        <div key={i} className="flex gap-2 text-sm">
          <span className="text-gold flex-shrink-0 mt-0.5">•</span>
          <span className="text-text-main">{inlineFormat(line.slice(2))}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1];
      elements.push(
        <div key={i} className="flex gap-2 text-sm mt-0.5">
          <span className="text-gold font-bold flex-shrink-0 w-5 text-right">{num}.</span>
          <span className="text-text-main">{inlineFormat(line.replace(/^\d+\.\s/, ""))}</span>
        </div>
      );
    } else if (line.trim() === "" || line.trim() === "---") {
      if (line.trim() === "---") elements.push(<hr key={i} className="border-border my-2" />);
      else elements.push(<div key={i} className="h-1.5" />);
    } else if (line.trim()) {
      elements.push(<p key={i} className="text-sm text-text-main leading-relaxed">{inlineFormat(line)}</p>);
    }
    i++;
  }
  return <div className="space-y-0.5">{elements}</div>;
}

function inlineFormat(text: string): React.ReactNode {
  // **bold** e `code` inline
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="bg-surface border border-border rounded px-1 text-xs font-mono text-gold">{p.slice(1, -1)}</code>;
    return p;
  });
}

// ── AbaChat ───────────────────────────────────────────────────────────────────

function AbaChat({ processoId }: { processoId: string }) {
  type Fonte = { tipo_peca?: string; paginas?: string };
  type Msg = {
    role: "user" | "assistant";
    content: string;
    seg?: number;
    fontes?: Fonte[];
    modelo?: "haiku" | "sonnet";
  };

  const [mensagens, setMensagens] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [usarSonnet, setUsarSonnet] = useState(false);
  const [mostrarFontes, setMostrarFontes] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  async function enviar(texto?: string) {
    const msg = (texto ?? input).trim();
    if (!msg || enviando) return;
    setInput("");
    const novasMensagens: Msg[] = [...mensagens, { role: "user", content: msg }];
    setMensagens(novasMensagens);
    setEnviando(true);
    const t0 = Date.now();
    try {
      const hist = novasMensagens.map(m => ({ role: m.role, content: m.content }));
      const r = await api.analises.chat(processoId, hist, undefined, usarSonnet);
      const seg = Math.round((Date.now() - t0) / 1000);
      setMensagens(prev => [...prev, {
        role: "assistant",
        content: r.resposta,
        seg,
        fontes: r.fontes as Fonte[],
        modelo: usarSonnet ? "sonnet" : "haiku",
      }]);
    } catch (err) {
      setMensagens(prev => [...prev, {
        role: "assistant",
        content: `❌ Erro: ${err instanceof Error ? err.message : "falha na API"}`,
        seg: Math.round((Date.now() - t0) / 1000),
        modelo: usarSonnet ? "sonnet" : "haiku",
      }]);
    } finally {
      setEnviando(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  }

  const sugestoesFatuais = [
    "Quais são as partes e seus advogados?",
    "Qual foi o último ato processual?",
    "Há algum prazo urgente neste processo?",
    "Qual o valor da causa?",
  ];

  const sugestoesEstrategicas = [
    "Quais são os principais argumentos para o recurso?",
    "O que a sentença decidiu sobre cada pedido?",
    "Há nulidades processuais que podemos arguir?",
    "Qual é a chance de êxito no STJ com esse caso?",
  ];

  const sugestoes = usarSonnet ? sugestoesEstrategicas : sugestoesFatuais;

  return (
    <div className="flex flex-col h-[680px]">

      {/* Header com seletor de modo */}
      <div className="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${usarSonnet ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"}`}>
            {usarSonnet ? "⚡ Sonnet — análise profunda" : "● Haiku — resposta rápida"}
          </span>
          {mensagens.length > 0 && (
            <span className="text-xs text-muted">{mensagens.filter(m => m.role === "user").length} pergunta{mensagens.filter(m => m.role === "user").length !== 1 ? "s" : ""}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mensagens.length > 0 && (
            <button onClick={() => setMensagens([])}
              className="text-xs text-muted hover:text-danger px-2 py-1 rounded hover:bg-danger/10 transition-all">
              Limpar
            </button>
          )}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              onClick={() => setUsarSonnet(false)}
              className={`px-3 py-1.5 font-semibold transition-colors ${!usarSonnet ? "bg-green-600 text-white" : "bg-bg text-muted hover:text-text-main"}`}>
              Haiku
            </button>
            <button
              onClick={() => setUsarSonnet(true)}
              className={`px-3 py-1.5 font-semibold transition-colors ${usarSonnet ? "bg-purple-600 text-white" : "bg-bg text-muted hover:text-text-main"}`}>
              Sonnet
            </button>
          </div>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
        {!mensagens.length && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-gold/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-text-main mb-1">Consultor Jurídico do Processo</p>
              <p className="text-xs text-muted max-w-xs">
                {usarSonnet
                  ? "Modo estratégico: análises profundas com contexto completo das análises já realizadas"
                  : "Modo rápido: respostas em segundos para perguntas factuais sobre os autos"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
                {usarSonnet ? "Perguntas estratégicas" : "Perguntas factuais"}
              </p>
              <div className="grid grid-cols-2 gap-2 w-full max-w-md">
                {sugestoes.map((s, i) => (
                  <button key={i} onClick={() => enviar(s)}
                    className="text-left text-xs px-3 py-2.5 rounded-xl border border-border hover:border-gold/60 hover:bg-gold/5 text-muted hover:text-text-main transition-all leading-relaxed">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {mensagens.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} group`}>
            {m.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-gold/10 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
                <span className="text-xs">⚖</span>
              </div>
            )}
            <div className={`max-w-[88%] ${m.role === "user" ? "" : "flex-1 min-w-0"}`}>
              <div className={`rounded-xl px-4 py-3 ${
                m.role === "user"
                  ? "bg-navy text-white text-sm"
                  : "bg-surface border border-border"
              }`}>
                {m.role === "user"
                  ? <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                  : <ChatMarkdown text={m.content} />
                }
              </div>

              {m.role === "assistant" && (
                <div className="flex items-center gap-3 mt-1 px-1">
                  <span className="text-[10px] text-muted">
                    {m.seg !== undefined ? `⏱ ${m.seg}s` : ""}
                    {m.modelo === "sonnet" ? " · Sonnet" : m.modelo === "haiku" ? " · Haiku" : ""}
                  </span>
                  {m.fontes && m.fontes.length > 0 && (
                    <button
                      className="text-[10px] text-gold hover:underline"
                      onClick={() => setMostrarFontes(mostrarFontes === i ? null : i)}>
                      {mostrarFontes === i ? "Ocultar fontes" : `📎 ${m.fontes.length} fonte${m.fontes.length !== 1 ? "s" : ""}`}
                    </button>
                  )}
                  <button
                    className="text-[10px] text-muted hover:text-text-main opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => navigator.clipboard?.writeText(m.content)}>
                    Copiar
                  </button>
                </div>
              )}

              {m.role === "assistant" && mostrarFontes === i && m.fontes && m.fontes.length > 0 && (
                <div className="mt-1 px-1">
                  <div className="flex flex-wrap gap-1.5">
                    {m.fontes.map((f, fi) => (
                      <span key={fi} className="text-[10px] bg-surface border border-border rounded-full px-2.5 py-1 text-muted">
                        {(f.tipo_peca ?? "?").replace(/_/g, " ")} pág.{f.paginas ?? "?"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {enviando && (
          <div className="flex justify-start items-start gap-2">
            <div className="w-7 h-7 rounded-full bg-gold/10 flex items-center justify-center flex-shrink-0">
              <span className="text-xs">⚖</span>
            </div>
            <div className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gold rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-gold rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-gold rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-xs text-muted">{usarSonnet ? "Analisando com Sonnet…" : "Consultando…"}</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="pt-3 border-t border-border flex-shrink-0">
        {mensagens.length > 0 && !enviando && (
          <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
            {(usarSonnet ? sugestoesEstrategicas : sugestoesFatuais).slice(0, 3).map((s, i) => (
              <button key={i} onClick={() => enviar(s)}
                className="text-[10px] font-semibold px-2.5 py-1 rounded-full border border-border hover:border-gold/60 hover:bg-gold/5 text-muted hover:text-text-main transition-all whitespace-nowrap flex-shrink-0">
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            className="flex-1 border border-border rounded-xl px-3 py-2.5 text-sm bg-bg text-text-main placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-gold/40 resize-none"
            placeholder={usarSonnet
              ? "Pergunta estratégica… (Shift+Enter = nova linha)"
              : "Pergunta sobre os autos… (Enter para enviar)"
            }
          />
          <button
            onClick={() => enviar()}
            disabled={enviando || !input.trim()}
            className={`rounded-xl px-4 py-2.5 text-sm font-bold transition-all disabled:opacity-50 ${usarSonnet ? "bg-purple-600 hover:bg-purple-500 text-white" : "bg-gold text-navy hover:bg-gold-light"}`}>
            →
          </button>
        </div>
        <p className="text-[10px] text-muted mt-1.5 text-center">
          Enter para enviar · Shift+Enter para nova linha · {usarSonnet ? "Sonnet: resposta profunda (~10s)" : "Haiku: resposta rápida (~3s)"}
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA: PEÇAS
// ════════════════════════════════════════════════════════════════════════════

const TIPO_PECA_OPTIONS = [
  "peticao_inicial","contestacao","replica","sentenca","acordao","despacho",
  "decisao_interlocutoria","recurso","embargos_declaracao","agravo",
  "contrarrazoes","certidao","publicacao","intimacao","citacao",
  "laudo_pericial","procuracao","contrato","cumprimento_sentenca","outro",
];

const TIPO_MAP: Record<string, string> = {
  peticao_inicial:         "bg-blue-100 text-blue-700",
  contestacao:             "bg-red-100 text-red-700",
  replica:                 "bg-purple-100 text-purple-700",
  sentenca:                "bg-green-100 text-green-700",
  acordao:                 "bg-emerald-100 text-emerald-800",
  despacho:                "bg-gray-100 text-gray-600",
  decisao_interlocutoria:  "bg-orange-100 text-orange-700",
  recurso:                 "bg-yellow-100 text-yellow-700",
  embargos_declaracao:     "bg-amber-100 text-amber-700",
  agravo:                  "bg-amber-100 text-amber-800",
  contrarrazoes:           "bg-yellow-50 text-yellow-600",
  certidao:                "bg-slate-100 text-slate-600",
  publicacao:              "bg-slate-100 text-slate-500",
  intimacao:               "bg-sky-100 text-sky-600",
  citacao:                 "bg-sky-100 text-sky-700",
  laudo_pericial:          "bg-teal-100 text-teal-700",
  procuracao:              "bg-indigo-100 text-indigo-600",
  contrato:                "bg-indigo-100 text-indigo-700",
  cumprimento_sentenca:    "bg-pink-100 text-pink-700",
  outro:                   "bg-gray-100 text-gray-500",
};

function ModalPeca({ peca, processoId, onUpdate, onDelete, onClose }: {
  peca: Peca; processoId: string;
  onUpdate: (p: Peca) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [tipo, setTipo] = useState(peca.tipo_peca);
  const [conteudo, setConteudo] = useState(peca.conteudo_texto ?? "");
  const [resumo, setResumo] = useState(peca.resumo ?? "");
  const [salvando, setSalvando] = useState(false);
  const [deletando, setDeletando] = useState(false);

  async function salvar() {
    if (!peca.documento_id) return;
    setSalvando(true);
    try {
      const upd = await api.documentos.atualizarPeca(processoId, peca.documento_id, peca.id, {
        tipo_peca: tipo !== peca.tipo_peca ? tipo : undefined,
        conteudo_texto: conteudo !== peca.conteudo_texto ? conteudo : undefined,
        resumo: resumo !== peca.resumo ? resumo : undefined,
      });
      onUpdate({ ...peca, ...upd });
      setEditando(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function deletar() {
    if (!peca.documento_id) return;
    if (!confirm(`Excluir peça "${peca.tipo_peca}" (pág. ${peca.pagina_inicio}–${peca.pagina_fim})?`)) return;
    setDeletando(true);
    try {
      await api.documentos.deletarPeca(processoId, peca.documento_id, peca.id);
      onDelete(peca.id);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setDeletando(false);
    }
  }

  const chars = conteudo.length;
  const palavras = conteudo.trim() ? conteudo.trim().split(/\s+/).length : 0;

  return (
    <Modal title={`${peca.tipo_peca.replace(/_/g," ").toUpperCase()} — pág. ${peca.pagina_inicio}–${peca.pagina_fim}`} onClose={onClose} wide>
      <div className="space-y-4">
        {/* Meta */}
        <div className="flex flex-wrap gap-3 text-xs text-muted items-center">
          <span className={`font-bold px-2 py-0.5 rounded-full ${TIPO_MAP[peca.tipo_peca] ?? "bg-gray-100 text-gray-500"}`}>
            {peca.tipo_peca.replace(/_/g," ").toUpperCase()}
          </span>
          <span>pág. {peca.pagina_inicio}–{peca.pagina_fim} ({peca.pagina_fim - peca.pagina_inicio + 1} pág.)</span>
          {peca.confianca_classificacao !== undefined && (
            <span className={peca.confianca_classificacao >= 0.8 ? "text-green-600" : "text-orange-500"}>
              {Math.round(peca.confianca_classificacao * 100)}% confiança IA
            </span>
          )}
          {peca.autor && <span>✍ {peca.autor}</span>}
          {peca.data_documento && <span>📅 {fmtData(String(peca.data_documento))}</span>}
          <span>{palavras.toLocaleString("pt-BR")} palavras · {chars.toLocaleString("pt-BR")} chars</span>
        </div>

        {editando ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Tipo da peça</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40">
                {TIPO_PECA_OPTIONS.map(t => <option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Resumo (opcional)</label>
              <textarea value={resumo} onChange={e => setResumo(e.target.value)} rows={2}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40 resize-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Conteúdo extraído pela IA</label>
              <textarea value={conteudo} onChange={e => setConteudo(e.target.value)} rows={14}
                className="w-full border border-border rounded-lg px-3 py-2 text-xs font-mono bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
            </div>
            <div className="flex gap-2 justify-end">
              <Btn onClick={() => setEditando(false)}>Cancelar</Btn>
              <button onClick={salvar} disabled={salvando}
                className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all disabled:opacity-50">
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        ) : (
          <>
            {peca.resumo && (
              <div className="bg-gold/5 rounded-lg border border-gold/20 p-3">
                <p className="text-xs font-semibold text-gold uppercase tracking-wide mb-1">Resumo</p>
                <p className="text-sm text-text-main">{peca.resumo}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Conteúdo extraído</p>
              <div className="bg-bg rounded-xl border border-border p-4 max-h-[50vh] overflow-y-auto">
                {conteudo ? (
                  <pre className="text-xs text-text-main whitespace-pre-wrap font-sans leading-relaxed">{conteudo}</pre>
                ) : (
                  <p className="text-xs text-muted italic">Sem conteúdo extraído para esta peça.</p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <Btn variant="danger" onClick={deletar} disabled={deletando}>
                {deletando ? "Excluindo…" : "🗑 Excluir peça"}
              </Btn>
              <button onClick={() => setEditando(true)}
                className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all">
                ✏ Editar tipo / conteúdo
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function AbaPecas({ processoId }: { processoId: string }) {
  const [pecas, setPecas] = useState<Peca[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [modalPeca, setModalPeca] = useState<Peca | null>(null);

  useEffect(() => {
    // Endpoint único no nível do processo — muito mais rápido que iterar documentos
    api.processos.pecas(processoId)
      .then(ps => setPecas(ps))
      .finally(() => setLoading(false));
  }, [processoId]);

  const tipos = Array.from(new Set(pecas.map(p => p.tipo_peca))).sort();

  const pecasFiltradas = pecas.filter(p => {
    const matchBusca = !busca ||
      p.tipo_peca.toLowerCase().includes(busca.toLowerCase()) ||
      (p.resumo ?? "").toLowerCase().includes(busca.toLowerCase()) ||
      (p.autor ?? "").toLowerCase().includes(busca.toLowerCase()) ||
      (p.conteudo_texto ?? "").toLowerCase().includes(busca.toLowerCase());
    const matchTipo = !filtroTipo || p.tipo_peca === filtroTipo;
    return matchBusca && matchTipo;
  });

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!pecas.length) return (
    <div className="text-center py-16 text-muted text-sm">
      Nenhuma peça indexada. Certifique-se de que os documentos foram processados.
    </div>
  );

  return (
    <>
      <div className="space-y-3">
        {/* Filtros */}
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <SearchBar value={busca} onChange={setBusca} placeholder="Buscar em tipo, resumo, conteúdo…" />
          </div>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40">
            <option value="">Todos ({pecas.length})</option>
            {tipos.map(t => (
              <option key={t} value={t}>{t.replace(/_/g," ")} ({pecas.filter(p => p.tipo_peca === t).length})</option>
            ))}
          </select>
        </div>

        <p className="text-xs text-muted">Clique em qualquer peça para ver o conteúdo extraído pela IA, editar ou excluir.</p>

        {/* Lista */}
        {pecasFiltradas.map((p, i) => (
          <div key={p.id ?? i}
            className="bg-bg rounded-xl border border-border p-4 hover:border-gold/50 hover:shadow-sm transition-all cursor-pointer"
            onClick={() => setModalPeca(p)}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIPO_MAP[p.tipo_peca] ?? "bg-gray-100 text-gray-500"}`}>
                    {p.tipo_peca.replace(/_/g," ").toUpperCase()}
                  </span>
                  <span className="text-xs text-muted font-mono">
                    pág. {p.pagina_inicio}–{p.pagina_fim}
                    {` (${p.pagina_fim - p.pagina_inicio + 1} pág.)`}
                  </span>
                  {p.data_documento && <span className="text-xs text-muted">{fmtData(String(p.data_documento))}</span>}
                  {p.confianca_classificacao !== undefined && (
                    <span className={`text-xs font-semibold ${p.confianca_classificacao >= 0.8 ? "text-green-600" : "text-orange-500"}`}>
                      {Math.round(p.confianca_classificacao * 100)}%
                    </span>
                  )}
                  {p.conteudo_texto && (
                    <span className="text-xs text-gold">● tem conteúdo</span>
                  )}
                </div>
                {p.autor && <p className="text-xs text-muted">✍ {p.autor}</p>}
                {p.resumo && <p className="text-xs text-muted mt-1 line-clamp-2">{p.resumo}</p>}
                {!p.resumo && p.conteudo_texto && (
                  <p className="text-xs text-muted mt-1 line-clamp-2 italic">{p.conteudo_texto.slice(0, 200)}</p>
                )}
              </div>
              <span className="text-xs text-gold flex-shrink-0 mt-1">Ver →</span>
            </div>
          </div>
        ))}
      </div>

      {modalPeca && (
        <ModalPeca
          peca={modalPeca}
          processoId={processoId}
          onUpdate={upd => {
            setPecas(prev => prev.map(p => p.id === upd.id ? upd : p));
            setModalPeca(upd);
          }}
          onDelete={id => setPecas(prev => prev.filter(p => p.id !== id))}
          onClose={() => setModalPeca(null)}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA: ATIVIDADE (TIMESHEET)
// ════════════════════════════════════════════════════════════════════════════

function diffMin(a: string, b?: string | null) {
  if (!b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

// ── AbaPrazos ─────────────────────────────────────────────────────────────

type PrazoStatus = "vencido" | "vencendo" | "em_aberto" | "cumprido" | "suspendo" | "cancelado";

function statusEfetivo(prazo: Prazo): PrazoStatus {
  if (prazo.status === "cumprido" || prazo.status === "suspendo" || prazo.status === "cancelado")
    return prazo.status as PrazoStatus;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = new Date(prazo.vencimento + "T00:00:00");
  const diff = Math.floor((venc.getTime() - hoje.getTime()) / 86_400_000);
  if (diff < 0) return "vencido";
  if (diff <= 5) return "vencendo";
  return "em_aberto";
}

function diasRestantes(vencimento: string): number {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = new Date(vencimento + "T00:00:00");
  return Math.floor((venc.getTime() - hoje.getTime()) / 86_400_000);
}

const STATUS_PRAZO_STYLE: Record<PrazoStatus, { border: string; badge: string; label: string }> = {
  vencido:    { border: "border-red-400",    badge: "bg-red-100 text-red-700",       label: "Vencido" },
  vencendo:   { border: "border-amber-400",  badge: "bg-amber-100 text-amber-700",   label: "Vence em breve" },
  em_aberto:  { border: "border-green-400",  badge: "bg-green-100 text-green-700",   label: "Em aberto" },
  cumprido:   { border: "border-gray-300",   badge: "bg-gray-100 text-gray-500",     label: "Cumprido" },
  suspendo:   { border: "border-blue-300",   badge: "bg-blue-100 text-blue-600",     label: "Suspenso" },
  cancelado:  { border: "border-gray-200",   badge: "bg-gray-50  text-gray-400",     label: "Cancelado" },
};

const PRIORIDADE_BADGE: Record<string, string> = {
  critica: "bg-red-100 text-red-700 font-bold",
  urgente: "bg-orange-100 text-orange-700",
  alta:    "bg-yellow-100 text-yellow-700",
  normal:  "bg-gray-100 text-gray-500",
  baixa:   "bg-gray-50 text-gray-400",
};

const TIPO_PRAZO_OPTIONS = [
  { value: "processual",     label: "Processual" },
  { value: "contratual",     label: "Contratual" },
  { value: "administrativo", label: "Administrativo" },
  { value: "prescricao",     label: "Prescrição/Decadência" },
  { value: "interno",        label: "Interno (escritório)" },
  { value: "outro",          label: "Outro" },
];

const PRIORIDADE_OPTIONS = [
  { value: "critica", label: "🔴 Crítica" },
  { value: "urgente", label: "🟠 Urgente" },
  { value: "alta",    label: "🟡 Alta" },
  { value: "normal",  label: "⚪ Normal" },
  { value: "baixa",   label: "🔵 Baixa" },
];

type PrazoForm = {
  titulo: string;
  descricao: string;
  tipo: string;
  fundamento_legal: string;
  data_inicio: string;
  prazo_dias: string;
  tipo_contagem: string;   // "uteis" | "corridos" | "meses"
  uf: string;              // ex: "SP" — para feriados estaduais
  vencimento: string;
  prioridade: string;
  responsavel: string;
  observacoes: string;
};

const PRAZO_FORM_VAZIO: PrazoForm = {
  titulo: "", descricao: "", tipo: "processual", fundamento_legal: "",
  data_inicio: "", prazo_dias: "", tipo_contagem: "uteis", uf: "",
  vencimento: "", prioridade: "normal", responsavel: "", observacoes: "",
};

type ImportItem = {
  key: string;
  titulo: string;
  vencimento: string;
  fundamento: string;
  urgencia: string;
  tipo: string;
  selected: boolean;
};

function AbaPrazos({ processoId }: { processoId: string }) {
  const [prazos, setPrazos] = useState<Prazo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ form: PrazoForm; id?: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [deletando, setDeletando] = useState<string | null>(null);
  const [cumprindo, setCumprindo] = useState<string | null>(null);
  const [reabrindo, setReabrindo] = useState<string | null>(null);
  const [importModal, setImportModal] = useState<ImportItem[] | null>(null);
  const [importando, setImportando] = useState(false);
  const [calcInfo, setCalcInfo] = useState<{ vencimento: string; dias_uteis_restantes: number; status: string } | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  useEffect(() => {
    api.prazos.listar(processoId).then(setPrazos).finally(() => setLoading(false));
  }, [processoId]);

  // Auto-calcula vencimento quando data_inicio + prazo_dias estão preenchidos
  useEffect(() => {
    const f = modal?.form;
    if (!f || !f.data_inicio || !f.prazo_dias || parseInt(f.prazo_dias) < 1) {
      setCalcInfo(null);
      return;
    }
    const timer = setTimeout(async () => {
      setCalcLoading(true);
      try {
        const r = await api.prazos.calcularVencimento({
          data_base: f.data_inicio,
          prazo_dias: parseInt(f.prazo_dias),
          tipo: f.tipo_contagem || "uteis",
          uf: f.uf || undefined,
        });
        setCalcInfo({ vencimento: r.vencimento, dias_uteis_restantes: r.dias_uteis_restantes, status: r.status });
        // Auto-preenche o campo vencimento se estiver vazio ou era calculado antes
        setModal(m => m ? ({ ...m, form: { ...m.form, vencimento: r.vencimento } }) : m);
      } catch {
        setCalcInfo(null);
      } finally {
        setCalcLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [modal?.form.data_inicio, modal?.form.prazo_dias, modal?.form.tipo_contagem, modal?.form.uf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ordenação: vencido → vencendo → em_aberto → cumprido/suspendo/cancelado ──
  const sorted = [...prazos].sort((a, b) => {
    const order: Record<PrazoStatus, number> = {
      vencido: 0, vencendo: 1, em_aberto: 2, suspendo: 3, cancelado: 4, cumprido: 5,
    };
    const sa = statusEfetivo(a), sb = statusEfetivo(b);
    const oa = order[sa], ob = order[sb];
    if (oa !== ob) return oa - ob;
    return new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime();
  });

  const counts = {
    vencido:   prazos.filter(p => statusEfetivo(p) === "vencido").length,
    vencendo:  prazos.filter(p => statusEfetivo(p) === "vencendo").length,
    em_aberto: prazos.filter(p => statusEfetivo(p) === "em_aberto").length,
    cumprido:  prazos.filter(p => statusEfetivo(p) === "cumprido").length,
  };

  function abrirNovo() {
    setModal({ form: { ...PRAZO_FORM_VAZIO } });
  }
  function abrirEditar(p: Prazo) {
    setModal({
      id: p.id,
      form: {
        titulo: p.titulo, descricao: p.descricao ?? "", tipo: p.tipo,
        fundamento_legal: p.fundamento_legal ?? "",
        data_inicio: p.data_inicio ?? "", prazo_dias: p.prazo_dias?.toString() ?? "",
        tipo_contagem: "uteis", uf: "",
        vencimento: p.vencimento, prioridade: p.prioridade,
        responsavel: p.responsavel ?? "", observacoes: p.observacoes ?? "",
      },
    });
  }

  async function salvar() {
    if (!modal) return;
    const f = modal.form;
    if (!f.titulo.trim()) { alert("Título obrigatório"); return; }
    if (!f.vencimento) { alert("Data de vencimento obrigatória"); return; }
    setSalvando(true);
    try {
      const body = {
        titulo: f.titulo.trim(),
        tipo: f.tipo,
        vencimento: f.vencimento,
        prioridade: f.prioridade,
        ...(f.descricao.trim() ? { descricao: f.descricao.trim() } : {}),
        ...(f.fundamento_legal.trim() ? { fundamento_legal: f.fundamento_legal.trim() } : {}),
        ...(f.data_inicio ? { data_inicio: f.data_inicio } : {}),
        ...(f.prazo_dias ? { prazo_dias: parseInt(f.prazo_dias) } : {}),
        ...(f.responsavel.trim() ? { responsavel: f.responsavel.trim() } : {}),
        ...(f.observacoes.trim() ? { observacoes: f.observacoes.trim() } : {}),
      };
      if (modal.id) {
        const upd = await api.prazos.atualizar(processoId, modal.id, body);
        setPrazos(prev => prev.map(p => p.id === modal.id ? upd : p));
      } else {
        const novo = await api.prazos.criar(processoId, body);
        setPrazos(prev => [...prev, novo]);
      }
      setModal(null);
      setCalcInfo(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function cumprir(prazoId: string) {
    setCumprindo(prazoId);
    try {
      const upd = await api.prazos.cumprir(processoId, prazoId);
      setPrazos(prev => prev.map(p => p.id === prazoId ? upd : p));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro");
    } finally {
      setCumprindo(null);
    }
  }

  async function reabrir(prazoId: string) {
    setReabrindo(prazoId);
    try {
      const upd = await api.prazos.reabrir(processoId, prazoId);
      setPrazos(prev => prev.map(p => p.id === prazoId ? upd : p));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro");
    } finally {
      setReabrindo(null);
    }
  }

  async function deletar(prazoId: string, titulo: string) {
    if (!confirm(`Excluir prazo "${titulo}"?`)) return;
    setDeletando(prazoId);
    try {
      await api.prazos.deletar(processoId, prazoId);
      setPrazos(prev => prev.filter(p => p.id !== prazoId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro");
    } finally {
      setDeletando(null);
    }
  }

  // ── Importar da análise de Próximos Passos / Estado Atual ──────────────────
  async function prepararImport() {
    try {
      const analises = await api.analises.listar(processoId);
      const items: ImportItem[] = [];

      const passosAn = analises
        .filter(a => a.tipo === "proximos_passos")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

      const estadoAn = analises
        .filter(a => a.tipo === "estado_atual")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

      if (passosAn) {
        const acoes = (passosAn.conteudo_json as { acoes?: unknown[] }).acoes ?? [];
        acoes.forEach((a: unknown, i: number) => {
          const acao = a as Record<string, string>;
          if (acao.vencimento_estimado) {
            items.push({
              key: `pp-${i}`,
              titulo: acao.acao ?? `Ação ${i + 1}`,
              vencimento: acao.vencimento_estimado,
              fundamento: acao.fundamento ?? acao.prazo_legal ?? "",
              urgencia: acao.urgencia ?? "normal",
              tipo: "processual",
              selected: true,
            });
          }
        });
      }

      if (estadoAn) {
        const pv = (estadoAn.conteudo_json as { prazos_vivos?: unknown[] }).prazos_vivos ?? [];
        pv.forEach((p: unknown, i: number) => {
          const prazo = p as Record<string, string | boolean>;
          if (prazo.vencimento_estimado) {
            items.push({
              key: `ea-${i}`,
              titulo: String(prazo.descricao ?? `Prazo ${i + 1}`),
              vencimento: String(prazo.vencimento_estimado),
              fundamento: String(prazo.prazo_legal ?? ""),
              urgencia: prazo.critico ? "critica" : "normal",
              tipo: "processual",
              selected: true,
            });
          }
        });
      }

      if (items.length === 0) {
        alert("Nenhum prazo com data estimada encontrado nas análises de Próximos Passos ou Estado Atual.\nGere essas análises primeiro.");
        return;
      }
      setImportModal(items);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao carregar análises");
    }
  }

  async function confirmarImport() {
    if (!importModal) return;
    const selected = importModal.filter(i => i.selected);
    if (selected.length === 0) return;
    setImportando(true);
    try {
      const urgToPrority: Record<string, string> = {
        critica: "critica", urgente: "urgente", alta: "alta", normal: "normal", baixa: "baixa",
      };
      const novos: Prazo[] = [];
      for (const item of selected) {
        const p = await api.prazos.criar(processoId, {
          titulo: item.titulo.slice(0, 250),
          tipo: "processual",
          vencimento: item.vencimento,
          prioridade: urgToPrority[item.urgencia] ?? "normal",
          fundamento_legal: item.fundamento || undefined,
        });
        novos.push(p);
      }
      setPrazos(prev => [...prev, ...novos]);
      setImportModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao importar");
    } finally {
      setImportando(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-5">

        {/* Cabeçalho com contadores */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {counts.vencido > 0 && (
              <span className="flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-3 py-1.5 rounded-full">
                🔴 {counts.vencido} vencido{counts.vencido > 1 ? "s" : ""}
              </span>
            )}
            {counts.vencendo > 0 && (
              <span className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold px-3 py-1.5 rounded-full">
                🟠 {counts.vencendo} vencendo em breve
              </span>
            )}
            {counts.em_aberto > 0 && (
              <span className="flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                ✅ {counts.em_aberto} em aberto
              </span>
            )}
            {counts.cumprido > 0 && (
              <span className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 text-gray-500 text-xs px-3 py-1.5 rounded-full">
                ✔ {counts.cumprido} cumprido{counts.cumprido > 1 ? "s" : ""}
              </span>
            )}
            {prazos.length === 0 && !loading && (
              <span className="text-sm text-muted">Nenhum prazo cadastrado</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Btn onClick={prepararImport}>Importar da IA</Btn>
            <Btn variant="gold" onClick={abrirNovo}>+ Novo Prazo</Btn>
          </div>
        </div>

        {loading && <div className="flex justify-center py-8"><Spinner /></div>}

        {/* Lista de prazos */}
        <div className="space-y-3">
          {sorted.map(p => {
            const st = statusEfetivo(p);
            const style = STATUS_PRAZO_STYLE[st];
            const dias = diasRestantes(p.vencimento);
            const isCumprido = st === "cumprido" || st === "cancelado";
            const isFinished = isCumprido || st === "suspendo";

            return (
              <div key={p.id}
                className={`bg-bg rounded-xl border-l-4 border border-border ${style.border} shadow-sm transition-all ${isCumprido ? "opacity-60" : ""}`}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Título + badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-bold ${isCumprido ? "line-through text-muted" : "text-text-main"}`}>
                          {p.titulo}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${style.badge}`}>{style.label}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORIDADE_BADGE[p.prioridade] ?? PRIORIDADE_BADGE.normal}`}>
                          {p.prioridade}
                        </span>
                        <span className="text-xs text-muted border border-border px-2 py-0.5 rounded-full">
                          {TIPO_PRAZO_OPTIONS.find(t => t.value === p.tipo)?.label ?? p.tipo}
                        </span>
                      </div>

                      {/* Vencimento + dias restantes */}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="text-xs text-muted">
                          📅 {new Date(p.vencimento + "T00:00:00").toLocaleDateString("pt-BR")}
                        </span>
                        {!isFinished && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            dias < 0
                              ? "bg-red-100 text-red-700"
                              : dias <= 5
                              ? "bg-amber-100 text-amber-700"
                              : "bg-green-100 text-green-700"
                          }`}>
                            {dias < 0
                              ? `${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? "s" : ""} atrasado`
                              : dias === 0
                              ? "Vence hoje!"
                              : `${dias} dia${dias !== 1 ? "s" : ""} restante${dias !== 1 ? "s" : ""}`}
                          </span>
                        )}
                        {p.responsavel && (
                          <span className="text-xs text-muted">👤 {p.responsavel}</span>
                        )}
                      </div>

                      {/* Fundamento legal */}
                      {p.fundamento_legal && (
                        <p className="text-xs text-muted mt-1 italic">{p.fundamento_legal}</p>
                      )}

                      {/* Descrição */}
                      {p.descricao && (
                        <p className="text-xs text-text-main mt-1.5 line-clamp-2">{p.descricao}</p>
                      )}
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {!isFinished && (
                        <button onClick={() => cumprir(p.id)} disabled={cumprindo === p.id}
                          title="Marcar como cumprido"
                          className="text-xs px-2.5 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 transition-colors disabled:opacity-50">
                          {cumprindo === p.id ? "…" : "✓ Cumprir"}
                        </button>
                      )}
                      {isFinished && (
                        <button onClick={() => reabrir(p.id)} disabled={reabrindo === p.id}
                          title="Reabrir prazo"
                          className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted hover:bg-gray-50 transition-colors disabled:opacity-50">
                          {reabrindo === p.id ? "…" : "↩ Reabrir"}
                        </button>
                      )}
                      <Btn onClick={() => abrirEditar(p)}>Editar</Btn>
                      <Btn variant="danger"
                        onClick={() => deletar(p.id, p.titulo)}
                        disabled={deletando === p.id}>
                        {deletando === p.id ? "…" : "Excluir"}
                      </Btn>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal Novo/Editar Prazo */}
      {modal && (
        <Modal
          title={modal.id ? "Editar Prazo" : "Novo Prazo"}
          onClose={() => { setModal(null); setCalcInfo(null); }}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Título *</label>
              <input
                className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold"
                value={modal.form.titulo}
                onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, titulo: e.target.value } }))}
                placeholder="Ex: Interpor Apelação — art. 1.003 CPC"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Tipo</label>
                <select
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold bg-bg"
                  value={modal.form.tipo}
                  onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, tipo: e.target.value } }))}>
                  {TIPO_PRAZO_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Prioridade</label>
                <select
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold bg-bg"
                  value={modal.form.prioridade}
                  onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, prioridade: e.target.value } }))}>
                  {PRIORIDADE_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>

            {/* Cálculo automático de vencimento */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 space-y-3">
              <p className="text-xs font-semibold text-blue-700">⚖️ Calculadora de Prazo (feriados + dias úteis)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">Data de início</label>
                  <input type="date"
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold bg-white"
                    value={modal.form.data_inicio}
                    onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, data_inicio: e.target.value } }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">Número de dias</label>
                  <input type="number" min="1"
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold bg-white"
                    value={modal.form.prazo_dias}
                    placeholder="Ex: 15"
                    onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, prazo_dias: e.target.value } }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">Tipo de contagem</label>
                  <select
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold bg-white"
                    value={modal.form.tipo_contagem}
                    onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, tipo_contagem: e.target.value } }))}>
                    <option value="uteis">Dias úteis (CPC art.219)</option>
                    <option value="corridos">Dias corridos</option>
                    <option value="meses">Meses</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">UF (feriados estaduais)</label>
                  <select
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold bg-white"
                    value={modal.form.uf}
                    onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, uf: e.target.value } }))}>
                    <option value="">Apenas nacionais</option>
                    {["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"].map(uf => (
                      <option key={uf} value={uf}>{uf}</option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Resultado do cálculo */}
              {calcLoading && (
                <p className="text-xs text-blue-500 italic">Calculando…</p>
              )}
              {!calcLoading && calcInfo && (
                <div className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-blue-200">
                  <span className="text-sm font-bold text-blue-700">
                    📅 {new Date(calcInfo.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${calcInfo.status === "vencido" ? "bg-red-100 text-red-600" : calcInfo.dias_uteis_restantes <= 3 ? "bg-orange-100 text-orange-600" : "bg-green-100 text-green-700"}`}>
                    {calcInfo.status === "vencido" ? "VENCIDO" : calcInfo.status === "hoje" ? "HOJE" : `${calcInfo.dias_uteis_restantes} dia(s) útil(eis)`}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Vencimento * <span className="text-muted font-normal">(preenchido automaticamente acima)</span></label>
              <input type="date"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold"
                value={modal.form.vencimento}
                onChange={e => { setCalcInfo(null); setModal(m => m && ({ ...m, form: { ...m.form, vencimento: e.target.value } })); }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Fundamento legal</label>
              <input
                className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold"
                value={modal.form.fundamento_legal}
                onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, fundamento_legal: e.target.value } }))}
                placeholder="Ex: art. 1.003, §5º CPC — 15 dias corridos"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Responsável</label>
              <input
                className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold"
                value={modal.form.responsavel}
                onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, responsavel: e.target.value } }))}
                placeholder="Nome do advogado responsável"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Descrição / Observações</label>
              <textarea rows={3}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-gold resize-none"
                value={modal.form.observacoes}
                onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, observacoes: e.target.value } }))}
                placeholder="Contexto adicional sobre este prazo…"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Btn onClick={() => { setModal(null); setCalcInfo(null); }}>Cancelar</Btn>
              <Btn variant="gold" onClick={salvar} disabled={salvando}>
                {salvando ? "Salvando…" : modal.id ? "Salvar alterações" : "Criar prazo"}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Importar da IA */}
      {importModal && (
        <Modal title="Importar prazos da análise IA" onClose={() => setImportModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Selecione os prazos extraídos da análise de <strong>Próximos Passos</strong> ou <strong>Estado Atual</strong> para importar:
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {importModal.map((item, i) => (
                <label key={item.key}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    item.selected ? "border-gold bg-gold/5" : "border-border hover:border-gold/40"
                  }`}>
                  <input type="checkbox" className="mt-0.5 flex-shrink-0"
                    checked={item.selected}
                    onChange={() => setImportModal(prev => prev && prev.map((x, j) =>
                      j === i ? { ...x, selected: !x.selected } : x
                    ))}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text-main line-clamp-2">{item.titulo}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted">
                        📅 {new Date(item.vencimento + "T00:00:00").toLocaleDateString("pt-BR")}
                      </span>
                      {item.urgencia && item.urgencia !== "normal" && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${PRIORIDADE_BADGE[item.urgencia] ?? ""}`}>
                          {item.urgencia}
                        </span>
                      )}
                    </div>
                    {item.fundamento && (
                      <p className="text-xs text-muted italic mt-0.5 line-clamp-1">{item.fundamento}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-border">
              <span className="text-xs text-muted">
                {importModal.filter(i => i.selected).length} de {importModal.length} selecionados
              </span>
              <div className="flex gap-2">
                <Btn onClick={() => setImportModal(null)}>Cancelar</Btn>
                <Btn variant="gold" onClick={confirmarImport} disabled={importando || importModal.filter(i => i.selected).length === 0}>
                  {importando ? "Importando…" : `Importar ${importModal.filter(i => i.selected).length}`}
                </Btn>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// ABA: ATENDIMENTOS
// ════════════════════════════════════════════════════════════════════════════

const TIPOS_ATENDIMENTO = [
  { value: "presencial",       label: "🤝 Presencial" },
  { value: "videoconferencia", label: "📹 Videoconferência" },
  { value: "telefone",         label: "📞 Telefone" },
  { value: "email",            label: "✉️  E-mail" },
];

const ATEND_FORM_VAZIO = {
  data_atendimento: new Date().toISOString().slice(0, 10),
  tipo: "presencial",
  duracao_min: 60,
  assunto: "",
  anotacoes: "",
  participantes: "",
};

function AbaAtendimentos({ processoId }: { processoId: string }) {
  const [atendimentos, setAtendimentos] = useState<Atendimento[]>([]);
  const [loading, setLoading]           = useState(true);
  const [modal, setModal]               = useState<{ form: typeof ATEND_FORM_VAZIO; id?: string } | null>(null);
  const [salvando, setSalvando]         = useState(false);
  const [deletando, setDeletando]       = useState<string | null>(null);
  const [expandido, setExpandido]       = useState<string | null>(null);
  const [totalHoras, setTotalHoras]     = useState(0);

  useEffect(() => {
    api.atendimentos.listar(processoId)
      .then(a => {
        setAtendimentos(a);
        const total = a.reduce((acc, x) => acc + x.duracao_min, 0);
        setTotalHoras(total);
      })
      .finally(() => setLoading(false));
  }, [processoId]);

  async function salvar() {
    if (!modal) return;
    setSalvando(true);
    try {
      const body = { ...modal.form, duracao_min: Number(modal.form.duracao_min) };
      if (modal.id) {
        const a = await api.atendimentos.atualizar(processoId, modal.id, body);
        setAtendimentos(prev => prev.map(x => x.id === modal.id ? a : x));
      } else {
        const a = await api.atendimentos.criar(processoId, body);
        setAtendimentos(prev => [a, ...prev]);
        setTotalHoras(h => h + Number(modal.form.duracao_min));
      }
      setModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar");
    } finally { setSalvando(false); }
  }

  async function deletar(id: string) {
    if (!confirm("Excluir este atendimento?")) return;
    setDeletando(id);
    try {
      await api.atendimentos.deletar(processoId, id);
      const removido = atendimentos.find(a => a.id === id);
      setAtendimentos(prev => prev.filter(a => a.id !== id));
      if (removido) setTotalHoras(h => h - removido.duracao_min);
    } finally { setDeletando(null); }
  }

  function horas(min: number) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h${m > 0 ? `${m}min` : ""}` : `${m}min`;
  }

  const TIPO_ICON: Record<string, string> = {
    presencial: "🤝", videoconferencia: "📹", telefone: "📞", email: "✉️",
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs text-muted">Total de horas</p>
            <p className="text-2xl font-bold text-text-main">{horas(totalHoras)}</p>
          </div>
          <div className="h-10 w-px bg-border" />
          <div>
            <p className="text-xs text-muted">Atendimentos</p>
            <p className="text-2xl font-bold text-text-main">{atendimentos.length}</p>
          </div>
        </div>
        <Btn variant="gold" onClick={() => setModal({ form: { ...ATEND_FORM_VAZIO } })}>
          + Registrar Atendimento
        </Btn>
      </div>

      {/* Lista */}
      {atendimentos.length === 0 ? (
        <div className="text-center py-16 text-muted text-sm border border-dashed border-border rounded-xl">
          <p className="text-2xl mb-2">📋</p>
          <p className="font-semibold text-text-main mb-1">Nenhum atendimento registrado</p>
          <p className="text-xs">Registre reuniões, calls e atendimentos presenciais</p>
        </div>
      ) : (
        <div className="space-y-2">
          {atendimentos.map(a => (
            <div key={a.id}
              className="bg-bg rounded-xl border border-border hover:border-gold/30 transition-colors">
              {/* Cabeçalho clicável */}
              <button
                className="w-full text-left p-4"
                onClick={() => setExpandido(expandido === a.id ? null : a.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-xl mt-0.5 flex-shrink-0">{TIPO_ICON[a.tipo] ?? "📋"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-main leading-tight">{a.assunto}</p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-muted">
                          {new Date(a.data_atendimento + "T00:00:00").toLocaleDateString("pt-BR", {
                            weekday: "short", day: "2-digit", month: "short", year: "numeric"
                          })}
                        </span>
                        <span className="text-xs bg-surface border border-border px-2 py-0.5 rounded-full text-muted">
                          {horas(a.duracao_min)}
                        </span>
                        {a.participantes && (
                          <span className="text-xs text-muted truncate">👥 {a.participantes}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <Btn onClick={() => setModal({ form: {
                      data_atendimento: a.data_atendimento,
                      tipo: a.tipo,
                      duracao_min: a.duracao_min,
                      assunto: a.assunto,
                      anotacoes: a.anotacoes ?? "",
                      participantes: a.participantes ?? "",
                    }, id: a.id })}>Editar</Btn>
                    <Btn variant="danger"
                      onClick={() => deletar(a.id)}
                      disabled={deletando === a.id}>
                      {deletando === a.id ? "…" : "Excluir"}
                    </Btn>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className={`text-muted transition-transform ${expandido === a.id ? "rotate-180" : ""}`}>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </div>
              </button>

              {/* Detalhes expandidos */}
              {expandido === a.id && (
                <div className="px-4 pb-4 pt-0 border-t border-border space-y-3 mt-0">
                  {a.anotacoes && (
                    <div className="pt-3">
                      <p className="text-xs font-semibold text-muted mb-1">Anotações</p>
                      <p className="text-sm text-text-main whitespace-pre-wrap leading-relaxed bg-surface rounded-lg p-3 border border-border">
                        {a.anotacoes}
                      </p>
                    </div>
                  )}
                  {a.documentos_vinculados?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted mb-1">Documentos vinculados</p>
                      <div className="flex flex-wrap gap-2">
                        {a.documentos_vinculados.map((d, i) => (
                          <span key={i}
                            className="text-xs bg-surface border border-border rounded-full px-3 py-1 text-muted">
                            📎 {d.nome}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted">
                    Registrado em {new Date(a.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal criar/editar */}
      {modal && (
        <Modal
          title={modal.id ? "Editar Atendimento" : "Registrar Atendimento"}
          onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Assunto *</label>
              <input
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
                placeholder="Ex: Reunião de estratégia para recurso"
                value={modal.form.assunto}
                onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, assunto: e.target.value } }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Tipo</label>
                <select
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
                  value={modal.form.tipo}
                  onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, tipo: e.target.value } }))}>
                  {TIPOS_ATENDIMENTO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Data</label>
                <input type="date"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
                  value={modal.form.data_atendimento}
                  onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, data_atendimento: e.target.value } }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Duração (minutos)</label>
                <input type="number" min={5} step={5}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
                  value={modal.form.duracao_min}
                  onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, duracao_min: Number(e.target.value) } }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Participantes</label>
                <input
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
                  placeholder="João, Maria…"
                  value={modal.form.participantes}
                  onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, participantes: e.target.value } }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Anotações</label>
              <textarea rows={4}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40 resize-none"
                placeholder="O que foi discutido, decisões tomadas, próximos passos…"
                value={modal.form.anotacoes}
                onChange={e => setModal(m => m && ({ ...m, form: { ...m.form, anotacoes: e.target.value } }))}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-border">
              <Btn onClick={() => setModal(null)}>Cancelar</Btn>
              <button onClick={salvar} disabled={salvando || !modal.form.assunto.trim()}
                className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all disabled:opacity-50">
                {salvando ? "Salvando…" : modal.id ? "Salvar alterações" : "Registrar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Timesheet por tarefa (componente auxiliar) ────────────────────────────

function TimesheetTarefa({ processoId, tarefaId, tarefaTitulo }: {
  processoId: string; tarefaId: string; tarefaTitulo: string;
}) {
  const [entries, setEntries]     = useState<TimesheetEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [totalMin, setTotalMin]   = useState(0);
  const [totalValor, setTotalValor] = useState(0);
  const [form, setForm]           = useState({
    descricao: "", tipo: "trabalho", duracao_min: 60,
    data_lancamento: new Date().toISOString().slice(0, 10),
    valor_hora: 0,
  });
  const [salvando, setSalvando]   = useState(false);
  const [timer, setTimer]         = useState<{ rodando: boolean; inicio: number; elapsed: number }>({ rodando: false, inicio: 0, elapsed: 0 });
  const intervalRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.timesheet.listar(processoId, tarefaId)
      .then(r => { setEntries(r.entries); setTotalMin(r.total_min); setTotalValor(r.total_valor ?? 0); })
      .finally(() => setLoading(false));
  }, [processoId, tarefaId]);

  function iniciarTimer() {
    setTimer({ rodando: true, inicio: Date.now(), elapsed: 0 });
    intervalRef.current = setInterval(() => {
      setTimer(t => ({ ...t, elapsed: Math.floor((Date.now() - t.inicio) / 1000) }));
    }, 1000);
  }

  async function pararTimer() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const minutos = Math.max(1, Math.round(timer.elapsed / 60));
    setTimer({ rodando: false, inicio: 0, elapsed: 0 });
    await lancar({ ...form, descricao: form.descricao || tarefaTitulo, duracao_min: minutos });
  }

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  async function lancar(body: typeof form) {
    setSalvando(true);
    try {
      const e = await api.timesheet.lancar(processoId, { ...body, tarefa_id: tarefaId });
      setEntries(prev => [e, ...prev]);
      setTotalMin(t => t + body.duracao_min);
      const vt = body.valor_hora > 0 ? Math.round(body.valor_hora * body.duracao_min / 60 * 100) / 100 : 0;
      setTotalValor(t => Math.round((t + vt) * 100) / 100);
      setForm(f => ({ ...f, descricao: "", duracao_min: 60 }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao lançar horas");
    } finally { setSalvando(false); }
  }

  async function deletarEntry(id: string, min: number, vt: number) {
    await api.timesheet.deletar(processoId, id);
    setEntries(prev => prev.filter(e => e.id !== id));
    setTotalMin(t => t - min);
    setTotalValor(t => Math.max(0, Math.round((t - vt) * 100) / 100));
  }

  function fmtTime(sec: number) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h > 0 ? h + "h " : ""}${m}m ${s}s`;
  }
  function fmtMin(min: number) {
    const h = Math.floor(min / 60); const m = min % 60;
    return h > 0 ? `${h}h${m > 0 ? `${m}min` : ""}` : `${m}min`;
  }
  function fmtBRL(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  const valorPreview = form.valor_hora > 0
    ? Math.round(form.valor_hora * form.duracao_min / 60 * 100) / 100
    : 0;

  const TIPOS_TS = ["trabalho", "reuniao", "pesquisa", "audiencia", "deslocamento"];

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-3">
      {/* Cabeçalho com totais */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gold">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <p className="text-xs font-bold text-text-main uppercase tracking-wide">Timesheet</p>
        </div>
        <div className="flex items-center gap-2">
          {totalMin > 0 && (
            <span className="text-xs font-bold text-gold bg-gold/10 px-2.5 py-1 rounded-full">
              {fmtMin(totalMin)}
            </span>
          )}
          {totalValor > 0 && (
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              {fmtBRL(totalValor)}
            </span>
          )}
        </div>
      </div>

      {/* Painel timer / lançamento manual */}
      <div className="bg-[#0a1628]/[0.03] border border-border rounded-xl p-3 space-y-2">
        {timer.rodando ? (
          /* ── Timer rodando ── */
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <span className="text-sm font-mono font-bold text-text-main">{fmtTime(timer.elapsed)}</span>
              <span className="text-xs text-muted">gravando…</span>
              {form.valor_hora > 0 && (
                <span className="text-xs text-emerald-600 font-semibold">
                  ≈ {fmtBRL(form.valor_hora * timer.elapsed / 3600)}
                </span>
              )}
            </div>
            <button onClick={pararTimer}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16"/></svg>
              Parar e salvar
            </button>
          </div>
        ) : (
          /* ── Formulário de lançamento ── */
          <>
            {/* Linha 1: descrição + tipo */}
            <div className="grid grid-cols-3 gap-2">
              <input
                className="col-span-2 border border-border rounded-lg px-3 py-1.5 text-xs bg-bg text-text-main focus:outline-none focus:ring-1 focus:ring-gold/40"
                placeholder="Descrição (ex: Elaboração da petição inicial)"
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
              />
              <select className="border border-border rounded-lg px-2 py-1.5 text-xs bg-bg text-text-main focus:outline-none"
                value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {TIPOS_TS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Linha 2: duração + valor/hora + data */}
            <div className="grid grid-cols-5 gap-2 items-center">
              <div className="flex items-center gap-1 col-span-2">
                <input type="number" min={1} step={5}
                  className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-bg text-text-main focus:outline-none focus:ring-1 focus:ring-gold/40"
                  value={form.duracao_min}
                  onChange={e => setForm(f => ({ ...f, duracao_min: Number(e.target.value) }))}
                />
                <span className="text-xs text-muted whitespace-nowrap">min</span>
              </div>
              <div className="flex items-center gap-1 col-span-2 relative">
                <span className="absolute left-2.5 text-xs text-muted pointer-events-none">R$</span>
                <input type="number" min={0} step={10}
                  className="w-full border border-border rounded-lg pl-7 pr-2 py-1.5 text-xs bg-bg text-text-main focus:outline-none focus:ring-1 focus:ring-gold/40"
                  placeholder="0,00/h"
                  value={form.valor_hora || ""}
                  onChange={e => setForm(f => ({ ...f, valor_hora: Number(e.target.value) }))}
                />
              </div>
              <input type="date"
                className="col-span-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-bg text-text-main focus:outline-none"
                value={form.data_lancamento}
                onChange={e => setForm(f => ({ ...f, data_lancamento: e.target.value }))}
              />
            </div>

            {/* Preview do valor + botões */}
            <div className="flex items-center gap-2 flex-wrap">
              {valorPreview > 0 && (
                <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg font-semibold">
                  Valor: {fmtBRL(valorPreview)}
                </span>
              )}
              <div className="flex gap-2 ml-auto">
                <button onClick={iniciarTimer}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gold/40 text-gold hover:bg-gold/5 transition-colors">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Iniciar timer
                </button>
                <button onClick={() => lancar(form)} disabled={salvando}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-gold text-navy hover:bg-gold-light transition-colors disabled:opacity-50">
                  {salvando ? "…" : (
                    <>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      Lançar
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Histórico */}
      {loading ? (
        <div className="h-8 bg-bg rounded animate-pulse" />
      ) : entries.length > 0 ? (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {entries.map(e => (
            <div key={e.id}
              className="flex items-center gap-2 px-3 py-2 bg-bg rounded-xl border border-border group hover:border-gold/20 transition-colors">
              <span className="text-[10px] text-muted flex-shrink-0">
                {new Date(e.data_lancamento + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
              </span>
              <span className="text-xs text-text-main flex-1 truncate">{e.descricao}</span>
              <span className="text-xs font-semibold text-gold flex-shrink-0">{fmtMin(e.duracao_min)}</span>
              {(e.valor_total ?? 0) > 0 && (
                <span className="text-xs font-bold text-emerald-600 flex-shrink-0">{fmtBRL(e.valor_total)}</span>
              )}
              <button onClick={() => deletarEntry(e.id, e.duracao_min, e.valor_total ?? 0)}
                className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-danger transition-all flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted text-center py-3">Nenhum lançamento ainda</p>
      )}
    </div>
  );
}

function AbaAtividade({ processoId }: { processoId: string }) {
  const [loading, setLoading] = useState(true);
  const [itens, setItens] = useState<{ tipo: string; titulo: string; subtitulo?: string; at: string; durMin?: number | null; badge?: string; badgeCor?: string }[]>([]);

  useEffect(() => {
    Promise.all([
      api.documentos.listar(processoId),
      api.analises.listar(processoId),
      api.revisao.tarefas(undefined, processoId),
    ]).then(([docs, analises, tarefas]) => {
      const lista: typeof itens = [];

      docs.forEach(d => {
        lista.push({
          tipo: "📄 Upload",
          titulo: d.nome_original,
          subtitulo: d.total_paginas ? `${d.total_paginas} páginas · ${d.status}` : d.status,
          at: d.uploaded_at,
          badge: d.status,
          badgeCor: d.status === "processado" ? "bg-green-100 text-green-700"
            : d.status === "erro" ? "bg-red-100 text-red-700"
            : "bg-yellow-100 text-yellow-700",
        });
        if (d.processado_at) {
          lista.push({
            tipo: "⚙ Processamento",
            titulo: `Processamento de "${d.nome_original}"`,
            subtitulo: d.ocr_utilizado ? "OCR aplicado" : "Extração direta",
            at: d.processado_at,
            durMin: diffMin(d.uploaded_at, d.processado_at),
            badge: d.ocr_utilizado ? "OCR" : "direto",
            badgeCor: "bg-blue-100 text-blue-700",
          });
        }
      });

      analises.forEach(a => {
        const label = TIPOS_ANALISE.find(t => t.id === a.tipo)?.label ?? a.tipo.replace(/_/g," ");
        lista.push({
          tipo: "🤖 Análise IA",
          titulo: label,
          subtitulo: `${a.modelo_ia} · ${(a.tokens_input ?? 0) + (a.tokens_output ?? 0)} tokens · confiança ${Math.round((a.confianca ?? 0) * 100)}% · ${calcCustoAnalise(a.modelo_ia, a.tokens_input ?? 0, a.tokens_output ?? 0).label}`,
          at: a.created_at,
          badge: a.status_revisao,
          badgeCor: a.status_revisao === "aprovada" ? "bg-green-100 text-green-700"
            : a.status_revisao === "rejeitada" ? "bg-red-100 text-red-700"
            : "bg-yellow-100 text-yellow-700",
        });
        if (a.revisado_at) {
          lista.push({
            tipo: a.status_revisao === "aprovada" ? "✅ Aprovação" : "❌ Rejeição",
            titulo: `${a.status_revisao === "aprovada" ? "Aprovada" : "Rejeitada"}: ${label}`,
            at: a.revisado_at,
            durMin: diffMin(a.created_at, a.revisado_at),
          });
        }
      });

      tarefas.forEach(t => {
        lista.push({
          tipo: "📋 Tarefa",
          titulo: t.titulo,
          subtitulo: `${t.tipo} · ${t.prioridade}`,
          at: t.created_at,
          badge: t.status,
          badgeCor: t.status === "aprovado" ? "bg-green-100 text-green-700"
            : t.status === "rejeitado" ? "bg-red-100 text-red-700"
            : "bg-yellow-100 text-yellow-700",
        });
      });

      lista.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      setItens(lista);
    }).finally(() => setLoading(false));
  }, [processoId]);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!itens.length) return <div className="text-center py-16 text-muted text-sm">Nenhuma atividade registrada.</div>;

  // Agrupa por dia
  const porDia: Record<string, typeof itens> = {};
  itens.forEach(item => {
    const dia = new Date(item.at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    if (!porDia[dia]) porDia[dia] = [];
    porDia[dia].push(item);
  });

  const totalAnalises = itens.filter(i => i.tipo.includes("Análise")).length;
  const totalUploads = itens.filter(i => i.tipo.includes("Upload")).length;
  const totalAprovacoes = itens.filter(i => i.tipo.includes("Aprovação")).length;

  return (
    <div className="space-y-6">
      {/* Sumário */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Uploads", valor: totalUploads, icon: "📄" },
          { label: "Análises IA", valor: totalAnalises, icon: "🤖" },
          { label: "Aprovações", valor: totalAprovacoes, icon: "✅" },
        ].map(c => (
          <div key={c.label} className="bg-bg rounded-xl border border-border p-4 text-center">
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className="text-xl font-bold text-text-main">{c.valor}</p>
            <p className="text-xs text-muted">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Timeline por dia */}
      {Object.entries(porDia).map(([dia, eventos]) => (
        <div key={dia}>
          <p className="text-xs font-bold text-muted uppercase tracking-wide mb-3 capitalize">{dia}</p>
          <div className="space-y-2 pl-4 border-l-2 border-border">
            {eventos.map((item, i) => (
              <div key={i} className="relative bg-bg rounded-xl border border-border p-3 hover:border-gold/30 transition-colors">
                <div className="absolute -left-[1.35rem] top-3.5 w-2.5 h-2.5 rounded-full bg-gold border-2 border-surface" />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs text-muted">{item.tipo}</span>
                      {item.badge && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.badgeCor ?? "bg-gray-100 text-gray-600"}`}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-text-main truncate">{item.titulo}</p>
                    {item.subtitulo && <p className="text-xs text-muted mt-0.5">{item.subtitulo}</p>}
                    {item.durMin !== null && item.durMin !== undefined && (
                      <p className="text-xs text-blue-600 mt-0.5">⏱ {item.durMin < 60 ? `${item.durMin} min` : `${Math.round(item.durMin/60)}h ${item.durMin % 60}min`} desde a criação</p>
                    )}
                  </div>
                  <span className="text-xs font-mono text-muted flex-shrink-0">
                    {new Date(item.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: EDITAR PROCESSO
// ════════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = ["ativo", "arquivado", "suspenso"];

function ModalEditarProcesso({ processo, onSalvar, onFechar }: {
  processo: Processo;
  onSalvar: (p: Processo) => void;
  onFechar: () => void;
}) {
  const [form, setForm] = useState({
    numero_cnj:  processo.numero_cnj  ?? "",
    tribunal:    processo.tribunal    ?? "",
    vara:        processo.vara        ?? "",
    assunto:     processo.assunto     ?? "",
    status:      processo.status      ?? "ativo",
    responsavel: processo.responsavel ?? "",
    tags:        (processo.tags ?? []).join(", "),
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const set = (k: keyof typeof form, v: string) =>
    setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      const tags = form.tags
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);

      const atualizado = await api.processos.atualizar(processo.id, {
        numero_cnj:  form.numero_cnj  || undefined,
        tribunal:    form.tribunal    || undefined,
        vara:        form.vara        || undefined,
        assunto:     form.assunto     || undefined,
        status:      form.status,
        responsavel: form.responsavel || undefined,
        tags,
      });
      onSalvar(atualizado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  const input = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40";

  return (
    <Modal title="Editar Processo" onClose={onFechar} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {erro && (
          <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            {erro}
          </div>
        )}

        {/* Número CNJ */}
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Número CNJ</label>
          <input className={input} placeholder="0000000-00.0000.0.00.0000"
            value={form.numero_cnj} onChange={e => set("numero_cnj", e.target.value)} />
        </div>

        {/* Tribunal + Vara */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Tribunal</label>
            <input className={input} placeholder="TJSP, TRF3, STJ…"
              value={form.tribunal} onChange={e => set("tribunal", e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Vara / Câmara</label>
            <input className={input} placeholder="1ª Vara Cível…"
              value={form.vara} onChange={e => set("vara", e.target.value)} />
          </div>
        </div>

        {/* Assunto */}
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Assunto</label>
          <input className={input} placeholder="Indenização por danos morais…"
            value={form.assunto} onChange={e => set("assunto", e.target.value)} />
        </div>

        {/* Status + Responsável */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Status</label>
            <select className={input} value={form.status}
              onChange={e => set("status", e.target.value)}>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Responsável</label>
            <input className={input} placeholder="Nome do advogado…"
              value={form.responsavel} onChange={e => set("responsavel", e.target.value)} />
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">
            Tags <span className="font-normal text-muted">(separadas por vírgula)</span>
          </label>
          <input className={input} placeholder="urgente, trabalhista, recurso…"
            value={form.tags} onChange={e => set("tags", e.target.value)} />
        </div>

        {/* Ações */}
        <div className="flex gap-2 justify-end pt-2 border-t border-border">
          <Btn onClick={onFechar} disabled={salvando}>Cancelar</Btn>
          <button type="submit" disabled={salvando}
            className="bg-gold text-navy font-semibold rounded-lg px-5 py-2 text-sm hover:bg-gold-light transition-all disabled:opacity-50 flex items-center gap-2">
            {salvando ? <><Spinner sm /> Salvando…</> : "Salvar alterações"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

export default function ProcessoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [processo, setProcesso] = useState<Processo | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("documentos");
  const [modalEditar, setModalEditar] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncDataJudResult | null>(null);
  const [syncErro, setSyncErro] = useState<string | null>(null);
  const [partesDatajud, setPartesDatajud] = useState<SyncDataJudResult["partes"]>([]);
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const p = await api.processos.obter(id);
      setProcesso(p);
    } catch {
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { carregar(); }, [carregar]);

  async function handleGerarRelatorio() {
    setGerandoRelatorio(true);
    try {
      await api.relatorio.abrir(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao gerar relatório");
    } finally {
      setGerandoRelatorio(false);
    }
  }

  async function handleSyncDataJud() {
    setSincronizando(true);
    setSyncResult(null);
    setSyncErro(null);
    setPartesDatajud([]);
    try {
      const r = await api.monitoramento.sync(id);
      setSyncResult(r);
      if (r.partes && r.partes.length > 0) {
        setPartesDatajud(r.partes);
      }
      if (r.novos > 0) await carregar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao sincronizar com DataJud";
      // Melhora mensagem de 401 para o usuário
      if (msg.includes("401")) {
        setSyncErro(
          "Chave da API DataJud expirou (401). Acesse datajud-wiki.cnj.jus.br/api-publica/ " +
          "para obter a chave atual e configure a variável DATAJUD_API_KEY no servidor (Render)."
        );
      } else {
        setSyncErro(msg);
      }
    } finally {
      setSincronizando(false);
    }
  }

  if (loading) return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 sm:ml-0 flex items-center justify-center"><Spinner /></div>
    </div>
  );
  if (!processo) return null;

  const statusStyle: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    ativo:     { bg: "bg-emerald-50",  text: "text-emerald-700", dot: "bg-emerald-500", label: "Ativo" },
    arquivado: { bg: "bg-slate-100",   text: "text-slate-500",   dot: "bg-slate-400",   label: "Arquivado" },
    suspenso:  { bg: "bg-amber-50",    text: "text-amber-700",   dot: "bg-amber-500",   label: "Suspenso" },
    encerrado: { bg: "bg-rose-50",     text: "text-rose-700",    dot: "bg-rose-500",    label: "Encerrado" },
  };
  const ss = statusStyle[processo.status] ?? statusStyle.arquivado;

  return (
    <div className="flex h-screen bg-[#f4f5f7] overflow-hidden">
      <Sidebar />
      <div className="flex-1 sm:ml-0 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          title={processo.numero_cnj ?? processo.id.slice(0, 8) + "…"}
          subtitle={[processo.tribunal, processo.vara].filter(Boolean).join(" · ") || "Processo Jurídico"}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* ── HERO HEADER ──────────────────────────────────────────── */}
          <div className="bg-navy relative overflow-hidden">
            {/* Ornamento de fundo */}
            <div className="absolute inset-0 opacity-5 pointer-events-none select-none"
              style={{ backgroundImage: "radial-gradient(circle at 80% 50%, #C9A84C 0%, transparent 60%)" }} />
            <div className="absolute right-0 top-0 bottom-0 w-1 bg-gold opacity-60" />

            <div className="relative px-6 pt-5 pb-0">
              {/* Voltar */}
              <button onClick={() => router.back()}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/8 hover:bg-white/15 text-white/50 hover:text-white transition-all mb-4 group">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="group-hover:-translate-x-0.5 transition-transform">
                  <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
                </svg>
              </button>

              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 pb-5">
                {/* Info principal */}
                <div className="flex-1 min-w-0 space-y-3">
                  {/* Número CNJ */}
                  <div className="flex items-start gap-3">
                    <div className="w-1 h-10 bg-gold rounded-full flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-white font-bold text-xl font-mono leading-tight tracking-tight">
                        {processo.numero_cnj ?? <span className="text-white/40 italic text-base font-sans font-normal">Sem número CNJ</span>}
                      </p>
                      {processo.assunto && (
                        <p className="text-white/60 text-sm mt-1 leading-snug">{processo.assunto}</p>
                      )}
                    </div>
                  </div>

                  {/* Tribunal · Vara */}
                  {(processo.tribunal || processo.vara) && (
                    <div className="flex items-center gap-2 flex-wrap ml-4">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gold/60 flex-shrink-0">
                        <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                      </svg>
                      {processo.tribunal && <span className="text-white/70 text-xs font-semibold">{processo.tribunal}</span>}
                      {processo.vara && <><span className="text-white/20">·</span><span className="text-white/50 text-xs">{processo.vara}</span></>}
                    </div>
                  )}

                  {/* Badges */}
                  <div className="flex items-center flex-wrap gap-2 ml-4">
                    {/* Status */}
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${ss.bg} ${ss.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ss.dot}`} />
                      {ss.label}
                    </span>
                    {/* Cliente */}
                    {processo.cliente_nome && processo.cliente_id && (
                      <a href={`/clientes/${processo.cliente_id}`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-gold/15 text-gold hover:bg-gold/25 transition-colors">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                        </svg>
                        {processo.cliente_nome}
                      </a>
                    )}
                    {/* Responsável */}
                    {processo.responsavel && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-white/40">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                        </svg>
                        {processo.responsavel}
                      </span>
                    )}
                    {/* Tags */}
                    {processo.tags?.map(tag => (
                      <span key={tag} className="text-xs bg-white/10 text-white/60 px-2 py-0.5 rounded-full">{tag}</span>
                    ))}
                  </div>
                </div>

                {/* Ações */}
                <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap lg:flex-shrink-0">
                  <button onClick={handleGerarRelatorio} disabled={gerandoRelatorio}
                    title="Gerar relatório PDF"
                    className="flex items-center gap-2 text-xs font-semibold text-gold border border-gold/40 hover:border-gold hover:bg-gold/10 px-3 py-2 rounded-xl transition-all disabled:opacity-50 whitespace-nowrap">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    {gerandoRelatorio ? "Gerando…" : "PDF"}
                  </button>
                  <button onClick={handleSyncDataJud} disabled={sincronizando}
                    title="Sync DataJud CNJ"
                    className="flex items-center gap-2 text-xs font-semibold text-white/60 border border-white/15 hover:border-white/30 hover:text-white px-3 py-2 rounded-xl transition-all disabled:opacity-50 whitespace-nowrap">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      className={sincronizando ? "animate-spin" : ""}>
                      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    {sincronizando ? "Sync…" : "DataJud"}
                  </button>
                  <button onClick={() => setModalEditar(true)}
                    title="Editar processo"
                    className="flex items-center gap-2 text-xs font-semibold text-white/60 border border-white/15 hover:border-white/30 hover:text-white px-3 py-2 rounded-xl transition-all whitespace-nowrap">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Editar
                  </button>
                </div>
              </div>

              {/* Banner: partes identificadas pelo DataJud — cadastrar cliente */}
              {partesDatajud && partesDatajud.length > 0 && (
                <div className="mb-2 rounded-xl border border-amber-400/50 bg-amber-900/25 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-base">👥</span>
                    <p className="text-sm font-bold text-amber-200">Partes identificadas no DataJud — quem é o seu cliente?</p>
                    <button onClick={() => setPartesDatajud([])} className="ml-auto text-white/30 hover:text-white/60 text-xs">✕</button>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {partesDatajud.map((p, i) => (
                      <button key={i}
                        onClick={() => {
                          window.open(
                            `/clientes?novo=1&nome=${encodeURIComponent(p.nome)}&processo=${id}&polo=${encodeURIComponent(p.polo)}`,
                            "_blank"
                          );
                          setPartesDatajud([]);
                        }}
                        className={`text-xs px-3 py-2 rounded-lg border font-semibold transition-all hover:scale-105 flex flex-col items-start gap-0.5 ${
                          p.polo === "ATIVO"
                            ? "bg-blue-900/40 border-blue-400/50 text-blue-200 hover:bg-blue-900/70"
                            : "bg-purple-900/40 border-purple-400/50 text-purple-200 hover:bg-purple-900/70"
                        }`}>
                        <span className="text-[10px] font-normal opacity-70">{p.polo === "ATIVO" ? "Polo Ativo" : "Polo Passivo"} · {p.tipo}</span>
                        <span>{p.nome}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-400/70">Clique na parte para cadastrá-la como cliente e vinculá-la a este processo automaticamente.</p>
                </div>
              )}

              {/* Banners sync abaixo do header */}
              {(syncResult || syncErro) && (
                <div className="pb-3 space-y-2">
                  {syncResult && (
                    <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
                      syncResult.status === "nao_encontrado" ? "bg-amber-50/10 border-amber-400/30"
                      : syncResult.novos > 0 ? "bg-emerald-50/10 border-emerald-400/30"
                      : "bg-white/5 border-white/10"}`}>
                      <span className="text-base flex-shrink-0 mt-0.5">
                        {syncResult.status === "nao_encontrado" ? "⚠️" : syncResult.novos > 0 ? "✨" : "✅"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white/80">
                          {syncResult.status === "nao_encontrado" ? "Não encontrado no DataJud"
                            : syncResult.novos > 0 ? `${syncResult.novos} movimentação${syncResult.novos > 1 ? "ões" : ""} adicionada${syncResult.novos > 1 ? "s" : ""}`
                            : "Cronologia atualizada"}
                        </p>
                        {syncResult.status !== "nao_encontrado" && (
                          <p className="text-xs text-white/40 mt-0.5">
                            {syncResult.total_datajud} mov. no CNJ{syncResult.tribunal ? ` · ${syncResult.tribunal}` : ""}
                          </p>
                        )}
                      </div>
                      <button onClick={() => setSyncResult(null)} className="text-white/30 hover:text-white/70 text-xs">✕</button>
                    </div>
                  )}
                  {syncErro && (
                    <div className="rounded-xl border border-red-400/30 bg-red-50/10 px-4 py-3 flex items-start gap-3">
                      <span className="text-base flex-shrink-0 mt-0.5">❌</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-red-300 mb-0.5">Erro ao sincronizar DataJud</p>
                        <p className="text-xs text-red-300/70 break-words">{syncErro}</p>
                        {syncErro.includes("401") && (
                          <a href="https://datajud-wiki.cnj.jus.br/api-publica/"
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs text-amber-400 underline mt-1 inline-block hover:text-amber-300">
                            → Obter chave DataJud atualizada
                          </a>
                        )}
                      </div>
                      <button onClick={() => setSyncErro(null)} className="text-white/30 hover:text-white/70 text-xs flex-shrink-0">✕</button>
                    </div>
                  )}

                  {/* Partes do DataJud — oferecer vinculação de cliente */}
                  {partesDatajud && partesDatajud.length > 0 && (
                    <div className="rounded-xl border border-amber-400/40 bg-amber-900/20 px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400 flex-shrink-0">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        <p className="text-xs font-bold text-amber-300">Partes identificadas no DataJud — quem é o seu cliente?</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {partesDatajud.map((p, i) => (
                          <button key={i}
                            onClick={() => {
                              window.open(
                                `/clientes?novo=1&nome=${encodeURIComponent(p.nome)}&processo=${id}&polo=${encodeURIComponent(p.polo)}`,
                                "_blank"
                              );
                              setPartesDatajud([]);
                            }}
                            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all hover:scale-105 ${
                              p.polo === "ATIVO"
                                ? "bg-blue-900/30 border-blue-400/40 text-blue-300 hover:bg-blue-900/60"
                                : "bg-purple-900/30 border-purple-400/40 text-purple-300 hover:bg-purple-900/60"
                            }`}>
                            <span className="opacity-60 mr-1">{p.polo === "ATIVO" ? "Polo A:" : "Polo P:"}</span>
                            {p.nome}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-amber-400/60">Clique na parte para cadastrá-la como cliente vinculado a este processo</p>
                        <button onClick={() => setPartesDatajud([])} className="text-[10px] text-white/30 hover:text-white/60">dispensar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Métricas no rodapé do hero */}
              <div className="grid grid-cols-4 border-t border-white/10 -mx-6">
                {[
                  { label: "Documentos",  v: processo.total_documentos,  tab: "documentos" as Tab,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
                  { label: "Peças",       v: processo.total_pecas,       tab: "pecas" as Tab,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
                  { label: "Prazos",      v: processo.analises_pendentes,tab: "prazos" as Tab,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
                  { label: "Tarefas",     v: processo.tarefas_pendentes, tab: "revisao" as Tab,
                    accent: processo.tarefas_pendentes > 0,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
                ].map(m => (
                  <button key={m.label} onClick={() => setTab(m.tab)}
                    className={`flex flex-col items-center gap-1 px-4 py-3 hover:bg-white/5 transition-colors border-r border-white/10 last:border-r-0 group`}>
                    <span className={`${(m as {accent?: boolean}).accent ? "text-amber-400" : "text-white/40 group-hover:text-white/60"} transition-colors`}>
                      {m.icon}
                    </span>
                    <span className={`text-xl font-bold ${(m as {accent?: boolean}).accent ? "text-amber-400" : "text-white"}`}>{m.v}</span>
                    <span className="text-[10px] text-white/40 font-medium">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── TABS ─────────────────────────────────────────────────── */}
          <div className="bg-bg border-b border-border sticky top-0 z-10">
            <div className="flex overflow-x-auto scrollbar-none px-4">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-3.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-all flex-shrink-0 ${
                    tab === t.id
                      ? "border-gold text-gold"
                      : "border-transparent text-muted hover:text-text-main hover:border-border"
                  }`}>
                  <span className={tab === t.id ? "text-gold" : "text-muted"}>
                    {TAB_ICONS[t.id]}
                  </span>
                  {t.label}
                  {t.id === "revisao" && processo.tarefas_pendentes > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-400 text-white text-[10px] font-bold">
                      {processo.tarefas_pendentes}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── CONTEÚDO DA ABA ──────────────────────────────────────── */}
          <div className="p-4 sm:p-6 max-w-full">
            {tab === "documentos"   && <AbaDocumentos   processoId={id} />}
            {tab === "pecas"        && <AbaPecas        processoId={id} />}
            {tab === "cronologia"   && <AbaCronologia   processoId={id} />}
            {tab === "prazos"       && <AbaPrazos       processoId={id} />}
            {tab === "analises"     && <AbaAnalises     processoId={id} processo={processo} onRefreshProcesso={carregar} />}
            {tab === "revisao"      && <AbaRevisao      processoId={id} onRefreshProcesso={carregar} />}
            {tab === "atendimentos" && <AbaAtendimentos processoId={id} />}
            {tab === "minutas"      && <AbaMinutas      processoId={id} />}
            {tab === "snapshots"    && <AbaSnapshots    processoId={id} />}
            {tab === "chat"         && <AbaChat         processoId={id} />}
            {tab === "atividade"    && <AbaAtividade    processoId={id} />}
          </div>
        </main>
      </div>

      {/* Modal editar processo */}
      {modalEditar && (
        <ModalEditarProcesso
          processo={processo}
          onSalvar={p => { setProcesso(p); setModalEditar(false); }}
          onFechar={() => setModalEditar(false)}
        />
      )}
    </div>
  );
}
