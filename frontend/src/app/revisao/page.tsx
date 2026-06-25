"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { api, type TarefaRevisao } from "@/lib/api";

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, string> = {
    pendente:   "bg-yellow-100 text-yellow-700",
    em_revisao: "bg-blue-100 text-blue-700",
    aprovado:   "bg-green-100 text-green-700",
    rejeitado:  "bg-red-100 text-red-700",
    cancelado:  "bg-gray-100 text-gray-500",
  };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[s] ?? "bg-gray-100 text-gray-500"}`}>{s}</span>;
}

export default function RevisaoPage() {
  const [tarefas, setTarefas] = useState<TarefaRevisao[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState("pendente");

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const t = await api.revisao.tarefas(filtroStatus || undefined);
      setTarefas(t);
    } finally {
      setLoading(false);
    }
  }, [filtroStatus]);

  useEffect(() => { carregar(); }, [carregar]);

  async function atualizar(id: string, status: string) {
    const comentario = status === "rejeitado" ? (prompt("Comentário:") ?? "") : undefined;
    const t = await api.revisao.atualizar(id, { status, comentario });
    setTarefas(prev => prev.map(x => x.id === id ? t : x));
  }

  const priorCls: Record<string, string> = {
    urgente: "text-red-600 font-bold",
    alta:    "text-orange-500 font-semibold",
    normal:  "text-muted",
    baixa:   "text-green-600",
  };

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 sm:ml-0 flex flex-col">
        <TopBar title="Revisão Humana" subtitle="Validação obrigatória antes de uso externo" />
        <main className="flex-1 p-8 space-y-6">
          <div className="flex gap-2">
            {["pendente", "em_revisao", "aprovado", "rejeitado", ""].map(s => (
              <button key={s} onClick={() => setFiltroStatus(s)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${filtroStatus === s ? "border-gold bg-gold/10 text-gold" : "border-border text-muted hover:border-gold/50"}`}>
                {s || "Todos"}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <svg className="animate-spin h-6 w-6 text-gold" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : !tarefas.length ? (
            <div className="text-center py-20 text-muted text-sm">
              {filtroStatus === "pendente" ? "Nenhuma tarefa pendente." : "Nenhuma tarefa neste status."}
            </div>
          ) : (
            <div className="space-y-3">
              {tarefas.map(t => (
                <div key={t.id} className="bg-surface rounded-xl border border-border p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs uppercase ${priorCls[t.prioridade]}`}>{t.prioridade}</span>
                        <StatusBadge s={t.status} />
                        <span className="text-xs text-muted bg-bg border border-border px-2 py-0.5 rounded-full">{t.tipo}</span>
                      </div>
                      <p className="text-sm font-bold text-text-main">{t.titulo}</p>
                      {t.descricao && <p className="text-xs text-muted mt-1">{t.descricao}</p>}
                      <div className="flex items-center gap-4 mt-2">
                        {t.deadline && (
                          <p className="text-xs text-orange-500">Prazo: {new Date(t.deadline).toLocaleDateString("pt-BR")}</p>
                        )}
                        <Link href={`/processo/${t.atribuido_para ?? ""}`} className="text-xs text-gold hover:underline">
                          Ver processo
                        </Link>
                      </div>
                    </div>
                    {t.status === "pendente" && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => atualizar(t.id, "aprovado")}
                          className="text-xs font-semibold text-green-600 px-4 py-2 rounded-lg border border-green-200 hover:bg-green-50 transition-all">
                          Aprovar
                        </button>
                        <button onClick={() => atualizar(t.id, "rejeitado")}
                          className="text-xs font-semibold text-red-600 px-4 py-2 rounded-lg border border-red-200 hover:bg-red-50 transition-all">
                          Rejeitar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
