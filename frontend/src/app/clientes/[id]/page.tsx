"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { api, type Cliente, type Processo } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtData(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtCpfCnpj(v?: string) {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return v;
}

function diasAte(s: string) {
  const diff = Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);
  return diff;
}

// ── Spinner ───────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="w-6 h-6 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
  );
}

// ── Status badge do processo ──────────────────────────────────────────────

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, string> = {
    ativo:     "bg-green-100 text-green-700",
    arquivado: "bg-gray-100 text-gray-500",
    suspenso:  "bg-yellow-100 text-yellow-700",
    encerrado: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[s] ?? "bg-surface text-muted"}`}>
      {s}
    </span>
  );
}

// ── Card de processo ──────────────────────────────────────────────────────

function ProcessoCard({ p, onDesvincular }: { p: Processo; onDesvincular: (id: string) => void }) {
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/processo/${p.id}`)}
      className="bg-bg border border-border rounded-xl p-4 hover:border-gold/40 hover:shadow-md transition-all cursor-pointer group">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-muted truncate">{p.numero_cnj ?? "Sem número"}</p>
          <p className="text-sm font-semibold text-text-main mt-0.5 line-clamp-2 leading-tight">
            {p.assunto ?? "Sem assunto"}
          </p>
        </div>
        <StatusBadge s={p.status} />
      </div>

      {(p.tribunal || p.vara) && (
        <p className="text-xs text-muted mb-3 truncate">
          {[p.tribunal, p.vara].filter(Boolean).join(" · ")}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-3 text-xs text-muted">
          {p.total_documentos > 0 && <span>📄 {p.total_documentos}</span>}
          {p.tarefas_pendentes > 0 && (
            <span className="text-orange-500 font-semibold">⚡ {p.tarefas_pendentes} tarefas</span>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDesvincular(p.id); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted hover:text-danger border border-border rounded-lg px-2 py-1 hover:border-danger/30">
          Desvincular
        </button>
      </div>

      {p.ultimo_upload && (
        <p className="text-xs text-muted mt-2">Últ. upload {fmtData(p.ultimo_upload)}</p>
      )}
    </div>
  );
}

// ── Seção de informações do cliente ──────────────────────────────────────

function InfoCliente({ cliente }: { cliente: Cliente }) {
  const campos = [
    { label: "Tipo",     value: cliente.tipo === "pj" ? "Pessoa Jurídica" : "Pessoa Física" },
    { label: cliente.tipo === "pj" ? "CNPJ" : "CPF", value: fmtCpfCnpj(cliente.cpf_cnpj) },
    { label: "E-mail",   value: cliente.email },
    { label: "Telefone", value: cliente.telefone },
    { label: "Endereço", value: cliente.endereco },
    { label: "Cliente desde", value: fmtData(cliente.created_at) },
  ].filter(c => c.value);

  return (
    <div className="bg-bg border border-border rounded-2xl p-5">
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wide mb-4">Dados de Contato</h3>
      <dl className="space-y-3">
        {campos.map(c => (
          <div key={c.label}>
            <dt className="text-xs text-muted">{c.label}</dt>
            <dd className="text-sm text-text-main font-medium mt-0.5">{c.value}</dd>
          </div>
        ))}
      </dl>
      {cliente.observacoes && (
        <div className="mt-4 pt-4 border-t border-border">
          <dt className="text-xs text-muted mb-1">Observações</dt>
          <dd className="text-sm text-text-main leading-relaxed whitespace-pre-wrap">
            {cliente.observacoes}
          </dd>
        </div>
      )}
    </div>
  );
}

// ── Painel de vincular processo ───────────────────────────────────────────

function VincularProcesso({ clienteId, processoIds, onVinculado }: {
  clienteId: string;
  processoIds: Set<string>;
  onVinculado: (p: Processo) => void;
}) {
  const [todos, setTodos]       = useState<Processo[]>([]);
  const [busca, setBusca]       = useState("");
  const [loading, setLoading]   = useState(true);
  const [vinculando, setVinc]   = useState<string | null>(null);

  useEffect(() => {
    api.processos.listar().then(setTodos).finally(() => setLoading(false));
  }, []);

  const disponiveis = todos.filter(p =>
    !processoIds.has(p.id) &&
    ((p.numero_cnj ?? "").toLowerCase().includes(busca.toLowerCase()) ||
     (p.assunto ?? "").toLowerCase().includes(busca.toLowerCase()))
  );

  async function vincular(p: Processo) {
    setVinc(p.id);
    try {
      await api.clientes.vincularProcesso(clienteId, p.id);
      onVinculado(p);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao vincular");
    } finally { setVinc(null); }
  }

  return (
    <div className="space-y-3">
      <input
        autoFocus
        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
        placeholder="Buscar processo por número ou assunto…"
        value={busca}
        onChange={e => setBusca(e.target.value)}
      />
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : disponiveis.length === 0 ? (
        <p className="text-center text-sm text-muted py-6">
          {busca ? "Nenhum processo encontrado" : "Todos os processos já estão vinculados"}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {disponiveis.map(p => (
            <div key={p.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border hover:border-gold/30 bg-bg">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-muted">{p.numero_cnj ?? "—"}</p>
                <p className="text-sm text-text-main font-medium truncate">{p.assunto ?? "Sem assunto"}</p>
                {p.cliente_nome && (
                  <p className="text-xs text-orange-500">⚠ Já vinculado a {p.cliente_nome}</p>
                )}
              </div>
              <button
                onClick={() => vincular(p)}
                disabled={vinculando === p.id}
                className="flex-shrink-0 text-xs font-semibold bg-gold text-navy rounded-lg px-3 py-1.5 hover:bg-gold-light transition-colors disabled:opacity-50">
                {vinculando === p.id ? "…" : "Vincular"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-bg border border-border rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-base font-semibold text-text-main">{title}</h3>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface text-muted text-lg">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────

export default function ClienteDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router  = useRouter();

  const [cliente, setCliente]     = useState<Cliente | null>(null);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modalVinc, setModalVinc] = useState(false);
  const [filtro, setFiltro]       = useState<"todos" | "ativo" | "encerrado">("todos");
  const [resumo, setResumo]       = useState<{
    total_horas: number; total_honorarios: number;
    total_recebido: number; total_pendente: number;
  } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const c = await api.clientes.obter(id);
      setCliente(c);
      // Carrega em paralelo sem bloquear exibição
      api.clientes.processos(id).then(setProcessos).catch(() => setProcessos([]));
      api.clientes.resumo(id).then(setResumo).catch(() => null);
    } catch {
      setCliente(null);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function desvincular(processoId: string) {
    if (!cliente) return;
    if (!confirm("Desvincular este processo do cliente?")) return;
    await api.clientes.desvincularProcesso(cliente.id, processoId);
    setProcessos(prev => prev.filter(p => p.id !== processoId));
  }

  function onVinculado(p: Processo) {
    setProcessos(prev => [p, ...prev]);
    setModalVinc(false);
  }

  const processosFiltrados = processos.filter(p =>
    filtro === "todos" || p.status === filtro
  );

  const totalHorasTS = 0; // futuro: buscar timesheet total do cliente

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-3">
        <p className="text-2xl">⚠️</p>
        <p className="text-text-main font-semibold">Cliente não encontrado</p>
        <button onClick={() => router.back()}
          className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-border/60 text-muted hover:text-text-main transition-all group">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="group-hover:-translate-x-0.5 transition-transform">
            <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
      </div>
    );
  }

  const urgentes = processos.filter(p => {
    // Processos ativos sem upload recente (> 30 dias) como sinal de atenção
    if (p.status !== "ativo") return false;
    if (!p.ultimo_upload) return true;
    return diasAte(p.ultimo_upload) < -30;
  });

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="bg-bg border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/clientes")}
              className="text-muted hover:text-text-main transition-colors text-sm flex items-center gap-1.5">
              ← Clientes
            </button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${
                cliente.tipo === "pj" ? "bg-blue-100" : "bg-gold/10"
              }`}>
                {cliente.tipo === "pj" ? "🏢" : "👤"}
              </div>
              <div>
                <h1 className="text-lg font-bold text-text-main leading-tight">{cliente.nome}</h1>
                <p className="text-xs text-muted">
                  {fmtCpfCnpj(cliente.cpf_cnpj) ?? (cliente.tipo === "pj" ? "Pessoa Jurídica" : "Pessoa Física")}
                  {cliente.email && ` · ${cliente.email}`}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => setModalVinc(true)}
            className="bg-gold text-navy font-semibold rounded-xl px-4 py-2 text-sm hover:bg-gold-light transition-colors">
            + Vincular Processo
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar esquerda */}
          <div className="lg:col-span-1 space-y-4">
            {/* Resumo numérico */}
            <div className="bg-bg border border-border rounded-2xl p-5 grid grid-cols-2 gap-3">
              <div className="text-center">
                <p className="text-2xl font-bold text-text-main">{cliente.total_processos}</p>
                <p className="text-xs text-muted">Processos</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gold">{cliente.processos_ativos}</p>
                <p className="text-xs text-muted">Ativos</p>
              </div>
              {urgentes.length > 0 && (
                <div className="col-span-2 bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-red-600">{urgentes.length}</p>
                  <p className="text-xs text-red-500">Requer atenção</p>
                </div>
              )}
            </div>

            <InfoCliente cliente={cliente} />

            {/* Horas & Financeiro */}
            {resumo && (
              <div className="bg-bg border border-border rounded-2xl p-4 space-y-3">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide">Financeiro</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-surface rounded-xl p-3 text-center">
                    <p className="text-lg font-bold text-text-main">{resumo.total_horas}h</p>
                    <p className="text-xs text-muted mt-0.5">Horas</p>
                  </div>
                  <div className="bg-surface rounded-xl p-3 text-center">
                    <p className="text-lg font-bold text-text-main">
                      {resumo.total_honorarios.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                    <p className="text-xs text-muted mt-0.5">Contratado</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <p className="text-sm font-bold text-green-700">
                      {resumo.total_recebido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                    <p className="text-xs text-green-600 mt-0.5">Recebido</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                    <p className="text-sm font-bold text-amber-700">
                      {resumo.total_pendente.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                    <p className="text-xs text-amber-600 mt-0.5">Pendente</p>
                  </div>
                </div>
              </div>
            )}

            {/* Últ. movimentação */}
            {cliente.ultima_movimentacao && (
              <div className="bg-bg border border-border rounded-2xl p-4">
                <p className="text-xs text-muted mb-1">Última movimentação</p>
                <p className="text-sm font-semibold text-text-main">
                  {fmtData(cliente.ultima_movimentacao)}
                </p>
              </div>
            )}
          </div>

          {/* Coluna principal — processos */}
          <div className="lg:col-span-3 space-y-4">
            {/* Cabeçalho da seção */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-base font-bold text-text-main">
                Processos ({processosFiltrados.length})
              </h2>
              <div className="flex items-center gap-1 bg-bg border border-border rounded-xl p-1">
                {(["todos", "ativo", "encerrado"] as const).map(f => (
                  <button key={f}
                    onClick={() => setFiltro(f)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                      filtro === f ? "bg-gold text-navy" : "text-muted hover:text-text-main"
                    }`}>
                    {f === "todos" ? "Todos" : f === "ativo" ? "Ativos" : "Encerrados"}
                  </button>
                ))}
              </div>
            </div>

            {processosFiltrados.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-border rounded-2xl">
                <p className="text-3xl mb-2">⚖️</p>
                <p className="text-sm font-semibold text-text-main mb-1">
                  {filtro !== "todos" ? "Nenhum processo nessa categoria" : "Nenhum processo vinculado"}
                </p>
                {filtro === "todos" && (
                  <button onClick={() => setModalVinc(true)}
                    className="mt-4 text-sm font-semibold text-gold hover:underline">
                    + Vincular primeiro processo
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {processosFiltrados.map(p => (
                  <ProcessoCard key={p.id} p={p} onDesvincular={desvincular} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modal vincular processo */}
      {modalVinc && cliente && (
        <Modal title="Vincular Processo" onClose={() => setModalVinc(false)}>
          <VincularProcesso
            clienteId={cliente.id}
            processoIds={new Set(processos.map(p => p.id))}
            onVinculado={onVinculado}
          />
        </Modal>
      )}
    </div>
  );
}
