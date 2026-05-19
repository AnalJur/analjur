"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import StatCard from "@/components/StatCard";
import { api, type Processo, type DashboardAdmin } from "@/lib/api";

// ── Ícones ────────────────────────────────────────────────────────────────

function Icon({ d }: { d: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  const [form, setForm] = useState({ numero_cnj: "", tribunal: "", vara: "", assunto: "" });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const p = await api.processos.criar(form);
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

// ── Página principal ──────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [admin, setAdmin] = useState<DashboardAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [deletando, setDeletando] = useState<string | null>(null);
  const [modalNovo, setModalNovo] = useState(false);

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

  useEffect(() => { carregar(); }, [carregar]);

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

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 sm:ml-60 flex flex-col">
        <TopBar title="Dashboard" subtitle="Visão geral dos processos" />

        <main className="flex-1 p-8 space-y-8">
          {/* Métricas principais */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Processos"
              value={loading ? "—" : (admin?.total_processos ?? processos.length)}
              icon={<Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />}
            />
            <StatCard
              label="Documentos processados"
              value={loading ? "—" : (admin?.total_documentos ?? "—")}
              icon={<Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />}
            />
            <StatCard
              label="Tarefas pendentes"
              value={loading ? "—" : (admin?.tarefas_pendentes ?? "—")}
              icon={<Icon d="M9 11l3 3L22 4" />}
              accent={admin?.tarefas_pendentes ? admin.tarefas_pendentes > 0 : false}
            />
            <StatCard
              label="Análises p/ revisão"
              value={loading ? "—" : (admin?.analises_pendentes_revisao ?? "—")}
              icon={<Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />}
              accent={admin?.analises_pendentes_revisao ? admin.analises_pendentes_revisao > 0 : false}
            />
          </div>

          {/* Tabela de processos */}
          <div className="bg-surface rounded-xl shadow-sm overflow-hidden">
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
                      {["Processo / Assunto", "Tribunal · Vara", "Status", "Docs", "Tarefas", "Atualização", ""].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 font-semibold text-muted text-xs uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {processosFiltrados.map((p) => (
                      <tr key={p.id} className="hover:bg-gold/5 transition-colors">
                        {/* Número + Assunto em linha única */}
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
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <button onClick={() => router.push(`/processo/${p.id}`)}
                              className="text-xs font-semibold text-gold hover:text-gold-light px-2.5 py-1 rounded-lg hover:bg-gold/10 transition-all">
                              Abrir
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

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
