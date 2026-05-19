"use client";

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { api, type Processo } from "@/lib/api";

type FileStatus = "aguardando" | "processando" | "concluido" | "erro";

interface FileEntry {
  file: File;
  status: FileStatus;
  docId?: string;
  erro?: string;
  progresso: number;
  totalPaginas?: number;
  ocrUtilizado?: boolean;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: FileStatus }) {
  const map: Record<FileStatus, { label: string; cls: string }> = {
    aguardando:  { label: "Aguardando",  cls: "bg-warning/10 text-warning border-warning/20" },
    processando: { label: "Processando", cls: "bg-gold/10 text-gold border-gold/20" },
    concluido:   { label: "Concluído",   cls: "bg-success/10 text-success border-success/20" },
    erro:        { label: "Erro",        cls: "bg-danger/10 text-danger border-danger/20" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cls}`}>
      {status === "processando" && (
        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {label}
    </span>
  );
}

function UploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processoIdParam = searchParams.get("processo");

  const inputRef = useRef<HTMLInputElement>(null);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [processoId, setProcessoId] = useState<string>(processoIdParam ?? "");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    api.processos.listar().then(setProcessos).catch(() => { });
    if (processoIdParam) setProcessoId(processoIdParam);
  }, [processoIdParam]);

  function addFiles(files: FileList | File[]) {
    const pdfs = Array.from(files).filter(f => f.type === "application/pdf");
    if (!pdfs.length) { showToast("Apenas PDFs são aceitos.", "error"); return; }
    setEntries(prev => [...prev, ...pdfs.map(file => ({ file, status: "aguardando" as FileStatus, progresso: 0 }))]);
  }

  function updateEntry(i: number, patch: Partial<FileEntry>) {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  }

  async function pollStatus(processoId: string, docId: string, i: number) {
    const MAX = 60; let tentativas = 0;
    while (tentativas < MAX) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const s = await api.documentos.status(processoId, docId);
        if (s.status === "processado") {
          updateEntry(i, { status: "concluido", progresso: 100, totalPaginas: s.total_paginas, ocrUtilizado: s.ocr_utilizado });
          return;
        }
        if (s.status === "erro") {
          updateEntry(i, { status: "erro", erro: s.erro_msg ?? "Erro no processamento" });
          return;
        }
        updateEntry(i, { progresso: Math.min(20 + tentativas * 2, 90) });
      } catch {
        updateEntry(i, { status: "erro", erro: "Falha ao verificar status." });
        return;
      }
      tentativas++;
    }
    updateEntry(i, { status: "erro", erro: "Timeout — verifique o status mais tarde." });
  }

  async function iniciar() {
    if (!processoId) { showToast("Selecione um processo antes de enviar.", "error"); return; }
    const pendentes = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.status === "aguardando");
    if (!pendentes.length) { showToast("Nenhum arquivo aguardando.", "error"); return; }

    setProcessando(true);
    await Promise.all(pendentes.map(async ({ e, i }) => {
      updateEntry(i, { status: "processando", progresso: 5 });
      try {
        const doc = await api.documentos.upload(processoId, e.file);
        updateEntry(i, { progresso: 20, docId: doc.id });
        await pollStatus(processoId, doc.id, i);
      } catch (err) {
        updateEntry(i, { status: "erro", erro: err instanceof Error ? err.message : "Erro no upload" });
      }
    }));
    setProcessando(false);
  }

  const temAguardando = entries.some(e => e.status === "aguardando");
  const temConcluido  = entries.some(e => e.status === "concluido");

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 sm:ml-60 flex flex-col">
        <TopBar title="Enviar Documentos" subtitle="Adicione PDFs a um processo existente" />
        <main className="flex-1 p-8 space-y-6 max-w-3xl mx-auto w-full">

          {/* Seleção de processo */}
          <div className="bg-surface rounded-xl shadow-sm p-5">
            <label className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
              Processo de destino
            </label>
            <select
              value={processoId}
              onChange={e => setProcessoId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              <option value="">— Selecione um processo —</option>
              {processos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.numero_cnj ?? p.id.slice(0, 8) + "…"} {p.assunto ? `— ${p.assunto}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Drop zone */}
          <div
            onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => inputRef.current?.click()}
            className={`relative rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center py-14 px-8 text-center transition-all duration-200 ${dragging ? "border-gold bg-gold/10 scale-[1.01]" : "border-border hover:border-gold hover:bg-gold/5"}`}
          >
            <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden"
              onChange={e => e.target.files && addFiles(e.target.files)} />
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-colors ${dragging ? "bg-gold text-navy" : "bg-gold/10 text-gold"}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
              </svg>
            </div>
            <p className="text-base font-semibold text-text-main mb-1">
              {dragging ? "Solte aqui" : "Arraste seus PDFs"}
            </p>
            <p className="text-sm text-muted">
              ou <span className="text-gold font-medium underline underline-offset-2">clique para selecionar</span>
            </p>
            <p className="text-xs text-muted mt-2">Múltiplos arquivos · Max 50 MB cada</p>
          </div>

          {/* Lista de arquivos */}
          {entries.length > 0 && (
            <div className="bg-surface rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-main">Arquivos ({entries.length})</h2>
                {!processando && temAguardando && (
                  <button onClick={() => setEntries([])} className="text-xs text-muted hover:text-danger transition-colors">
                    Limpar
                  </button>
                )}
              </div>
              <ul className="divide-y divide-border">
                {entries.map((entry, i) => (
                  <li key={i} className="px-5 py-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-danger/10 flex items-center justify-center flex-shrink-0">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-danger">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-main truncate">{entry.file.name}</p>
                          <p className="text-xs text-muted">
                            {formatBytes(entry.file.size)}
                            {entry.totalPaginas && ` · ${entry.totalPaginas} pág.`}
                            {entry.ocrUtilizado && " · OCR aplicado"}
                            {entry.erro && <span className="ml-2 text-danger">{entry.erro}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <StatusBadge status={entry.status} />
                        {entry.status === "concluido" && (
                          <button onClick={() => router.push(`/processo/${processoId}`)}
                            className="text-xs font-semibold text-gold hover:text-gold-light px-3 py-1.5 rounded-lg hover:bg-gold/10 transition-all">
                            Ver Processo
                          </button>
                        )}
                        {entry.status === "aguardando" && (
                          <button onClick={() => setEntries(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-muted hover:text-danger p-1 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                          </button>
                        )}
                      </div>
                    </div>
                    {entry.status !== "aguardando" && (
                      <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${entry.status === "erro" ? "bg-danger" : "bg-gold"}`}
                          style={{ width: `${entry.progresso}%` }} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            {temAguardando && (
              <button onClick={iniciar} disabled={processando || !processoId}
                className="bg-gold text-navy font-semibold rounded-lg px-5 py-2.5 hover:bg-gold-light transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 text-sm">
                {processando ? (
                  <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>Processando...</>
                ) : "Enviar Documentos"}
              </button>
            )}
            {temConcluido && !temAguardando && (
              <button onClick={() => router.push(`/processo/${processoId}`)}
                className="text-sm font-medium text-gold hover:text-gold-light transition-colors">
                Ir para o Processo →
              </button>
            )}
          </div>
        </main>
      </div>
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg text-sm font-medium ${toast.type === "error" ? "bg-danger text-white" : "bg-success text-white"}`}>
          {toast.message}
          <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense>
      <UploadContent />
    </Suspense>
  );
}
