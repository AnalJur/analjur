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

// ── Modal: criar processo com upload opcional ─────────────────────────────

function ModalNovoProcesso({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (p: Processo) => void;
}) {
  const router = useRouter();
  const dropRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ numero_cnj: "", tribunal: "", vara: "", assunto: "", cidade: "", cliente_id: "" });
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading]   = useState(false);
  const [pdf, setPdf]           = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fase, setFase]         = useState<"form" | "uploading" | "ok">("form");
  const [progresso, setProgresso] = useState(0);
  const [processoId, setProcessoId] = useState<string | null>(null);

  useEffect(() => {
    api.clientes.listar().then(setClientes).catch(() => {});
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") setPdf(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const body: Record<string, string> = {};
      if (form.numero_cnj) body.numero_cnj = form.numero_cnj;
      if (form.tribunal)   body.tribunal   = form.tribunal;
      if (form.vara)       body.vara       = form.vara;
      if (form.assunto)    body.assunto    = form.assunto;
      if (form.cidade)     body.cidade     = form.cidade;
      if (form.cliente_id) body.cliente_id = form.cliente_id;
      const p = await api.processos.criar(body);
      setProcessoId(p.id);

      if (pdf) {
        setFase("uploading");
        setProgresso(10);
        const doc = await api.documentos.upload(p.id, pdf);
        setProgresso(30);
        // Poll até processar
        let tentativas = 0;
        while (tentativas < 60) {
          await new Promise(r => setTimeout(r, 2000));
          const s = await api.documentos.status(p.id, doc.id);
          if (s.status === "processado") { setProgresso(100); break; }
          if (s.status === "erro") break;
          setProgresso(Math.min(30 + tentativas * 3, 95));
          tentativas++;
        }
        setFase("ok");
        onCreate(p);
      } else {
        onCreate(p);
        onClose();
      }
    } catch {
      alert("Erro ao criar processo.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40 placeholder-muted";

  // ── Fase: uploading ──
  if (fase === "uploading") {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <svg className="animate-spin w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
          <p className="text-sm font-bold text-text-main mb-1">Processando documento…</p>
          <p className="text-xs text-muted mb-4">{pdf?.name}</p>
          <div className="h-1.5 bg-bg rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full transition-all duration-500"
              style={{ width: `${progresso}%` }} />
          </div>
          <p className="text-[10px] text-muted mt-2">{progresso}%</p>
        </div>
      </div>
    );
  }

  // ── Fase: ok (PDF processado) ──
  if (fase === "ok" && processoId) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <p className="text-base font-bold text-text-main mb-1">Processo criado!</p>
          <p className="text-xs text-muted mb-5">O documento foi processado e está pronto para análise.</p>
          <div className="space-y-2.5">
            <button onClick={() => router.push(`/processo/${processoId}?tab=analises`)}
              className="w-full bg-gradient-to-r from-violet-600 to-purple-700 text-white font-bold rounded-xl py-3 text-sm hover:brightness-110 transition-all flex items-center justify-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              Analisar com IA agora
            </button>
            <button onClick={() => router.push(`/processo/${processoId}`)}
              className="w-full border border-border rounded-xl py-2.5 text-sm font-semibold text-text-main hover:bg-bg transition-colors">
              Abrir processo
            </button>
            <button onClick={onClose}
              className="w-full text-xs text-muted hover:text-text-main transition-colors py-1">
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Fase: formulário ──
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-navy px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <div>
            <p className="text-white font-bold">Novo Processo</p>
            <p className="text-white/50 text-xs mt-0.5">Preencha os dados ou envie o PDF para extração automática</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">

          {/* Upload de PDF */}
          <div
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => !pdf && dropRef.current?.click()}
            className={`relative rounded-xl border-2 border-dashed transition-all ${
              pdf
                ? "border-emerald-300 bg-emerald-50 cursor-default"
                : dragOver
                ? "border-gold bg-gold/8 cursor-copy"
                : "border-border hover:border-gold hover:bg-gold/5 cursor-pointer"
            } p-4`}>
            <input ref={dropRef} type="file" accept="application/pdf" className="hidden"
              onChange={e => e.target.files?.[0] && setPdf(e.target.files[0])} />
            {pdf ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-600">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-emerald-800 truncate">{pdf.name}</p>
                  <p className="text-xs text-emerald-600">PDF selecionado — será processado após criar</p>
                </div>
                <button type="button" onClick={e => { e.stopPropagation(); setPdf(null); }}
                  className="text-emerald-400 hover:text-red-500 transition-colors flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gold/10 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gold">
                    <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-main">Arraste o PDF do processo</p>
                  <p className="text-xs text-muted">Opcional — extrai dados automaticamente · ou <span className="text-gold underline">selecione</span></p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 text-muted">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] font-bold uppercase tracking-widest">dados do processo</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Campos */}
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Número CNJ</label>
            <input className={inputCls}
              placeholder="0000000-00.0000.0.00.0000"
              value={form.numero_cnj}
              onChange={e => setForm(f => ({ ...f, numero_cnj: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Tribunal</label>
              <input className={inputCls} placeholder="TJSP, TRF3…"
                value={form.tribunal} onChange={e => setForm(f => ({ ...f, tribunal: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Vara</label>
              <input className={inputCls} placeholder="1ª Vara Cível…"
                value={form.vara} onChange={e => setForm(f => ({ ...f, vara: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Cidade</label>
            <input className={inputCls} placeholder="São Paulo, Goiânia…"
              value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Assunto</label>
            <input className={inputCls} placeholder="Indenização por danos morais…"
              value={form.assunto} onChange={e => setForm(f => ({ ...f, assunto: e.target.value }))} />
          </div>
          {clientes.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Cliente (opcional)</label>
              <select className={inputCls}
                value={form.cliente_id}
                onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}>
                <option value="">— Sem cliente —</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-border rounded-xl py-2.5 text-sm font-semibold text-muted hover:bg-bg transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-xl py-2.5 text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? (
                <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>Criando…</>
              ) : pdf ? "Criar + Enviar PDF" : "Criar Processo"}
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

  const alertasAtivos = (alertas?.criticos.count ?? 0) + (alertas?.urgentes.count ?? 0);

  // KPI cards config
  const kpis = [
    {
      label: "Processos",
      value: loading ? "—" : (admin?.total_processos ?? processos.length),
      sub: "em carteira",
      from: "from-[#0f2447]", to: "to-[#1a3a6b]",
      accent: "text-[#7eb3ff]", ring: "ring-[#3b6cb7]/40",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      ),
      onClick: () => document.getElementById("tabela-processos")?.scrollIntoView({ behavior: "smooth" }),
    },
    {
      label: "Documentos",
      value: loading ? "—" : (admin?.total_documentos ?? "—"),
      sub: "processados",
      from: "from-[#1a1a3e]", to: "to-[#2d2b6b]",
      accent: "text-[#a78bfa]", ring: "ring-[#6d5fd7]/40",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
      ),
      href: "/admin",
    },
    {
      label: "Tarefas",
      value: loading ? "—" : (admin?.tarefas_pendentes ?? "—"),
      sub: "pendentes",
      from: "from-[#3b1700]", to: "to-[#7c3200]",
      accent: "text-[#fdba74]", ring: "ring-[#ea8a00]/40",
      alert: (admin?.tarefas_pendentes ?? 0) > 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="9 11 12 14 22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      ),
      href: "/revisao",
    },
    {
      label: "Análises IA",
      value: loading ? "—" : (admin?.analises_pendentes_revisao ?? "—"),
      sub: "p/ revisão",
      from: "from-[#1e0a3c]", to: "to-[#3b1378]",
      accent: "text-[#c084fc]", ring: "ring-[#9333ea]/40",
      alert: (admin?.analises_pendentes_revisao ?? 0) > 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ),
      href: "/revisao",
    },
    {
      label: "Clientes",
      value: loading ? "—" : processos.map(p => p.cliente_id).filter((v, i, a) => v && a.indexOf(v) === i).length || "—",
      sub: "cadastrados",
      from: "from-[#042f1e]", to: "to-[#065f39]",
      accent: "text-[#6ee7b7]", ring: "ring-[#059669]/40",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      ),
      href: "/clientes",
    },
    {
      label: "Prazos",
      value: loading ? "—" : (alertas?.total ?? "—"),
      sub: alertasAtivos > 0 ? `${alertasAtivos} urgente${alertasAtivos > 1 ? "s" : ""}` : "nos próx. 30d",
      from: alertasAtivos > 0 ? "from-[#3b0000]" : "from-[#001c30]",
      to:   alertasAtivos > 0 ? "to-[#7c0000]"   : "to-[#004d70]",
      accent: alertasAtivos > 0 ? "text-[#fca5a5]" : "text-[#67e8f9]",
      ring: alertasAtivos > 0 ? "ring-[#dc2626]/40" : "ring-[#0891b2]/40",
      alert: alertasAtivos > 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
      href: "/agenda",
    },
  ] as const;

  return (
    <div className="flex h-screen bg-[#eef0f4] overflow-hidden">
      <Sidebar />
      <div className="flex-1 sm:ml-0 flex flex-col min-w-0 overflow-hidden">
        <TopBar title="Dashboard" subtitle="Central de comando do escritório" />

        <div className="flex-1 overflow-hidden flex flex-col gap-3 p-3">

          {/* ── KPI Cards ─────────────────────────────────────────── */}
          <div className="grid grid-cols-6 gap-3 flex-shrink-0">
            {kpis.map((k) => {
              const content = (
                <div className={`relative bg-gradient-to-br ${k.from} ${k.to} rounded-2xl p-4 cursor-pointer
                  ring-1 ${k.ring} hover:ring-2 hover:brightness-110 transition-all group overflow-hidden`}>
                  {/* Glow ornament */}
                  <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full opacity-10 blur-xl"
                    style={{ background: "white" }} />
                  {/* Alert pulse */}
                  {(k as {alert?: boolean}).alert && (
                    <span className="absolute top-2.5 right-2.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400" />
                    </span>
                  )}
                  <div className={`${k.accent} mb-2 opacity-80`}>{k.icon}</div>
                  <p className="text-white text-2xl font-bold leading-none">{k.value}</p>
                  <p className={`text-[11px] font-semibold mt-1 ${k.accent} opacity-70`}>{k.sub}</p>
                  <p className="text-white/40 text-[10px] mt-0.5 uppercase tracking-wide font-medium">{k.label}</p>
                </div>
              );
              if ("href" in k && k.href) {
                return <Link key={k.label} href={k.href}>{content}</Link>;
              }
              return (
                <div key={k.label} onClick={"onClick" in k ? k.onClick : undefined}>
                  {content}
                </div>
              );
            })}
          </div>

          {/* ── Conteúdo principal: processo + alertas ─────────────── */}
          <div className="flex-1 overflow-hidden grid grid-cols-5 gap-3 min-h-0">

            {/* ── Tabela de processos ── */}
            <div id="tabela-processos" className="col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              {/* Header */}
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-shrink-0">
                <h2 className="text-sm font-bold text-slate-800">Processos</h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input type="text" placeholder="Buscar..." value={busca}
                      onChange={e => setBusca(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-40" />
                  </div>
                  <Link href="/clientes"
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 hover:border-amber-300 transition-all whitespace-nowrap">
                    Clientes
                  </Link>
                  <button onClick={() => setModalNovo(true)}
                    className="bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold rounded-lg px-3 py-1.5 text-xs hover:brightness-110 transition-all whitespace-nowrap shadow-sm">
                    + Novo
                  </button>
                </div>
              </div>

              {/* Table body */}
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <svg className="animate-spin h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  </div>
                ) : processos.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-700">Nenhum processo</p>
                      <p className="text-xs text-slate-400 mt-0.5">Crie um processo para começar</p>
                    </div>
                    <button onClick={() => setModalNovo(true)}
                      className="bg-amber-500 text-white font-semibold rounded-lg px-4 py-2 text-xs hover:bg-amber-600 transition-all">
                      Criar processo
                    </button>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 z-10">
                      <tr>
                        {["Processo", "Cliente", "Tribunal", "Status", "Docs", "Tarefas", ""].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {processosFiltrados.map((p) => (
                        <tr key={p.id}
                          className="hover:bg-indigo-50/50 transition-colors cursor-pointer group"
                          onClick={() => setProcessoAberto(p)}>
                          <td className="px-3 py-2.5 max-w-[200px]">
                            <p className="font-semibold text-slate-800 font-mono truncate text-[11px]">
                              {p.numero_cnj ?? p.id.slice(0, 8) + "…"}
                            </p>
                            {p.assunto && <p className="text-slate-400 truncate text-[10px] mt-0.5">{p.assunto}</p>}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {p.cliente_nome ? (
                              <Link href={`/clientes/${p.cliente_id}`} onClick={e => e.stopPropagation()}
                                className="text-emerald-600 hover:underline font-medium text-[11px]">
                                {p.cliente_nome}
                              </Link>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">
                            {p.tribunal ?? "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              p.status === "ativo" ? "bg-emerald-100 text-emerald-700"
                              : p.status === "suspenso" ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                            }`}>{p.status}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 font-bold text-[10px]">
                              {p.total_documentos}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${p.tarefas_pendentes === 0 ? "bg-emerald-400" : p.tarefas_pendentes <= 2 ? "bg-amber-400" : "bg-red-400"}`} />
                              <span className="text-slate-400 text-[10px]">{p.tarefas_pendentes}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => router.push(`/processo/${p.id}`)}
                                className="text-[10px] font-bold text-amber-600 hover:text-amber-700 px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 transition-all">
                                Abrir →
                              </button>
                              <button onClick={() => router.push(`/upload?processo=${p.id}`)}
                                className="text-[10px] font-semibold text-slate-400 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100 transition-all">
                                + Doc
                              </button>
                              <button onClick={() => handleDeletar(p.id, p.assunto ?? p.numero_cnj)}
                                disabled={deletando === p.id}
                                className="text-[10px] font-semibold text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-all">
                                {deletando === p.id ? "…" : "✕"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ── Coluna direita: Alertas + DataJud ── */}
            <div className="col-span-2 flex flex-col gap-3 min-h-0 overflow-hidden">

              {/* Alertas de prazos */}
              <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-800">Central de Prazos</h2>
                    {alertasAtivos > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white animate-pulse">
                        {alertasAtivos} urgente{alertasAtivos !== 1 ? "s" : ""}
                      </span>
                    )}
                    {!loadingAlertas && alertas?.total === 0 && (
                      <span className="text-[10px] text-emerald-600 font-bold px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200">
                        ✓ em dia
                      </span>
                    )}
                  </div>
                  <button onClick={carregarAlertas}
                    className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className={loadingAlertas ? "animate-spin" : ""}>
                      <polyline points="1 4 1 10 7 10"/>
                      <path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {loadingAlertas && !alertas ? (
                    <div className="flex items-center justify-center h-full text-slate-400 text-xs gap-2">
                      <svg className="animate-spin h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Verificando prazos…
                    </div>
                  ) : (
                    <>
                      {PAINEIS.map(cfg => {
                        const items = alertas
                          ? cfg.nivel === "critico"  ? alertas.criticos.items
                          : cfg.nivel === "urgente"  ? alertas.urgentes.items
                          : cfg.nivel === "atencao"  ? alertas.atencao.items
                          : alertas.monitorar.items
                          : [];
                        return (
                          <PainelAlertas key={cfg.nivel} config={cfg} items={items}
                            loading={loadingAlertas} expanded={expandidos[cfg.nivel]}
                            onToggle={() => setExpandidos(prev => ({ ...prev, [cfg.nivel]: !prev[cfg.nivel] }))} />
                        );
                      })}
                      {!loadingAlertas && alertas && alertas.total === 0 && (
                        <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
                          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </div>
                          <p className="text-xs font-semibold text-slate-600">Carteira em dia</p>
                          <p className="text-[10px] text-slate-400">Nenhum prazo nos próximos 30 dias</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* DataJud sync — compacto */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex-shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-600">
                        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700">DataJud CNJ</p>
                      <p className="text-[10px] text-slate-400">Sync movimentações de todos os processos</p>
                    </div>
                  </div>
                  <button onClick={handleSyncTodos} disabled={syncLote.loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold transition-all disabled:opacity-50 whitespace-nowrap flex-shrink-0">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className={syncLote.loading ? "animate-spin" : ""}>
                      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    {syncLote.loading ? "Sync…" : "Sync Todos"}
                  </button>
                </div>
                {syncLote.result && (
                  <div className="grid grid-cols-5 gap-1.5 mt-2">
                    {[
                      { l: "Total",    v: syncLote.result.total,            c: "text-slate-600" },
                      { l: "OK",       v: syncLote.result.ok,               c: "text-emerald-600" },
                      { l: "N/A",      v: syncLote.result.nao_encontrados,  c: "text-amber-600" },
                      { l: "Erro",     v: syncLote.result.erros,            c: "text-red-600" },
                      { l: "Novos",    v: syncLote.result.novos_eventos,    c: "text-blue-600 font-bold" },
                    ].map(c => (
                      <div key={c.l} className="bg-slate-50 rounded-lg p-1.5 text-center border border-slate-100">
                        <p className={`text-sm font-bold ${c.c}`}>{c.v}</p>
                        <p className="text-[9px] text-slate-400">{c.l}</p>
                      </div>
                    ))}
                  </div>
                )}
                {syncLote.erro && (
                  <p className="mt-2 text-[10px] text-red-600 bg-red-50 rounded-lg px-2 py-1">❌ {syncLote.erro}</p>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>

      {modalNovo && (
        <ModalNovoProcesso
          onClose={() => setModalNovo(false)}
          onCreate={p => { setProcessos(prev => [p, ...prev]); setModalNovo(false); showToast("Processo criado!", "success"); }}
        />
      )}
      {processoAberto && (
        <ProcessoDrawer processo={processoAberto} onClose={() => setProcessoAberto(null)} />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
