const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? "Erro na API");
  }
  return res.json() as Promise<T>;
}

// ── Tipos ────────────────────────────────────────────────────────────────

export interface Processo {
  id: string;
  numero_cnj?: string;
  tribunal?: string;
  vara?: string;
  assunto?: string;
  status: string;
  tags: string[];
  responsavel?: string;
  total_documentos: number;
  total_pecas: number;
  total_chunks: number;
  tarefas_pendentes: number;
  analises_pendentes: number;
  ultimo_upload?: string;
  ultimo_snapshot?: string;
  created_at: string;
  updated_at: string;
}

export interface Documento {
  id: string;
  nome_original: string;
  tamanho_bytes?: number;
  total_paginas?: number;
  ocr_utilizado: boolean;
  status: string;
  erro_msg?: string;
  uploaded_at: string;
  processado_at?: string;
}

export interface Peca {
  id: string;
  tipo_peca: string;
  pagina_inicio: number;
  pagina_fim: number;
  data_documento?: string;
  autor?: string;
  resumo?: string;
  confianca_classificacao?: number;
  created_at: string;
}

export interface EventoCronologia {
  id: string;
  data_evento?: string;
  data_aproximada: boolean;
  tipo_evento: string;
  descricao: string;
  relevancia: "baixa" | "media" | "alta" | "critica";
  fonte: string;
  validado: boolean;
}

export interface Snapshot {
  id: string;
  versao: number;
  trigger: string;
  resumo_mudancas?: string;
  estado_json: Record<string, unknown>;
  created_at: string;
}

export interface Analise {
  id: string;
  tipo: string;
  conteudo_json: Record<string, unknown>;
  modelo_ia: string;
  confianca?: number;
  status_revisao: string;
  revisado_at?: string;
  tokens_input?: number;
  tokens_output?: number;
  created_at: string;
}

export interface TarefaRevisao {
  id: string;
  tipo: string;
  titulo: string;
  descricao?: string;
  status: string;
  prioridade: string;
  deadline?: string;
  atribuido_para?: string;
  comentario?: string;
  created_at: string;
  updated_at: string;
}

export interface Minuta {
  id: string;
  tipo: string;
  titulo: string;
  conteudo_md: string;
  versao: number;
  status: string;
  confianca?: number;
  fontes_json: unknown[];
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  tipo: string;
  status: string;
  tentativas: number;
  erro_msg?: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}

export interface DashboardAdmin {
  total_processos: number;
  total_documentos: number;
  tarefas_pendentes: number;
  analises_pendentes_revisao: number;
}

// ── API client ────────────────────────────────────────────────────────────

export const api = {
  processos: {
    listar: (status?: string) =>
      req<Processo[]>(`/processos${status ? `?status=${status}` : ""}`),
    criar: (body: Partial<Processo>) =>
      req<Processo>("/processos", { method: "POST", body: JSON.stringify(body) }),
    obter: (id: string) => req<Processo>(`/processos/${id}`),
    atualizar: (id: string, body: Partial<Processo>) =>
      req<Processo>(`/processos/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deletar: (id: string) => req<void>(`/processos/${id}`, { method: "DELETE" }),
  },

  documentos: {
    listar: (processoId: string) =>
      req<Documento[]>(`/processos/${processoId}/documentos`),
    upload: async (processoId: string, file: File): Promise<Documento> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE}/processos/${processoId}/documentos`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error((err as { detail?: string }).detail ?? "Erro no upload");
      }
      return res.json() as Promise<Documento>;
    },
    status: (processoId: string, docId: string) =>
      req<{ id: string; status: string; total_paginas?: number; ocr_utilizado: boolean; erro_msg?: string }>(
        `/processos/${processoId}/documentos/${docId}/status`
      ),
    deletar: (processoId: string, docId: string) =>
      req<void>(`/processos/${processoId}/documentos/${docId}`, { method: "DELETE" }),
    pecas: (processoId: string, docId: string) =>
      req<Peca[]>(`/processos/${processoId}/documentos/${docId}/pecas`),
  },

  cronologia: {
    listar: (processoId: string) =>
      req<EventoCronologia[]>(`/processos/${processoId}/cronologia`),
    validar: (processoId: string, eventoId: string) =>
      req<EventoCronologia>(`/processos/${processoId}/cronologia/${eventoId}/validar`, {
        method: "PATCH",
      }),
  },

  snapshots: {
    listar: (processoId: string) =>
      req<Snapshot[]>(`/processos/${processoId}/snapshots`),
    criar: (processoId: string) =>
      req<Snapshot>(`/processos/${processoId}/snapshots`, { method: "POST" }),
    obter: (processoId: string, snapId: string) =>
      req<Snapshot>(`/processos/${processoId}/snapshots/${snapId}`),
    comparar: (processoId: string, snapA: string, snapB: string) =>
      req<Record<string, unknown>>(
        `/processos/${processoId}/snapshots/comparar/${snapA}/${snapB}`
      ),
  },

  analises: {
    listar: (processoId: string, tipo?: string) =>
      req<Analise[]>(`/processos/${processoId}/analises${tipo ? `?tipo=${tipo}` : ""}`),
    solicitar: (processoId: string, tipo: string, contexto_extra?: string) =>
      req<Analise>(`/processos/${processoId}/analises`, {
        method: "POST",
        body: JSON.stringify({ tipo, contexto_extra }),
      }),
    aprovar: (processoId: string, analiseId: string, comentario?: string) =>
      req<Analise>(`/processos/${processoId}/analises/${analiseId}/aprovar`, {
        method: "POST",
        body: JSON.stringify({ comentario }),
      }),
    rejeitar: (processoId: string, analiseId: string, comentario: string) =>
      req<Analise>(`/processos/${processoId}/analises/${analiseId}/rejeitar`, {
        method: "POST",
        body: JSON.stringify({ comentario }),
      }),
    chat: (
      processoId: string,
      mensagens: { role: string; content: string }[],
      tipo_peca?: string
    ) =>
      req<{ resposta: string; fontes: unknown[]; tokens: number }>(
        `/processos/${processoId}/analises/chat`,
        {
          method: "POST",
          body: JSON.stringify({ processo_id: processoId, mensagens, tipo_peca }),
        }
      ),
  },

  revisao: {
    tarefas: (status?: string, processoId?: string) =>
      req<TarefaRevisao[]>(
        `/revisao/tarefas?${status ? `status=${status}&` : ""}${processoId ? `processo_id=${processoId}` : ""}`
      ),
    atualizar: (tarefaId: string, body: { status?: string; comentario?: string }) =>
      req<TarefaRevisao>(`/revisao/tarefas/${tarefaId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    resumo: () =>
      req<{ status: string; prioridade: string; total: number }[]>("/revisao/resumo"),
  },

  minutas: {
    listar: (processoId: string) =>
      req<Minuta[]>(`/processos/${processoId}/minutas`),
    solicitar: (processoId: string, tipo: string, titulo: string, instrucoes?: string) =>
      req<Minuta>(`/processos/${processoId}/minutas`, {
        method: "POST",
        body: JSON.stringify({ tipo, titulo, instrucoes }),
      }),
    editar: (
      processoId: string,
      minutaId: string,
      body: { conteudo_md?: string; status?: string }
    ) =>
      req<Minuta>(`/processos/${processoId}/minutas/${minutaId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  },

  jobs: {
    listar: (status?: string) =>
      req<Job[]>(`/jobs${status ? `?status=${status}` : ""}`),
    filaStatus: () =>
      req<{ tipo: string; status: string; total: number; avg_seg?: number }[]>(
        "/jobs/fila/status"
      ),
  },

  admin: {
    dashboard: () => req<DashboardAdmin>("/admin/dashboard"),
    audit: (entidade?: string, limit?: number) =>
      req<unknown[]>(
        `/admin/audit?${entidade ? `entidade=${entidade}&` : ""}limit=${limit ?? 50}`
      ),
  },
};
