"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import StatCard from "@/components/StatCard";
import { api, type Processo, type DashboardAdmin, type DashboardAlertas, type DashboardAlerta, type SyncDataJudResult, type Prazo, type TarefaRevisao, type Cliente } from "@/lib/api";

// ── Ícones ────────────────────────────────────────────────────────────────

function Icon({ d, size = 20, className = "" }: { d: string; size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d={d} />
    </svg>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ativo: "bg-success/15 text-success",
    arquivado: "bg-muted/20 text-muted",
    suspenso: "bg-warning/15 text-warning",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[status] ?? "bg-bg text-muted"}`}>
      {status}
    </span>
  );
}

function PrioridadeDot({ n }: { n: number }) {
  const cor = n === 0 ? "bg-green-400" : n <= 2 ? "bg-yellow-400" : "bg-red-400";
  return <span className={`inline-block w-2 h-2 rounded-full ${cor}`} />;
}

// ── Toast ─────────────────────────────────────────────────────────────────

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg text-sm font-medium ${type === "error" ? "bg-danger text-white" : "bg-success text-white"}`}>
      {message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">✕</button>
    </div>
  );
}

// ── Modal: criar processo ─────────────────────────────────────────────────

function ModalNovoProcesso({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (p: Processo) => void;
}) {
  const [form, setForm] = useState({ numero_cnj: "", tribunal: "", vara: "", assunto: "", cliente_id: "" });
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    api.clientes.listar().then(setClientes).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const body: Record<string, string> = {};
      if (form.numero_cnj) body.numero_cnj = form.numero_cnj;
      if (form.tribunal)   body.tribunal   = form.tribunal;
      if (form.vara)       body.vara       = form.vara;
      if (form.assunto)    body.assunto    = form.assunto;
      if (form.cliente_id) body.cliente_id = form.cliente_id;
      const p = await api.processos.criar(body);
      onCreate(p);
    } catch {
      alert("Erro ao criar processo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-lg font-bold text-text-main mb-5">Novo Processo</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Número CNJ</label>
            <input className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
              placeholder="0000000-00.0000.0.00.0000"
              value={form.numero_cnj}
              onChange={e => setForm(f => ({ ...f, numero_cnj: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Tribunal</label>
              <input className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
                placeholder="TJSP, TRF3..."
                value={form.tribunal}
                onChange={e => setForm(f => ({ ...f, tribunal: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Vara</label>
              <input className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
                placeholder="1ª Vara Cível..."
                value={form.vara}
                onChange={e => setForm(f => ({ ...f, vara: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Assunto</label>
            <input className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
              placeholder="Indenização por danos morais..."
              value={form.assunto}
              onChange={e => setForm(f => ({ ...f, assunto: e.target.value }))} />
          </div>
          {clientes.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Cliente (opcional)</label>
              <select
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
                value={form.cliente_id}
                onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}>
                <option value="">— Sem cliente —</option>
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-border rounded-lg py-2 text-sm font-semibold text-muted hover:bg-bg transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-gold text-navy rounded-lg py-2 text-sm font-bold hover:bg-gold-light transition-colors disabled:opacity-50">
              {loading ? "Criando..." : "Criar Processo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Alerta: card individual ───────────────────────────────────────────────

function AlertaCard({ item, nivel }: { item: DashboardAlerta; nivel: "critico" | "urgente" | "atencao" | "monitorar" }) {
  const router = useRouter();

  const corBorda = {
    critico:  "border-l-red-500",
    urgente:  "border-l-orange-400",
    atencao:  "border-l-yellow-400",
    monitorar:"border-l-blue-400",
  }[nivel];

  const corDias = {
    critico:  "text-red-500",
    urgente:  "text-orange-500",
    atencao:  "text-yellow-600",
    monitorar:"text-blue-500",
  }[nivel];

  const labelDias =
    item.dias_corridos < 0
      ? `${Math.abs(item.dias_corridos)}d vencido`
      : item.dias_corridos === 0
      ? "Vence HOJE"
      : item.dias_uteis === 1
      ? "1 dia útil"
      : `${item.dias_uteis} dias úteis`;

  const dataFmt = new Date(item.vencimento + "T12:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short",
  });

  return (
    <div
      className={`bg-surface border border-border border-l-4 ${corBorda} rounded-xl px-4 py-3 hover:shadow-md transition-all cursor-pointer`}
      onClick={() => router.push(`/processo/${item.processo_id}`)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-main truncate">{item.titulo}</p>
          <p className="text-xs text-muted mt-0.5 truncate">
            {item.numero_cnj ?? item.processo_id.slice(0, 8) + "…"}
            {item.assunto && <> · {item.assunto}</>}
          </p>
          {item.tribunal && (
            <p className="text-xs text-muted/70 mt-0.5 truncate">{item.tribunal}{item.vara && ` · ${item.vara}`}</p>
          )}
          {item.responsavel && (
            <p className="text-xs text-muted mt-1">👤 {item.responsavel}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-bold ${corDias}`}>{labelDias}</p>
          <p className="text-xs text-muted mt-0.5">{dataFmt}</p>
          {item.prioridade === "urgente" || item.prioridade === "critico" ? (
            <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 text-red-600">
              {item.prioridade}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Painel de alertas por nível ───────────────────────────────────────────

type NivelAlerta = "critico" | "urgente" | "atencao" | "monitorar";

interface PainelConfig {
  nivel: NivelAlerta;
  label: string;
  emoji: string;
  corFundo: string;
  corTexto: string;
  corCount: string;
}

const PAINEIS: PainelConfig[] = [
  { nivel: "critico",  label: "CRÍTICO",  emoji: "🔴", corFundo: "bg-red-50 border-red-200",    corTexto: "text-red-700",    corCount: "bg-red-500 text-white" },
  { nivel: "urgente",  label: "URGENTE",  emoji: "🟠", corFundo: "bg-orange-50 border-orange-200", corTexto: "text-orange-700", corCount: "bg-orange-500 text-white" },
  { nivel: "atencao",  label: "ATENÇÃO",  emoji: "🟡", corFundo: "bg-yellow-50 border-yellow-200", corTexto: "text-yellow-700", corCount: "bg-yellow-500 text-white" },
  { nivel: "monitorar","label": "MONITORAR","emoji":"🟢", corFundo: "bg-blue-50 border-blue-200",   corTexto: "text-blue-700",   corCount: "bg-blue-500 text-white" },
];

function PainelAlertas({
  config,
  items,
  loading,
  expanded,
  onToggle,
}: {
  config: PainelConfig;
  items: DashboardAlerta[];
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { nivel, label, emoji, corFundo, corTexto, corCount } = config;
  const count = items.length;

  if (!loading && count === 0) return null;

  return (
    <div className={`rounded-xl border ${corFundo} overflow-hidden`}>
      {/* Header clicável */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/5 transition-colors"
        onClick={onToggle}>
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{emoji}</span>
          <span className={`text-sm font-bold ${corTexto}`}>{label}</span>
          {nivel === "critico" && count > 0 && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-xs text-muted">carregando…</span>
          ) : (
            <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${corCount}`}>
              {count} {count === 1 ? "prazo" : "prazos"}
            </span>
          )}
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            className={`text-muted transition-transform ${expanded ? "rotate-180" : ""}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Items */}
      {expanded && !loading && (
        <div className="px-4 pb-4 space-y-2">
          {items.map(item => (
            <AlertaCard key={item.id} item={item} nivel={nivel} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drawer lateral do processo ────────────────────────────────────────────

const TIPO_ATENDIMENTO_ICONS: Record<string, string> = {
  presencial: "🤝", videoconferencia: "📹", telefone: "📞", email: "✉️",
};

function diasParaVencer(vencimento: string): number {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const v = new Date(vencimento + "T00:00:00");
  return Math.floor((v.getTime() - hoje.getTime()) / 86_400_000);
}

function ProcessoDrawer({
  processo,
  onClose,
}: {
  processo: Processo;
  onClose: () => void;
}) {
  const router = useRouter();
  const [prazos, setPrazos]   = useState<Prazo[]>([]);
  const [tarefas, setTarefas] = useState<TarefaRevisao[]>([]);
  const [loading, setLoading] = useState(true);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.prazos.listar(processo.id, "em_aberto"),
      api.revisao.tarefas(undefined, processo.id),
    ]).then(([p, t]) => {
      setPrazos(p);
      setTarefas(t.filter(t => t.status === "pendente"));
    }).finally(() => setLoading(false));
  }, [processo.id]);

  // Cards de providências por urgência
  const prazosUrgentes  = prazos.filter(p => diasParaVencer(p.vencimento) <= 5);
  const prazosAtencao   = prazos.filter(p => { const d = diasParaVencer(p.vencimento); return d > 5 && d <= 15; });
  const prazosNormais   = prazos.filter(p => diasParaVencer(p.vencimento) > 15);

  const statusCor: Record<string, string> = {
    ativo:     "bg-green-100 text-green-700",
    arquivado: "bg-gray-100 text-gray-500",
    suspenso:  "bg-yellow-100 text-yellow-700",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Painel */}
      <div
        ref={drawerRef}
        className="fixed top-0 right-0 h-full w-full max-w-[520px] bg-surface shadow-2xl z-50 flex flex-col"
        style={{ animation: "slideInRight 220ms cubic-bezier(.16,1,.3,1)" }}
      >
        {/* Header */}
        <div className="bg-navy px-5 py-4 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gold/70 font-semibold uppercase tracking-wider mb-1">Processo</p>
              <p className="text-white font-bold font-mono text-sm leading-tight break-all">
                {processo.numero_cnj ?? processo.id.slice(0,8) + "…"}
              </p>
              {(processo.tribunal || processo.vara) && (
                <p className="text-white/60 text-xs mt-1">
                  {[processo.tribunal, processo.vara].filter(Boolean).join(" · ")}
                </p>
              )}
              {processo.assunto && (
                <p className="text-white/80 text-xs mt-1.5 line-clamp-2">{processo.assunto}</p>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusCor[processo.status] ?? "bg-gray-100 text-gray-500"}`}>
                  {processo.status}
                </span>
                {processo.responsavel && (
                  <span className="text-xs text-white/50">👤 {processo.responsavel}</span>
                )}
                {processo.tags?.map(t => (
                  <span key={t} className="text-xs bg-gold/20 text-gold px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            </div>
            <button onClick={onClose}
              className="text-white/50 hover:text-white transition-colors p-1 flex-shrink-0 mt-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Stats rápidos */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[
              { label: "Docs",    val: processo.total_documentos },
              { label: "Peças",   val: processo.total_pecas },
              { label: "Prazos",  val: prazos.length },
              { label: "Tarefas", val: tarefas.length },
            ].map(s => (
              <div key={s.label} className="bg-white/10 rounded-xl p-2.5 text-center">
                <p className="text-lg font-bold text-white">{s.val}</p>
                <p className="text-xs text-white/50">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Corpo scrollável */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {loading ? (
            <div className="flex flex-col gap-3">
              {[1,2,3].map(i => (
                <div key={i} className="h-16 bg-bg rounded-xl animate-pulse border border-border" />
              ))}
            </div>
          ) : (
            <>
              {/* ── Urgente (≤ 5 dias) ── */}
              {prazosUrgentes.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                    </span>
                    Urgente
                  </p>
                  <div className="space-y-2">
                    {prazosUrgentes.map(p => {
                      const dias = diasParaVencer(p.vencimento);
                      return (
                        <div key={p.id}
                          className="bg-red-50 border border-red-200 rounded-xl p-3 border-l-4 border-l-red-500">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold text-red-900 leading-tight">{p.titulo}</p>
                            <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full flex-shrink-0">
                              {dias < 0 ? `${Math.abs(dias)}d atraso` : dias === 0 ? "HOJE" : `${dias}d`}
                            </span>
                          </div>
                          {p.fundamento_legal && (
                            <p className="text-xs text-red-600/70 mt-1 italic">{p.fundamento_legal}</p>
                          )}
                          <p className="text-xs text-red-700/60 mt-1">
                            Vence: {new Date(p.vencimento + "T00:00:00").toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Tarefas pendentes ── */}
              {tarefas.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-2">
                    📋 Tarefas Pendentes ({tarefas.length})
                  </p>
                  <div className="space-y-2">
                    {tarefas.slice(0, 5).map(t => (
                      <div key={t.id}
                        className="bg-orange-50 border border-orange-200 rounded-xl p-3 border-l-4 border-l-orange-400">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-orange-900 leading-tight">{t.titulo}</p>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                            t.prioridade === "urgente" ? "bg-red-100 text-red-700"
                            : t.prioridade === "alta"   ? "bg-orange-100 text-orange-700"
                            : "bg-gray-100 text-gray-600"
                          }`}>
                            {t.prioridade}
                          </span>
                        </div>
                        {t.descricao && (
                          <p className="text-xs text-orange-700/70 mt-1 line-clamp-2">{t.descricao}</p>
                        )}
                        {t.deadline && (
                          <p className="text-xs text-orange-600 mt-1">
                            ⏰ {new Date(t.deadline).toLocaleDateString("pt-BR")}
                          </p>
                        )}
                      </div>
                    ))}
                    {tarefas.length > 5 && (
                      <p className="text-xs text-muted text-center">+ {tarefas.length - 5} outras tarefas</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Atenção (6–15 dias) ── */}
              {prazosAtencao.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2">
                    ⚠️ Atenção — próximos 15 dias
                  </p>
                  <div className="space-y-2">
                    {prazosAtencao.map(p => (
                      <div key={p.id}
                        className="bg-amber-50 border border-amber-200 rounded-xl p-3 border-l-4 border-l-amber-400">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-amber-900 leading-tight">{p.titulo}</p>
                          <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full flex-shrink-0">
                            {diasParaVencer(p.vencimento)}d
                          </span>
                        </div>
                        <p className="text-xs text-amber-700/60 mt-1">
                          {new Date(p.vencimento + "T00:00:00").toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Prazos monitorar ── */}
              {prazosNormais.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-2">
                    🟢 Monitorar
                  </p>
                  <div className="space-y-1.5">
                    {prazosNormais.map(p => (
                      <div key={p.id}
                        className="flex items-center justify-between gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                        <p className="text-xs text-blue-900 font-medium truncate">{p.titulo}</p>
                        <span className="text-xs text-blue-600 font-semibold flex-shrink-0">
                          {new Date(p.vencimento + "T00:00:00").toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {prazos.length === 0 && tarefas.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center">
                    <span className="text-2xl">✅</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-main">Processo em dia</p>
                    <p className="text-xs text-muted mt-0.5">Nenhum prazo ou tarefa pendente</p>
                  </div>
                </div>
              )}

              {/* Datas */}
              <div className="border-t border-border pt-3 grid grid-cols-2 gap-2">
                {processo.ultimo_upload && (
                  <div>
                    <p className="text-xs text-muted">Último upload</p>
                    <p className="text-xs font-semibold text-text-main">
                      {new Date(processo.ultimo_upload).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted">Atualizado em</p>
                  <p className="text-xs font-semibold text-text-main">
                    {new Date(processo.updated_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Rodapé com ações */}
        <div className="border-t border-border px-5 py-4 flex-shrink-0 bg-bg space-y-2">
          <button
            onClick={() => router.push(`/processo/${processo.id}`)}
            className="w-full bg-gold text-navy font-bold rounded-xl py-3 text-sm hover:bg-gold-light transition-all flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Abrir processo completo
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => router.push(`/upload?processo=${processo.id}`)}
              className="text-xs font-semibold text-muted hover:text-text-main border border-border hover:border-gold/40 rounded-xl py-2.5 transition-all">
              + Adicionar documento
            </button>
            <button
              onClick={() => router.push(`/processo/${processo.id}?tab=atendimentos`)}
              className="text-xs font-semibold text-muted hover:text-text-main border border-border hover:border-gold/40 rounded-xl py-2.5 transition-all">
              📋 Ver atendimentos
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

// ── Página principal ──────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [admin, setAdmin] = useState<DashboardAdmin | null>(null);
  const [alertas, setAlertas] = useState<DashboardAlertas | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingAlertas, setLoadingAlertas] = useState(true);
  const [busca, setBusca] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [deletando, setDeletando] = useState<string | null>(null);
  const [modalNovo, setModalNovo] = useState(false);
  const [expandidos, setExpandidos] = useState<Record<NivelAlerta, boolean>>({
    critico: true,
    urgente: true,
    atencao: false,
    monitorar: false,
  });
  const [syncLote, setSyncLote] = useState<{ loading: boolean; result: { total: number; ok: number; erros: number; nao_encontrados: number; novos_eventos: number } | null; erro: string | null }>({
    loading: false, result: null, erro: null,
  });
  const [processoAberto, setProcessoAberto] = useState<Processo | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
  }, []);

  const carregar = useCallback(async () => {
    try {
      const [procs, dash] = await Promise.all([
        api.processos.listar(),
        api.admin.dashboard(),
      ]);
      setProcessos(procs);
      setAdmin(dash);
    } catch {
      showToast("Não foi possível carregar os dados.", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const carregarAlertas = useCallback(async () => {
    setLoadingAlertas(true);
    try {
      const a = await api.admin.alertas();
      setAlertas(a);
      // Auto-expande críticos e urgentes se tiver itens
      if (a.criticos.count > 0 || a.urgentes.count > 0) {
        setExpandidos(prev => ({ ...prev, critico: a.criticos.count > 0, urgente: a.urgentes.count > 0 }));
      }
    } catch {
      // silencia — alertas são opcionais
    } finally {
      setLoadingAlertas(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    carregarAlertas();
  }, [carregar, carregarAlertas]);

  const processosFiltrados = processos.filter((p) => {
    const termo = busca.toLowerCase();
    return (
      p.numero_cnj?.toLowerCase().includes(termo) ||
      p.assunto?.toLowerCase().includes(termo) ||
      p.tribunal?.toLowerCase().includes(termo) ||
      p.id.toLowerCase().includes(termo)
    );
  });

  async function handleDeletar(id: string, assunto?: string) {
    if (!confirm(`Excluir o processo "${assunto ?? id}"? Esta ação não pode ser desfeita.`)) return;
    setDeletando(id);
    try {
      await api.processos.deletar(id);
      setProcessos(prev => prev.filter(p => p.id !== id));
      showToast("Processo excluído.", "success");
    } catch {
      showToast("Erro ao excluir.", "error");
    } finally {
      setDeletando(null);
    }
  }

  async function handleSyncTodos() {
    setSyncLote({ loading: true, result: null, erro: null });
    try {
      const r = await api.monitoramento.syncTodos();
      setSyncLote({ loading: false, result: r, erro: null });
      if (r.novos_eventos > 0) carregar();
    } catch (e) {
      setSyncLote({ loading: false, result: null, erro: e instanceof Error ? e.message : "Erro ao sincronizar" });
    }
  }

  // Total de alertas ativos (críticos + urgentes)
  const alertasAtivos = (alertas?.criticos.count ?? 0) + (alertas?.urgentes.count ?? 0);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 sm:ml-60 flex flex-col">
        <TopBar title="Dashboard" subtitle="Central de comando do escritório" />

        <main className="flex-1 p-6 lg:p-8 space-y-8">

          {/* ── Métricas principais ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Processos"
              value={loading ? "—" : (admin?.total_processos ?? processos.length)}
              icon={<Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />}
              onClick={() => document.getElementById("tabela-processos")?.scrollIntoView({ behavior: "smooth" })}
            />
            <StatCard
              label="Documentos processados"
              value={loading ? "—" : (admin?.total_documentos ?? "—")}
              icon={<Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />}
              href="/admin"
            />
            <StatCard
              label="Tarefas pendentes"
              value={loading ? "—" : (admin?.tarefas_pendentes ?? "—")}
              icon={<Icon d="M9 11l3 3L22 4" />}
              accent={admin?.tarefas_pendentes ? admin.tarefas_pendentes > 0 : false}
              href="/revisao"
            />
            <StatCard
              label="Análises p/ revisão"
              value={loading ? "—" : (admin?.analises_pendentes_revisao ?? "—")}
              icon={<Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />}
              accent={admin?.analises_pendentes_revisao ? admin.analises_pendentes_revisao > 0 : false}
              href="/revisao"
            />
          </div>

          {/* ── Central de Alertas de Prazos ── */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-bold text-text-main">⚖️ Central de Prazos</h2>
                {alertasAtivos > 0 && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-500 text-white animate-pulse">
                    {alertasAtivos} urgente{alertasAtivos !== 1 ? "s" : ""}
                  </span>
                )}
                {!loadingAlertas && alertas?.total === 0 && (
                  <span className="text-xs text-green-600 font-semibold px-2.5 py-1 rounded-full bg-green-50 border border-green-200">
                    ✓ Nenhum prazo nos próximos 30 dias
                  </span>
                )}
              </div>
              <button
                onClick={carregarAlertas}
                className="text-xs text-muted hover:text-text-main flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-surface border border-transparent hover:border-border transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loadingAlertas ? "animate-spin" : ""}>
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
                </svg>
                Atualizar
              </button>
            </div>

            {loadingAlertas && !alertas ? (
              <div className="flex items-center gap-3 py-8 justify-center text-muted text-sm">
                <svg className="animate-spin h-5 w-5 text-gold" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Verificando prazos…
              </div>
            ) : (
              <div className="space-y-3">
                {PAINEIS.map(cfg => {
                  const items = alertas
                    ? cfg.nivel === "critico"  ? alertas.criticos.items
                    : cfg.nivel === "urgente"  ? alertas.urgentes.items
                    : cfg.nivel === "atencao"  ? alertas.atencao.items
                    : alertas.monitorar.items
                    : [];
                  return (
                    <PainelAlertas
                      key={cfg.nivel}
                      config={cfg}
                      items={items}
                      loading={loadingAlertas}
                      expanded={expandidos[cfg.nivel]}
                      onToggle={() => setExpandidos(prev => ({ ...prev, [cfg.nivel]: !prev[cfg.nivel] }))}
                    />
                  );
                })}

                {!loadingAlertas && alertas && alertas.total === 0 && (
                  <div className="text-center py-10 rounded-xl border border-dashed border-border">
                    <div className="text-3xl mb-2">✅</div>
                    <p className="text-sm font-semibold text-text-main">Carteira de prazos em dia</p>
                    <p className="text-xs text-muted mt-1">Nenhum prazo vencendo nos próximos 30 dias</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Monitoramento DataJud ── */}
          <div className="bg-surface rounded-xl border border-border p-5">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">📡</span>
                  <h2 className="text-base font-bold text-text-main">Monitoramento DataJud</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">CNJ</span>
                </div>
                <p className="text-xs text-muted">
                  Sincroniza todos os processos ativos com a API pública do CNJ e adiciona novas movimentações à cronologia automaticamente.
                </p>
              </div>
              <button
                onClick={handleSyncTodos}
                disabled={syncLote.loading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all disabled:opacity-50 flex-shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className={syncLote.loading ? "animate-spin" : ""}>
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                {syncLote.loading ? "Sincronizando todos…" : "Sincronizar todos os processos"}
              </button>
            </div>

            {/* Resultado do sync em lote */}
            {syncLote.result && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: "Processos",        valor: syncLote.result.total,           cor: "text-text-main" },
                  { label: "Sincronizados",     valor: syncLote.result.ok,              cor: "text-green-600" },
                  { label: "Não encontrados",   valor: syncLote.result.nao_encontrados, cor: "text-yellow-600" },
                  { label: "Erros",             valor: syncLote.result.erros,           cor: "text-red-600"   },
                  { label: "Novos eventos",     valor: syncLote.result.novos_eventos,   cor: "text-blue-600 font-bold" },
                ].map(c => (
                  <div key={c.label} className="bg-bg rounded-xl border border-border p-3 text-center">
                    <p className={`text-2xl font-bold ${c.cor}`}>{c.valor}</p>
                    <p className="text-xs text-muted mt-0.5">{c.label}</p>
                  </div>
                ))}
              </div>
            )}
            {syncLote.erro && (
              <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                ❌ {syncLote.erro}
              </div>
            )}

            {/* Info sobre funcionamento */}
            {!syncLote.result && !syncLote.erro && (
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  Cobre todos os 90+ tribunais brasileiros
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  Detecta sentença, acórdão, decisão, intimação e mais
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  Adiciona eventos novos à cronologia sem duplicar
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  Também disponível processo a processo (botão "Sync DataJud" no processo)
                </span>
              </div>
            )}
          </div>

          {/* ── Tabela de processos ── */}
          <div id="tabela-processos" className="bg-surface rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-base font-semibold text-text-main">Processos</h2>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input type="text" placeholder="Buscar..."
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="pl-9 pr-4 py-2 text-sm rounded-lg border border-border bg-bg text-text-main placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold w-52" />
                </div>
                <Link href="/clientes"
                  className="border border-border rounded-lg px-4 py-2 text-sm font-semibold text-muted hover:text-text-main hover:border-gold/40 transition-all whitespace-nowrap">
                  👥 Clientes
                </Link>
                <button onClick={() => setModalNovo(true)}
                  className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all whitespace-nowrap">
                  + Novo Processo
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <svg className="animate-spin h-6 w-6 text-gold" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : processos.length === 0 ? (
              <div className="flex flex-col items-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gold/10 flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-text-main mb-2">Nenhum processo cadastrado</h3>
                <p className="text-sm text-muted mb-5">Crie um processo e envie seus documentos.</p>
                <button onClick={() => setModalNovo(true)}
                  className="bg-gold text-navy font-semibold rounded-lg px-5 py-2.5 text-sm hover:bg-gold-light transition-all">
                  Criar Processo
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-border">
                      {["Processo / Assunto", "Cliente", "Tribunal · Vara", "Status", "Docs", "Tarefas", "Atualização", ""].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 font-semibold text-muted text-xs uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {processosFiltrados.map((p) => (
                      <tr key={p.id}
                        className="hover:bg-gold/5 transition-colors cursor-pointer group"
                        onClick={() => setProcessoAberto(p)}>
                        <td className="px-4 py-2.5 max-w-[260px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-text-main text-xs font-mono whitespace-nowrap">
                              {p.numero_cnj ?? p.id.slice(0, 8) + "…"}
                            </span>
                            {p.assunto && (
                              <>
                                <span className="text-border text-xs">·</span>
                                <span className="text-muted text-xs truncate">{p.assunto}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                          {p.cliente_nome ? (
                            <Link
                              href={`/clientes/${p.cliente_id}`}
                              onClick={e => e.stopPropagation()}
                              className="text-gold hover:underline font-medium">
                              {p.cliente_nome}
                            </Link>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted text-xs whitespace-nowrap">
                          {[p.tribunal, p.vara].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={p.status} />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gold/10 text-gold font-semibold text-xs">
                            {p.total_documentos}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <PrioridadeDot n={p.tarefas_pendentes} />
                            <span className="text-xs text-muted">{p.tarefas_pendentes} pend.</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">
                          {p.updated_at ? new Date(p.updated_at).toLocaleDateString("pt-BR") : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              onClick={() => router.push(`/processo/${p.id}`)}
                              className="text-xs font-semibold text-gold hover:text-gold-light px-2.5 py-1 rounded-lg hover:bg-gold/10 transition-all opacity-0 group-hover:opacity-100">
                              Abrir →
                            </button>
                            <button onClick={() => router.push(`/upload?processo=${p.id}`)}
                              className="text-xs font-semibold text-muted hover:text-text-main px-2.5 py-1 rounded-lg hover:bg-bg transition-all">
                              + Doc
                            </button>
                            <button onClick={() => handleDeletar(p.id, p.assunto ?? p.numero_cnj)}
                              disabled={deletando === p.id}
                              className="text-xs font-semibold text-danger hover:text-red-400 px-2.5 py-1 rounded-lg hover:bg-danger/10 transition-all disabled:opacity-50">
                              {deletando === p.id ? "…" : "Excluir"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {modalNovo && (
        <ModalNovoProcesso
          onClose={() => setModalNovo(false)}
          onCreate={p => { setProcessos(prev => [p, ...prev]); setModalNovo(false); showToast("Processo criado!", "success"); }}
        />
      )}

      {processoAberto && (
        <ProcessoDrawer
          processo={processoAberto}
          onClose={() => setProcessoAberto(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
