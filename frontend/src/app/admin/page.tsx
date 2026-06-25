"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { api, type Job, type DashboardAdmin } from "@/lib/api";

function JobStatusDot({ status }: { status: string }) {
  const cls: Record<string, string> = {
    concluido:   "bg-green-400",
    processando: "bg-yellow-400 animate-pulse",
    pendente:    "bg-blue-400",
    erro:        "bg-red-400",
    cancelado:   "bg-gray-400",
  };
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cls[status] ?? "bg-gray-300"}`} />;
}

export default function AdminPage() {
  const router = useRouter();
  const [dash, setDash] = useState<DashboardAdmin | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filaStatus, setFilaStatus] = useState<{ tipo: string; status: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [abaJobs, setAbaJobs] = useState<"recentes" | "fila">("fila");
  const [deletando, setDeletando] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, j, f] = await Promise.all([
        api.admin.dashboard(),
        api.jobs.listar(),
        api.jobs.filaStatus(),
      ]);
      setDash(d);
      setJobs(j);
      setFilaStatus(f);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function handleDeletarJob(jobId: string) {
    if (!confirm("Excluir este job da fila?")) return;
    setDeletando(jobId);
    try {
      await api.jobs.deletar(jobId);
      setJobs(prev => prev.filter(j => j.id !== jobId));
      showToast("Job removido.");
    } catch {
      showToast("Erro ao remover job.");
    } finally {
      setDeletando(null);
    }
  }

  async function handleCancelarJob(jobId: string) {
    setDeletando(jobId);
    try {
      await api.jobs.cancelar(jobId);
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "cancelado" } : j));
      showToast("Job cancelado.");
    } catch {
      showToast("Erro ao cancelar job.");
    } finally {
      setDeletando(null);
    }
  }

  // Cards clicáveis com rotas
  const metricCards = dash ? [
    {
      label: "Processos",
      v: dash.total_processos,
      color: "text-indigo-600",
      bg: "bg-indigo-50 border-indigo-100",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-500">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      ),
      href: "/dashboard",
    },
    {
      label: "Documentos processados",
      v: dash.total_documentos,
      color: "text-violet-600",
      bg: "bg-violet-50 border-violet-100",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-violet-500">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
      ),
      href: "/upload",
    },
    {
      label: "Tarefas pendentes",
      v: dash.tarefas_pendentes,
      color: dash.tarefas_pendentes > 0 ? "text-amber-600" : "text-emerald-600",
      bg: dash.tarefas_pendentes > 0 ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={dash.tarefas_pendentes > 0 ? "text-amber-500" : "text-emerald-500"}>
          <polyline points="9 11 12 14 22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      ),
      href: "/revisao",
    },
    {
      label: "Análises p/ revisão",
      v: dash.analises_pendentes_revisao,
      color: dash.analises_pendentes_revisao > 0 ? "text-orange-600" : "text-emerald-600",
      bg: dash.analises_pendentes_revisao > 0 ? "bg-orange-50 border-orange-100" : "bg-emerald-50 border-emerald-100",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={dash.analises_pendentes_revisao > 0 ? "text-orange-500" : "text-emerald-500"}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ),
      href: "/revisao",
    },
  ] : [];

  const statusLabel: Record<string, string> = {
    concluido: "Concluído", processando: "Processando",
    pendente: "Pendente", erro: "Erro", cancelado: "Cancelado",
  };

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar title="Operações" subtitle="Dashboard operacional e fila de jobs" />

        <main className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ── KPI Cards clicáveis ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {loading ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface rounded-xl border border-border p-5 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-1/2 mb-3" />
                <div className="h-8 bg-gray-200 rounded w-1/3" />
              </div>
            )) : metricCards.map(m => (
              <button key={m.label} onClick={() => router.push(m.href)}
                className={`${m.bg} border rounded-2xl p-5 text-left hover:shadow-md hover:scale-[1.02] transition-all group`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm">
                    {m.icon}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className="text-muted group-hover:text-text-main transition-colors">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </div>
                <p className={`text-3xl font-bold ${m.color} leading-none`}>{m.v}</p>
                <p className="text-xs text-muted mt-1.5 font-medium leading-tight">{m.label}</p>
              </button>
            ))}
          </div>

          {/* ── Ações rápidas ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "Novo Processo", sub: "Criar e enviar documentos",
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
                cor: "bg-indigo-600 hover:bg-indigo-700", href: "/dashboard",
              },
              {
                label: "Enviar Documentos", sub: "Upload de PDFs para processo",
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>,
                cor: "bg-amber-500 hover:bg-amber-600", href: "/upload",
              },
              {
                label: "Revisão IA", sub: "Tarefas e análises pendentes",
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
                cor: "bg-violet-600 hover:bg-violet-700", href: "/revisao",
              },
              {
                label: "Agenda", sub: "Prazos e atendimentos",
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
                cor: "bg-emerald-600 hover:bg-emerald-700", href: "/agenda",
              },
            ].map(a => (
              <button key={a.label} onClick={() => router.push(a.href)}
                className={`${a.cor} text-white rounded-2xl p-4 text-left hover:shadow-lg hover:scale-[1.02] transition-all`}>
                <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center mb-2">
                  {a.icon}
                </div>
                <p className="text-sm font-bold">{a.label}</p>
                <p className="text-[11px] text-white/70 mt-0.5">{a.sub}</p>
              </button>
            ))}
          </div>

          {/* ── Jobs ── */}
          <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-bold text-text-main">Fila de Processamento</h2>
              <div className="flex items-center gap-2">
                {(["fila", "recentes"] as const).map(a => (
                  <button key={a} onClick={() => setAbaJobs(a)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${abaJobs === a ? "bg-gold/10 text-gold" : "text-muted hover:text-text-main"}`}>
                    {a === "fila" ? "Resumo da fila" : "Jobs recentes"}
                  </button>
                ))}
                <button onClick={carregar}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-text-main hover:bg-bg transition-colors">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={loading ? "animate-spin" : ""}>
                    <polyline points="1 4 1 10 7 10"/>
                    <path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
                  </svg>
                </button>
              </div>
            </div>

            {abaJobs === "fila" ? (
              <div className="p-5">
                {!filaStatus.length ? (
                  <div className="text-center py-10">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-2">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-text-main">Fila vazia</p>
                    <p className="text-xs text-muted mt-0.5">Nenhum job pendente</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {["Tipo", "Status", "Total", "Média (seg)", ""].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-[10px] font-bold text-muted uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filaStatus.map((f, i) => (
                        <tr key={i} className="hover:bg-bg transition-colors">
                          <td className="py-3 px-3 font-mono text-xs text-text-main">{f.tipo}</td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <JobStatusDot status={f.status} />
                              <span className="text-xs text-muted">{statusLabel[f.status] ?? f.status}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 font-bold text-text-main text-sm">{f.total}</td>
                          <td className="py-3 px-3 text-muted text-xs">—</td>
                          <td className="py-3 px-3 text-right"></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <div>
                {!jobs.length ? (
                  <p className="text-sm text-muted text-center py-10">Nenhum job encontrado.</p>
                ) : jobs.slice(0, 30).map(j => (
                  <div key={j.id} className="flex items-center gap-3 px-5 py-3 border-b border-border/50 last:border-0 hover:bg-bg transition-colors group">
                    <JobStatusDot status={j.status} />

                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-mono font-semibold text-text-main">{j.tipo}</span>
                      {j.erro_msg && (
                        <p className="text-[10px] text-red-500 truncate mt-0.5">{j.erro_msg}</p>
                      )}
                    </div>

                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      j.status === "concluido"   ? "bg-emerald-100 text-emerald-700"
                      : j.status === "erro"      ? "bg-red-100 text-red-700"
                      : j.status === "cancelado" ? "bg-gray-100 text-gray-600"
                      : j.status === "processando" ? "bg-amber-100 text-amber-700"
                      : "bg-blue-100 text-blue-700"
                    }`}>
                      {statusLabel[j.status] ?? j.status} · {j.tentativas}×
                    </span>

                    <span className="text-[10px] text-muted whitespace-nowrap flex-shrink-0">
                      {new Date(j.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>

                    {/* Ações */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      {(j.status === "pendente" || j.status === "processando") && (
                        <button
                          onClick={() => handleCancelarJob(j.id)}
                          disabled={deletando === j.id}
                          title="Cancelar job"
                          className="w-6 h-6 flex items-center justify-center rounded-lg text-amber-500 hover:bg-amber-50 transition-colors disabled:opacity-40">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <rect x="6" y="6" width="12" height="12"/>
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleDeletarJob(j.id)}
                        disabled={deletando === j.id}
                        title="Excluir job"
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 transition-colors disabled:opacity-40">
                        {deletando === j.id ? (
                          <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6"/><path d="M14 11v6"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-xl text-sm font-medium bg-slate-800 text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
