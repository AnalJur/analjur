"use client";

import { useEffect, useState } from "react";
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
  return <span className={`inline-block w-2 h-2 rounded-full ${cls[status] ?? "bg-gray-300"}`} />;
}

export default function AdminPage() {
  const [dash, setDash] = useState<DashboardAdmin | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filaStatus, setFilaStatus] = useState<{ tipo: string; status: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [abaJobs, setAbaJobs] = useState<"recentes" | "fila">("fila");

  useEffect(() => {
    Promise.all([
      api.admin.dashboard(),
      api.jobs.listar(),
      api.jobs.filaStatus(),
    ]).then(([d, j, f]) => {
      setDash(d);
      setJobs(j);
      setFilaStatus(f);
    }).finally(() => setLoading(false));
  }, []);

  const metricCards = dash ? [
    { label: "Processos",            v: dash.total_processos,            color: "text-navy" },
    { label: "Documentos processados",v: dash.total_documentos,           color: "text-navy" },
    { label: "Tarefas pendentes",    v: dash.tarefas_pendentes,           color: dash.tarefas_pendentes > 0 ? "text-yellow-600" : "text-navy" },
    { label: "Análises p/ revisão",  v: dash.analises_pendentes_revisao,  color: dash.analises_pendentes_revisao > 0 ? "text-orange-600" : "text-navy" },
  ] : [];

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 ml-60 flex flex-col">
        <TopBar title="Operações" subtitle="Dashboard operacional e fila de jobs" />
        <main className="flex-1 p-8 space-y-8">
          {/* Métricas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {loading ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface rounded-xl border border-border p-6 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-1/2 mb-3" />
                <div className="h-8 bg-gray-200 rounded w-1/3" />
              </div>
            )) : metricCards.map(m => (
              <div key={m.label} className="bg-surface rounded-xl border border-border p-6">
                <p className="text-xs text-muted mb-1">{m.label}</p>
                <p className={`text-3xl font-bold ${m.color}`}>{m.v}</p>
              </div>
            ))}
          </div>

          {/* Jobs */}
          <div className="bg-surface rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-main">Fila de Processamento</h2>
              <div className="flex gap-2">
                {(["fila", "recentes"] as const).map(a => (
                  <button key={a} onClick={() => setAbaJobs(a)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${abaJobs === a ? "bg-gold/10 text-gold" : "text-muted hover:text-text-main"}`}>
                    {a === "fila" ? "Resumo da fila" : "Jobs recentes"}
                  </button>
                ))}
              </div>
            </div>

            {abaJobs === "fila" ? (
              <div className="p-6">
                {!filaStatus.length ? (
                  <p className="text-sm text-muted text-center py-8">Fila vazia.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {["Tipo", "Status", "Total", "Avg (seg)"].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-muted uppercase tracking-wider">{h}</th>
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
                              <span className="text-xs">{f.status}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 font-semibold text-text-main">{f.total}</td>
                          <td className="py-3 px-3 text-muted text-xs">—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {!jobs.length ? (
                  <p className="text-sm text-muted text-center py-8">Nenhum job.</p>
                ) : jobs.slice(0, 20).map(j => (
                  <div key={j.id} className="flex items-center gap-4 px-6 py-3">
                    <JobStatusDot status={j.status} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-mono text-text-main">{j.tipo}</span>
                      {j.erro_msg && <p className="text-xs text-red-500 truncate">{j.erro_msg}</p>}
                    </div>
                    <div className="text-xs text-muted">
                      {j.status} · tentativa {j.tentativas}
                    </div>
                    <div className="text-xs text-muted whitespace-nowrap">
                      {new Date(j.created_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
