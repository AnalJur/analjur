"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import {
  api, type Processo, type Documento, type EventoCronologia,
  type Analise, type TarefaRevisao, type Minuta, type Snapshot, type Peca,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtData(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("pt-BR");
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

const TABS = [
  { id: "documentos", label: "Documentos" },
  { id: "cronologia", label: "Cronologia" },
  { id: "analises",   label: "Análises IA" },
  { id: "revisao",    label: "Revisão" },
  { id: "minutas",    label: "Minutas" },
  { id: "snapshots",  label: "Versões" },
  { id: "chat",       label: "Chat IA" },
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

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <>
      <div className="space-y-3">
        <div className="flex justify-end">
          <a href={`/upload?processo=${processoId}`}
            className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all">
            + Enviar Documento
          </a>
        </div>

        {!docs.length && (
          <div className="text-center py-16 text-muted text-sm">
            Nenhum documento ainda.{" "}
            <a href={`/upload?processo=${processoId}`} className="text-gold underline">Enviar agora</a>
          </div>
        )}

        {docs.map(d => (
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

function AbaCronologia({ processoId }: { processoId: string }) {
  const [eventos, setEventos] = useState<EventoCronologia[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalEvento, setModalEvento] = useState<{ form: EventoForm; id?: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [deletando, setDeletando] = useState<string | null>(null);

  useEffect(() => {
    api.cronologia.listar(processoId).then(setEventos).finally(() => setLoading(false));
  }, [processoId]);

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

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <>
      <div className="flex justify-end mb-4">
        <button onClick={() => setModalEvento({ form: EVENTO_FORM_VAZIO })}
          className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all">
          + Novo Evento
        </button>
      </div>

      {!eventos.length && (
        <div className="text-center py-16 text-muted text-sm">
          Nenhum evento. Gere uma análise de cronologia ou adicione manualmente.
        </div>
      )}

      <div className="relative">
        {eventos.length > 0 && <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />}
        <div className="space-y-4 pl-10">
          {eventos.map(ev => (
            <div key={ev.id} className="relative">
              <div className={`absolute -left-6 top-3 w-3 h-3 rounded-full border-2 border-surface
                ${ev.relevancia === "critica" ? "bg-red-500" : ev.relevancia === "alta" ? "bg-orange-400" : ev.relevancia === "media" ? "bg-gold" : "bg-green-400"}`} />
              <div
                className="bg-bg rounded-xl border border-border p-4 hover:border-gold/40 transition-colors cursor-pointer"
                onClick={() => setModalEvento({
                  id: ev.id,
                  form: {
                    tipo_evento: ev.tipo_evento,
                    descricao: ev.descricao,
                    data_evento: ev.data_evento ?? "",
                    data_aproximada: ev.data_aproximada,
                    relevancia: ev.relevancia,
                    fonte: ev.fonte,
                  },
                })}
              >
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
                    {!ev.validado && (
                      <Btn variant="green" onClick={() => validar(ev.id)}>Validar</Btn>
                    )}
                    <Btn onClick={() => setModalEvento({
                      id: ev.id,
                      form: {
                        tipo_evento: ev.tipo_evento, descricao: ev.descricao,
                        data_evento: ev.data_evento ?? "", data_aproximada: ev.data_aproximada,
                        relevancia: ev.relevancia, fonte: ev.fonte,
                      },
                    })}>
                      Editar
                    </Btn>
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
  { id: "estado_atual",        label: "Estado Atual" },
  { id: "resumo_executivo",    label: "Resumo Executivo" },
  { id: "riscos",              label: "Riscos" },
  { id: "teses",               label: "Teses Jurídicas" },
  { id: "cronologia",          label: "Cronologia" },
  { id: "impacto_atualizacao", label: "Impacto da Atualização" },
  { id: "proximos_passos",     label: "Próximos Passos" },
  { id: "estrategia",          label: "Estratégia" },
];

function ModalAnalise({ analise, processoId, onUpdate, onClose }: {
  analise: Analise; processoId: string;
  onUpdate: (a: Analise) => void; onClose: () => void;
}) {
  const [loading, setLoading] = useState<"aprovar" | "rejeitar" | null>(null);

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

  const revisaoMap: Record<string, string> = {
    pendente:  "bg-yellow-100 text-yellow-700",
    aprovada:  "bg-green-100 text-green-700",
    rejeitada: "bg-red-100 text-red-700",
    editada:   "bg-blue-100 text-blue-700",
  };

  const label = TIPOS_ANALISE.find(t => t.id === analise.tipo)?.label ?? analise.tipo;

  return (
    <Modal title={label} onClose={onClose} wide>
      <div className="space-y-4">
        {/* Meta */}
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge s={analise.status_revisao} map={revisaoMap} />
          {analise.confianca !== undefined && (
            <span className="text-xs text-muted">confiança {Math.round(analise.confianca * 100)}%</span>
          )}
          <span className="text-xs text-muted">{fmtData(analise.created_at)}</span>
          <span className="text-xs text-muted">{analise.tokens_input}+{analise.tokens_output} tokens</span>
        </div>

        {/* Conteúdo formatado */}
        <div className="bg-bg rounded-xl border border-border p-4 max-h-[50vh] overflow-y-auto">
          <AnaliseConteudo conteudo={analise.conteudo_json} />
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
      </div>
    </Modal>
  );
}

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

function AbaAnalises({ processoId }: { processoId: string }) {
  const [analises, setAnalises] = useState<Analise[]>([]);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState<string | null>(null);
  const [modalAnalise, setModalAnalise] = useState<Analise | null>(null);
  const [docsSelecionados, setDocsSelecionados] = useState<string[]>([]);
  const [mostrarSeletor, setMostrarSeletor] = useState(false);
  const [tipoSelecionado, setTipoSelecionado] = useState<string | null>(null);

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
    try {
      const a = await api.analises.solicitar(
        processoId, tipoSelecionado, undefined,
        docsSelecionados.length < docs.length ? docsSelecionados : undefined
      );
      setAnalises(prev => [a, ...prev]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao gerar análise");
    } finally {
      setGerando(null);
      setTipoSelecionado(null);
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

  return (
    <>
      <div className="space-y-6">
        {/* Painel gerar análise */}
        <div className="bg-gray-50 rounded-xl border border-border p-5">
          <h3 className="text-sm font-bold text-text-main mb-1">Gerar nova análise</h3>
          <p className="text-xs text-muted mb-3">
            Clique no tipo desejado. Você poderá escolher quais documentos usar antes de confirmar.
          </p>
          <div className="flex flex-wrap gap-2">
            {TIPOS_ANALISE.map(t => (
              <button key={t.id} onClick={() => iniciarGeracao(t.id)} disabled={!!gerando}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed
                  ${gerando === t.id ? "border-gold bg-gold/10 text-gold" : "border-border hover:border-gold hover:text-gold hover:bg-gold/5"}`}>
                {gerando === t.id ? <span className="flex items-center gap-1"><Spinner sm /> Gerando…</span> : t.label}
              </button>
            ))}
          </div>
        </div>

        {loading && <div className="flex justify-center py-8"><Spinner /></div>}

        {/* Lista de análises */}
        {analises.map(a => (
          <div key={a.id}
            className="bg-bg rounded-xl border border-border hover:border-gold/40 transition-colors cursor-pointer"
            onClick={() => setModalAnalise(a)}>
            <div className="flex items-start justify-between gap-3 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-text-main">
                    {TIPOS_ANALISE.find(t => t.id === a.tipo)?.label ?? a.tipo}
                  </span>
                  <StatusBadge s={a.status_revisao} map={revisaoMap} />
                  {a.confianca !== undefined && (
                    <span className="text-xs text-muted">confiança {Math.round(a.confianca * 100)}%</span>
                  )}
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {fmtData(a.created_at)} · {a.modelo_ia} · {a.tokens_input}+{a.tokens_output} tokens
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
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal seletor de documentos */}
      {mostrarSeletor && (
        <Modal title={`Gerar: ${TIPOS_ANALISE.find(t => t.id === tipoSelecionado)?.label}`} onClose={() => setMostrarSeletor(false)}>
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
          onUpdate={upd => {
            setAnalises(prev => prev.map(x => x.id === upd.id ? upd : x));
            setModalAnalise(upd);
          }}
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

function AbaRevisao({ processoId }: { processoId: string }) {
  const [tarefas, setTarefas] = useState<TarefaRevisao[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalTarefa, setModalTarefa] = useState<TarefaRevisao | null>(null);

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

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!tarefas.length) return <div className="text-center py-16 text-muted text-sm">Nenhuma tarefa de revisão.</div>;

  return (
    <>
      <div className="space-y-3">
        {tarefas.map(t => (
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
              {t.status === "pendente" && (
                <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <Btn variant="green" onClick={async () => {
                    const upd = await api.revisao.atualizar(t.id, { status: "aprovado" });
                    setTarefas(prev => prev.map(x => x.id === t.id ? upd : x));
                  }}>Aprovar</Btn>
                  <Btn variant="danger" onClick={async () => {
                    const c = prompt("Comentário:") ?? "";
                    const upd = await api.revisao.atualizar(t.id, { status: "rejeitado", comentario: c });
                    setTarefas(prev => prev.map(x => x.id === t.id ? upd : x));
                  }}>Rejeitar</Btn>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {modalTarefa && (
        <ModalTarefa
          tarefa={modalTarefa}
          onUpdate={upd => {
            setTarefas(prev => prev.map(x => x.id === upd.id ? upd : x));
            setModalTarefa(upd);
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
  { id: "resumo_executivo",   label: "Resumo Executivo" },
  { id: "minuta_recurso",     label: "Minuta de Recurso" },
  { id: "minuta_contestacao", label: "Minuta de Contestação" },
  { id: "prompt_juridico",    label: "Prompt Jurídico" },
  { id: "parecer",            label: "Parecer" },
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
              <label className="block text-xs font-semibold text-muted mb-1">Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40">
                {TIPOS_MINUTA.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
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

        {minutas.map(m => (
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

function AbaChat({ processoId }: { processoId: string }) {
  const [mensagens, setMensagens] = useState<{ role: "user" | "assistant"; content: string; fontes?: {tipo_peca?: string; pagina?: number}[] }[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || enviando) return;
    const texto = input.trim();
    setInput("");
    setMensagens(prev => [...prev, { role: "user", content: texto }]);
    setEnviando(true);
    try {
      const hist = mensagens.map(m => ({ role: m.role, content: m.content }));
      hist.push({ role: "user", content: texto });
      const r = await api.analises.chat(processoId, hist);
      setMensagens(prev => [...prev, { role: "assistant", content: r.resposta, fontes: r.fontes as {tipo_peca?: string; pagina?: number}[] }]);
    } catch (err) {
      setMensagens(prev => [...prev, { role: "assistant", content: `Erro: ${err instanceof Error ? err.message : "falha na API"}` }]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col h-[560px]">
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {!mensagens.length && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted">
            <div className="w-14 h-14 rounded-2xl bg-gold/10 flex items-center justify-center mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gold">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-text-main mb-1">Chat com o Processo</p>
            <p className="text-xs max-w-xs">Faça perguntas sobre os documentos. A IA responde com base nos textos indexados.</p>
          </div>
        )}
        {mensagens.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${m.role === "user" ? "bg-navy text-white" : "bg-surface border border-border text-text-main"}`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.fontes && m.fontes.length > 0 && (
                <p className="text-xs opacity-60 mt-2">Fontes: {m.fontes.slice(0,3).map(f => `${f.tipo_peca ?? "?"} p.${f.pagina ?? "?"}`).join(", ")}</p>
              )}
            </div>
          </div>
        ))}
        {enviando && (
          <div className="flex justify-start">
            <div className="bg-surface border border-border rounded-xl px-4 py-3"><Spinner /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={enviar} className="flex gap-2 pt-3 border-t border-border">
        <input value={input} onChange={e => setInput(e.target.value)}
          className="flex-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-bg text-text-main placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-gold/40"
          placeholder="Pergunta sobre o processo…" />
        <button type="submit" disabled={enviando || !input.trim()}
          className="bg-gold text-navy font-bold rounded-lg px-4 py-2.5 text-sm hover:bg-gold-light transition-all disabled:opacity-50">
          →
        </button>
      </form>
    </div>
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

  if (loading) return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 ml-60 flex items-center justify-center"><Spinner /></div>
    </div>
  );
  if (!processo) return null;

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 ml-60 flex flex-col">
        <TopBar
          title={processo.numero_cnj ?? processo.id.slice(0, 8) + "…"}
          subtitle={[processo.tribunal, processo.vara, processo.assunto].filter(Boolean).join(" · ") || "Processo Jurídico"}
        />
        <main className="flex-1 p-8">
          {/* Métricas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Documentos",        v: processo.total_documentos,  accent: false },
              { label: "Peças",             v: processo.total_pecas,       accent: false },
              { label: "Chunks indexados",  v: processo.total_chunks,      accent: false },
              { label: "Tarefas pendentes", v: processo.tarefas_pendentes, accent: processo.tarefas_pendentes > 0 },
            ].map(m => (
              <div key={m.label} className={`bg-surface rounded-xl border p-4 ${m.accent ? "border-yellow-300" : "border-border"}`}>
                <p className="text-xs text-muted mb-1">{m.label}</p>
                <p className={`text-2xl font-bold ${m.accent ? "text-yellow-600" : "text-text-main"}`}>{m.v}</p>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all border-b-2 -mb-px ${tab === t.id ? "border-gold text-gold" : "border-transparent text-muted hover:text-text-main"}`}>
                {t.label}
                {t.id === "revisao" && processo.tarefas_pendentes > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-white text-xs font-bold">
                    {processo.tarefas_pendentes}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Conteúdo */}
          {tab === "documentos" && <AbaDocumentos processoId={id} />}
          {tab === "cronologia" && <AbaCronologia processoId={id} />}
          {tab === "analises"   && <AbaAnalises   processoId={id} />}
          {tab === "revisao"    && <AbaRevisao    processoId={id} />}
          {tab === "minutas"    && <AbaMinutas    processoId={id} />}
          {tab === "snapshots"  && <AbaSnapshots  processoId={id} />}
          {tab === "chat"       && <AbaChat       processoId={id} />}
        </main>
      </div>
    </div>
  );
}
