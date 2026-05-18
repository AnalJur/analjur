"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import {
  api, type Processo, type Documento, type EventoCronologia,
  type Analise, type TarefaRevisao, type Minuta, type Snapshot,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtData(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("pt-BR");
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

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-gold" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
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

// ── Aba: Documentos ───────────────────────────────────────────────────────

function formatBytes(b?: number) {
  if (!b) return "";
  if (b < 1024 * 1024) return ` · ${(b / 1024).toFixed(0)} KB`;
  return ` · ${(b / 1024 / 1024).toFixed(1)} MB`;
}

function AbaDocumentos({ processoId }: { processoId: string }) {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletando, setDeletando] = useState<string | null>(null);
  const [expandidoPecas, setExpandidoPecas] = useState<string | null>(null);
  const [pecas, setPecas] = useState<Record<string, import("@/lib/api").Peca[]>>({});

  const carregar = () => {
    api.documentos.listar(processoId).then(setDocs).finally(() => setLoading(false));
  };

  useEffect(() => { carregar(); }, [processoId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelete(docId: string, nome: string) {
    if (!confirm(`Excluir "${nome}"? Todas as peças associadas serão removidas.`)) return;
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

  async function verPecas(docId: string) {
    if (expandidoPecas === docId) { setExpandidoPecas(null); return; }
    setExpandidoPecas(docId);
    if (!pecas[docId]) {
      const lista = await api.documentos.pecas(processoId, docId).catch(() => []);
      setPecas(prev => ({ ...prev, [docId]: lista }));
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
    <div className="space-y-3">
      {/* Botão de upload */}
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
        <div key={d.id} className="bg-bg rounded-xl border border-border overflow-hidden">
          <div className="p-4 flex items-start justify-between gap-4">
            {/* Ícone + info */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
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
                {d.erro_msg && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    ⚠ {d.erro_msg}
                  </p>
                )}
              </div>
            </div>

            {/* Ações */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <StatusBadge s={d.status} map={docStatusMap} />

              {d.status === "processado" && (
                <button onClick={() => verPecas(d.id)}
                  className="text-xs font-semibold text-gold hover:text-gold-light px-3 py-1.5 rounded-lg hover:bg-gold/10 transition-all ml-2">
                  {expandidoPecas === d.id ? "Fechar" : "Ver peças"}
                </button>
              )}

              {d.status === "erro" && (
                <a href={`/upload?processo=${processoId}`}
                  className="text-xs font-semibold text-orange-600 hover:text-orange-500 px-3 py-1.5 rounded-lg hover:bg-orange-50 transition-all ml-2">
                  Re-enviar
                </a>
              )}

              <button
                onClick={() => handleDelete(d.id, d.nome_original)}
                disabled={deletando === d.id}
                className="text-xs font-semibold text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-all disabled:opacity-50 ml-1">
                {deletando === d.id ? "…" : "Excluir"}
              </button>
            </div>
          </div>

          {/* Peças expandidas */}
          {expandidoPecas === d.id && (
            <div className="border-t border-border bg-surface px-4 py-3">
              {!pecas[d.id] ? (
                <div className="flex justify-center py-3"><Spinner /></div>
              ) : pecas[d.id].length === 0 ? (
                <p className="text-xs text-muted text-center py-2">Nenhuma peça indexada.</p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
                    {pecas[d.id].length} peça{pecas[d.id].length !== 1 ? "s" : ""} indexada{pecas[d.id].length !== 1 ? "s" : ""}
                  </p>
                  {pecas[d.id].map(p => (
                    <div key={p.id} className="flex items-center justify-between text-xs text-muted py-1 border-b border-border/50 last:border-0">
                      <span className="font-medium text-text-main">{p.tipo_peca.replace(/_/g, " ")}</span>
                      <span>pág. {p.pagina_inicio}–{p.pagina_fim}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Aba: Cronologia ───────────────────────────────────────────────────────

function AbaCronologia({ processoId }: { processoId: string }) {
  const [eventos, setEventos] = useState<EventoCronologia[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.cronologia.listar(processoId).then(setEventos).finally(() => setLoading(false));
  }, [processoId]);

  async function validar(id: string) {
    const ev = await api.cronologia.validar(processoId, id);
    setEventos(prev => prev.map(e => e.id === id ? ev : e));
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!eventos.length) return (
    <div className="text-center py-16 text-muted text-sm">
      Nenhum evento. Gere uma análise de cronologia primeiro.
    </div>
  );

  return (
    <div className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
      <div className="space-y-4 pl-10">
        {eventos.map(ev => (
          <div key={ev.id} className="relative">
            <div className={`absolute -left-6 top-3 w-3 h-3 rounded-full border-2 border-surface
              ${ev.relevancia === "critica" ? "bg-red-500" : ev.relevancia === "alta" ? "bg-orange-400" : ev.relevancia === "media" ? "bg-gold" : "bg-green-400"}`} />
            <div className="bg-bg rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-muted">
                      {ev.data_evento ? fmtData(ev.data_evento) : "Data?"}
                      {ev.data_aproximada && " ~"}
                    </span>
                    <RelevBadge r={ev.relevancia} />
                    {!ev.validado && <span className="text-xs text-muted italic">(não validado)</span>}
                  </div>
                  <p className="text-sm font-semibold text-text-main">{ev.tipo_evento.replace(/_/g, " ")}</p>
                  <p className="text-sm text-muted mt-1">{ev.descricao}</p>
                </div>
                {!ev.validado && (
                  <button onClick={() => validar(ev.id)}
                    className="text-xs font-semibold text-gold hover:text-gold-light px-3 py-1 rounded-lg hover:bg-gold/10 transition-all whitespace-nowrap">
                    Validar
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Aba: Análises IA ──────────────────────────────────────────────────────

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

function AbaAnalises({ processoId }: { processoId: string }) {
  const [analises, setAnalises] = useState<Analise[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  useEffect(() => {
    api.analises.listar(processoId).then(setAnalises).finally(() => setLoading(false));
  }, [processoId]);

  async function gerar(tipo: string) {
    setGerando(tipo);
    try {
      const a = await api.analises.solicitar(processoId, tipo);
      setAnalises(prev => [a, ...prev]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao gerar análise");
    } finally {
      setGerando(null);
    }
  }

  async function aprovar(id: string) {
    const a = await api.analises.aprovar(processoId, id);
    setAnalises(prev => prev.map(x => x.id === id ? a : x));
  }

  async function rejeitar(id: string) {
    const comentario = prompt("Motivo da rejeição:");
    if (comentario === null) return;
    const a = await api.analises.rejeitar(processoId, id, comentario);
    setAnalises(prev => prev.map(x => x.id === id ? a : x));
  }

  const revisaoMap: Record<string, string> = {
    pendente:  "bg-yellow-100 text-yellow-700",
    aprovada:  "bg-green-100 text-green-700",
    rejeitada: "bg-red-100 text-red-700",
    editada:   "bg-blue-100 text-blue-700",
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-50 rounded-xl border border-border p-5">
        <h3 className="text-sm font-bold text-text-main mb-3">Gerar nova análise</h3>
        <div className="flex flex-wrap gap-2">
          {TIPOS_ANALISE.map(t => (
            <button key={t.id} onClick={() => gerar(t.id)} disabled={!!gerando}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:border-gold hover:text-gold hover:bg-gold/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {gerando === t.id ? "Gerando…" : t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted mt-3">
          Toda análise gerada fica com status &quot;pendente&quot; até revisão humana.
        </p>
      </div>

      {loading && <div className="flex justify-center py-8"><Spinner /></div>}

      {analises.map(a => (
        <div key={a.id} className="bg-bg rounded-xl border border-border">
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
            <div className="flex items-center gap-2">
              {a.status_revisao === "pendente" && (
                <>
                  <button onClick={() => aprovar(a.id)}
                    className="text-xs font-semibold text-green-600 px-3 py-1 rounded-lg hover:bg-green-50 transition-all">
                    Aprovar
                  </button>
                  <button onClick={() => rejeitar(a.id)}
                    className="text-xs font-semibold text-red-600 px-3 py-1 rounded-lg hover:bg-red-50 transition-all">
                    Rejeitar
                  </button>
                </>
              )}
              <button onClick={() => setExpandido(expandido === a.id ? null : a.id)}
                className="text-xs font-semibold text-muted px-3 py-1 rounded-lg hover:bg-bg transition-all">
                {expandido === a.id ? "Fechar" : "Ver"}
              </button>
            </div>
          </div>
          {expandido === a.id && (
            <div className="px-4 pb-4">
              <pre className="bg-surface rounded-lg p-4 text-xs text-muted overflow-auto max-h-80 font-mono whitespace-pre-wrap">
                {JSON.stringify(a.conteudo_json, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Aba: Revisão ──────────────────────────────────────────────────────────

function AbaRevisao({ processoId }: { processoId: string }) {
  const [tarefas, setTarefas] = useState<TarefaRevisao[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.revisao.tarefas(undefined, processoId).then(setTarefas).finally(() => setLoading(false));
  }, [processoId]);

  async function atualizar(id: string, status: string) {
    const comentario = status === "rejeitado" ? (prompt("Comentário:") ?? "") : undefined;
    const t = await api.revisao.atualizar(id, { status, comentario });
    setTarefas(prev => prev.map(x => x.id === id ? t : x));
  }

  const statusMap: Record<string, string> = {
    pendente:   "bg-yellow-100 text-yellow-700",
    em_revisao: "bg-yellow-50 text-yellow-600",
    aprovado:   "bg-green-100 text-green-700",
    rejeitado:  "bg-red-100 text-red-700",
    cancelado:  "bg-gray-100 text-gray-500",
  };

  const priorCls: Record<string, string> = {
    urgente: "text-red-600",
    alta:    "text-orange-500",
    normal:  "text-muted",
    baixa:   "text-green-600",
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!tarefas.length) return <div className="text-center py-16 text-muted text-sm">Nenhuma tarefa de revisão.</div>;

  return (
    <div className="space-y-3">
      {tarefas.map(t => (
        <div key={t.id} className="bg-bg rounded-xl border border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold uppercase ${priorCls[t.prioridade]}`}>{t.prioridade}</span>
                <StatusBadge s={t.status} map={statusMap} />
              </div>
              <p className="text-sm font-semibold text-text-main">{t.titulo}</p>
              {t.descricao && <p className="text-xs text-muted mt-1">{t.descricao}</p>}
              {t.deadline && <p className="text-xs text-orange-500 mt-1">Prazo: {fmtData(t.deadline)}</p>}
            </div>
            {t.status === "pendente" && (
              <div className="flex gap-2">
                <button onClick={() => atualizar(t.id, "aprovado")}
                  className="text-xs font-semibold text-green-600 px-3 py-1 rounded-lg hover:bg-green-50 transition-all">
                  Aprovar
                </button>
                <button onClick={() => atualizar(t.id, "rejeitado")}
                  className="text-xs font-semibold text-red-600 px-3 py-1 rounded-lg hover:bg-red-50 transition-all">
                  Rejeitar
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Aba: Minutas ──────────────────────────────────────────────────────────

const TIPOS_MINUTA = [
  { id: "resumo_executivo",   label: "Resumo Executivo" },
  { id: "minuta_recurso",     label: "Minuta de Recurso" },
  { id: "minuta_contestacao", label: "Minuta de Contestação" },
  { id: "prompt_juridico",    label: "Prompt Jurídico" },
  { id: "parecer",            label: "Parecer" },
];

function AbaMinutas({ processoId }: { processoId: string }) {
  const [minutas, setMinutas] = useState<Minuta[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);
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

  async function aprovar(minutaId: string) {
    const m = await api.minutas.editar(processoId, minutaId, { status: "aprovado" });
    setMinutas(prev => prev.map(x => x.id === minutaId ? m : x));
  }

  const statusMap: Record<string, string> = {
    rascunho:   "bg-yellow-100 text-yellow-700",
    em_revisao: "bg-blue-100 text-blue-700",
    aprovado:   "bg-green-100 text-green-700",
    publicado:  "bg-purple-100 text-purple-700",
  };

  return (
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
        <div key={m.id} className="bg-bg rounded-xl border border-border">
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
            <div className="flex gap-2">
              {m.status !== "aprovado" && (
                <button onClick={() => aprovar(m.id)}
                  className="text-xs font-semibold text-green-600 px-3 py-1 rounded-lg hover:bg-green-50 transition-all">
                  Aprovar
                </button>
              )}
              <button onClick={() => setExpandido(expandido === m.id ? null : m.id)}
                className="text-xs font-semibold text-muted px-3 py-1 rounded-lg hover:bg-gray-50 transition-all">
                {expandido === m.id ? "Fechar" : "Ler"}
              </button>
            </div>
          </div>
          {expandido === m.id && (
            <div className="px-4 pb-4">
              <div className="bg-surface rounded-lg p-4 text-sm text-text-main leading-relaxed whitespace-pre-wrap max-h-96 overflow-auto">
                {m.conteudo_md}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Aba: Snapshots ────────────────────────────────────────────────────────

function AbaSnapshots({ processoId }: { processoId: string }) {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  useEffect(() => {
    api.snapshots.listar(processoId).then(setSnaps).finally(() => setLoading(false));
  }, [processoId]);

  async function criar() {
    setCriando(true);
    try {
      const s = await api.snapshots.criar(processoId);
      setSnaps(prev => [s, ...prev]);
    } finally {
      setCriando(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
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
        <div key={s.id} className="bg-bg rounded-xl border border-border">
          <div className="flex items-center justify-between p-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text-main">v{s.versao}</span>
                <span className="text-xs text-muted bg-bg border border-border px-2 py-0.5 rounded-full">{s.trigger}</span>
              </div>
              {s.resumo_mudancas && <p className="text-xs text-muted mt-1">{s.resumo_mudancas}</p>}
              <p className="text-xs text-muted mt-0.5">{fmtData(s.created_at)}</p>
            </div>
            <button onClick={() => setExpandido(expandido === s.id ? null : s.id)}
              className="text-xs font-semibold text-muted px-3 py-1 rounded-lg hover:bg-gray-50 transition-all">
              {expandido === s.id ? "Fechar" : "Ver estado"}
            </button>
          </div>
          {expandido === s.id && (
            <div className="px-4 pb-4">
              <pre className="bg-surface rounded-lg p-4 text-xs text-muted overflow-auto max-h-64 font-mono whitespace-pre-wrap">
                {JSON.stringify(s.estado_json, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Aba: Chat ─────────────────────────────────────────────────────────────

function AbaChat({ processoId }: { processoId: string }) {
  const [mensagens, setMensagens] = useState<{ role: "user" | "assistant"; content: string; fontes?: {tipo_peca?: string; pagina?: number}[] }[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);

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
      setMensagens(prev => [...prev, {
        role: "assistant",
        content: r.resposta,
        fontes: r.fontes as {tipo_peca?: string; pagina?: number}[],
      }]);
    } catch (err) {
      setMensagens(prev => [...prev, {
        role: "assistant",
        content: `Erro: ${err instanceof Error ? err.message : "falha na API"}`,
      }]);
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
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-text-main mb-1">Chat com o Processo</p>
            <p className="text-xs max-w-xs">
              Faça perguntas sobre os documentos. A IA responde com base nos textos indexados.
            </p>
          </div>
        )}
        {mensagens.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${m.role === "user" ? "bg-navy text-white" : "bg-surface border border-border text-text-main"}`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.fontes && m.fontes.length > 0 && (
                <p className="text-xs opacity-60 mt-2">
                  Fontes: {m.fontes.slice(0, 3).map(f => `${f.tipo_peca ?? "?"} p.${f.pagina ?? "?"}`).join(", ")}
                </p>
              )}
            </div>
          </div>
        ))}
        {enviando && (
          <div className="flex justify-start">
            <div className="bg-surface border border-border rounded-xl px-4 py-3">
              <Spinner />
            </div>
          </div>
        )}
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

// ── Página principal ──────────────────────────────────────────────────────

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
              { label: "Documentos",       v: processo.total_documentos,  accent: false },
              { label: "Peças",            v: processo.total_pecas,       accent: false },
              { label: "Chunks indexados", v: processo.total_chunks,      accent: false },
              { label: "Tarefas pendentes",v: processo.tarefas_pendentes, accent: processo.tarefas_pendentes > 0 },
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
