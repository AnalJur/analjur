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
  partes?: string[];
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ── Combobox de busca de processo ─────────────────────────────────────────

function ProcessoCombobox({ processos, value, onChange }: {
  processos: Processo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery]   = useState("");
  const [open, setOpen]     = useState(false);
  const ref                 = useRef<HTMLDivElement>(null);

  const selected = processos.find(p => p.id === value);

  useEffect(() => {
    if (selected) setQuery(selected.numero_cnj ?? selected.id.slice(0, 8));
  }, [selected]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtrados = processos.filter(p => {
    const q = query.toLowerCase();
    return (
      p.numero_cnj?.toLowerCase().includes(q) ||
      p.assunto?.toLowerCase().includes(q) ||
      p.tribunal?.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q)
    );
  }).slice(0, 12);

  function select(p: Processo) {
    onChange(p.id);
    setQuery(p.numero_cnj ?? p.id.slice(0, 8));
    setOpen(false);
  }

  function clear() { onChange(""); setQuery(""); setOpen(false); }

  return (
    <div ref={ref} className="relative">
      <div className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 bg-bg transition-all ${open ? "border-gold ring-2 ring-gold/20" : "border-border hover:border-gold/40"}`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted flex-shrink-0">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          className="flex-1 text-sm bg-transparent text-text-main placeholder-muted focus:outline-none"
          placeholder="Buscar processo por número, assunto, tribunal…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(""); }}
          onFocus={() => setOpen(true)}
        />
        {value && (
          <button onClick={clear} className="text-muted hover:text-danger transition-colors flex-shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
        {value && (
          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex-shrink-0">
            Selecionado
          </span>
        )}
      </div>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 right-0 z-50 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
          {filtrados.length === 0 ? (
            <p className="text-xs text-muted text-center py-4">Nenhum processo encontrado</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto divide-y divide-border/50">
              {filtrados.map(p => (
                <li key={p.id}>
                  <button onClick={() => select(p)}
                    className="w-full text-left px-4 py-3 hover:bg-gold/5 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="w-1 h-8 rounded-full bg-gold/30 group-hover:bg-gold flex-shrink-0 transition-colors" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-main font-mono truncate">
                          {p.numero_cnj ?? p.id.slice(0, 8) + "…"}
                        </p>
                        <p className="text-xs text-muted truncate mt-0.5">
                          {[p.assunto, p.tribunal, p.vara].filter(Boolean).join(" · ") || "Sem detalhes"}
                        </p>
                      </div>
                      {p.cliente_nome && (
                        <span className="text-[10px] text-gold bg-gold/10 px-2 py-0.5 rounded-full flex-shrink-0">{p.cliente_nome}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Painel pós-processamento ───────────────────────────────────────────────

function PainelProximosPassos({ processoId, partes, onNovaAnalise }: {
  processoId: string;
  partes: string[];
  onNovaAnalise: () => void;
}) {
  const router = useRouter();

  const acoes = [
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ),
      label: "Analisar com IA",
      sub: "Extrai riscos, prazos e estratégias",
      cor: "from-violet-600 to-purple-700",
      onClick: () => router.push(`/processo/${processoId}?tab=analises`),
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
      label: "Lançar tempo",
      sub: "Registre as horas deste trabalho",
      cor: "from-amber-500 to-amber-600",
      onClick: () => router.push(`/processo/${processoId}?tab=revisao`),
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>
          <line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
      ),
      label: "Ver cronologia",
      sub: "Movimentações e histórico",
      cor: "from-blue-500 to-blue-700",
      onClick: () => router.push(`/processo/${processoId}?tab=cronologia`),
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      ),
      label: "Abrir processo",
      sub: "Visão completa do processo",
      cor: "from-slate-600 to-slate-800",
      onClick: () => router.push(`/processo/${processoId}`),
    },
  ];

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-5 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div>
          <p className="text-white font-bold text-sm">Documento processado com sucesso!</p>
          <p className="text-emerald-100 text-xs mt-0.5">O que deseja fazer agora?</p>
        </div>
      </div>

      {/* Partes identificadas */}
      {partes.length > 0 && (
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex items-start gap-2.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500 flex-shrink-0 mt-0.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <div className="min-w-0">
            <p className="text-xs font-bold text-amber-700 mb-1">Partes identificadas no documento</p>
            <div className="flex flex-wrap gap-1.5">
              {partes.map((p, i) => (
                <span key={i} className="text-[11px] bg-white border border-amber-200 text-amber-800 px-2.5 py-1 rounded-full font-medium">
                  {p}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-amber-600 mt-1.5">
              💡 Acesse o processo para vincular um cliente com estas partes
            </p>
          </div>
        </div>
      )}

      {/* Ações */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {acoes.map(a => (
          <button key={a.label} onClick={a.onClick}
            className={`bg-gradient-to-br ${a.cor} text-white rounded-xl p-4 text-left hover:brightness-110 hover:scale-[1.02] transition-all shadow-sm group`}>
            <div className="mb-2 opacity-90">{a.icon}</div>
            <p className="text-sm font-bold leading-tight">{a.label}</p>
            <p className="text-[11px] text-white/70 mt-1 leading-snug">{a.sub}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────

function UploadContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const processoIdParam = searchParams.get("processo");

  const inputRef = useRef<HTMLInputElement>(null);
  const [processos, setProcessos]     = useState<Processo[]>([]);
  const [processoId, setProcessoId]   = useState<string>(processoIdParam ?? "");
  const [entries, setEntries]         = useState<FileEntry[]>([]);
  const [dragging, setDragging]       = useState(false);
  const [processando, setProcessando] = useState(false);
  const [toast, setToast]             = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [partesDetectadas, setPartesDetectadas] = useState<string[]>([]);

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    api.processos.listar().then(setProcessos).catch(() => {});
    if (processoIdParam) setProcessoId(processoIdParam);
  }, [processoIdParam]);

  function addFiles(files: FileList | File[]) {
    const pdfs = Array.from(files).filter(f => f.type === "application/pdf");
    if (!pdfs.length) { showToast("Apenas PDFs são aceitos.", "error"); return; }
    setEntries(prev => [...prev, ...pdfs.map(f => ({ file: f, status: "aguardando" as FileStatus, progresso: 0 }))]);
  }

  function updateEntry(i: number, patch: Partial<FileEntry>) {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  }

  async function pollStatus(pId: string, docId: string, i: number) {
    const MAX = 60; let t = 0;
    while (t < MAX) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const s = await api.documentos.status(pId, docId);
        if (s.status === "processado") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const meta = s as any;
          const partes: string[] = [];
          if (meta.cabecalho) {
            const c = meta.cabecalho as Record<string, string>;
            if (c.autor)      partes.push(c.autor);
            if (c.reu)        partes.push(c.reu);
            if (c.requerente) partes.push(c.requerente);
            if (c.requerido)  partes.push(c.requerido);
          }
          updateEntry(i, { status: "concluido", progresso: 100, totalPaginas: s.total_paginas, ocrUtilizado: s.ocr_utilizado, partes });
          if (partes.length) setPartesDetectadas(partes);
          return;
        }
        if (s.status === "erro") {
          updateEntry(i, { status: "erro", erro: s.erro_msg ?? "Erro no processamento" });
          return;
        }
        updateEntry(i, { progresso: Math.min(20 + t * 2, 90) });
      } catch {
        updateEntry(i, { status: "erro", erro: "Falha ao verificar status." });
        return;
      }
      t++;
    }
    updateEntry(i, { status: "erro", erro: "Timeout — verifique o status mais tarde." });
  }

  async function iniciar() {
    if (!processoId) { showToast("Selecione um processo antes de enviar.", "error"); return; }
    const pendentes = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.status === "aguardando");
    if (!pendentes.length) { showToast("Nenhum arquivo aguardando.", "error"); return; }

    setProcessando(true);
    setPartesDetectadas([]);
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
  const todosConcluidos = entries.length > 0 && !temAguardando && !processando && temConcluido;

  const processoSelecionado = processos.find(p => p.id === processoId);

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar title="Enviar Documentos" subtitle="Adicione PDFs a um processo existente" />

        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-4">

            {/* ── Seleção de processo ── */}
            <div className="bg-surface rounded-2xl border border-border p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-indigo-600">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <p className="text-xs font-bold text-text-main uppercase tracking-wider">1. Selecione o processo</p>
              </div>
              <ProcessoCombobox processos={processos} value={processoId} onChange={setProcessoId} />
              {processoSelecionado && (
                <div className="mt-2.5 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-indigo-800 truncate">
                      {processoSelecionado.numero_cnj ?? processoSelecionado.id.slice(0, 8)}
                    </p>
                    {processoSelecionado.assunto && (
                      <p className="text-[10px] text-indigo-600 truncate">{processoSelecionado.assunto}</p>
                    )}
                  </div>
                  {processoSelecionado.cliente_nome && (
                    <span className="text-[10px] text-gold bg-gold/10 px-2 py-0.5 rounded-full flex-shrink-0 ml-auto">
                      {processoSelecionado.cliente_nome}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ── Drop zone ── */}
            <div className="bg-surface rounded-2xl border border-border p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-600">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <p className="text-xs font-bold text-text-main uppercase tracking-wider">2. Adicione os PDFs</p>
              </div>
              <div
                onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onClick={() => inputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center py-10 px-8 text-center transition-all ${dragging ? "border-gold bg-gold/8 scale-[1.01]" : "border-border hover:border-gold hover:bg-gold/5"}`}>
                <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden"
                  onChange={e => e.target.files && addFiles(e.target.files)} />
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 transition-colors ${dragging ? "bg-gold text-navy" : "bg-gold/10 text-gold"}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                  </svg>
                </div>
                <p className="text-sm font-semibold text-text-main">{dragging ? "Solte aqui" : "Arraste seus PDFs"}</p>
                <p className="text-xs text-muted mt-1">ou <span className="text-gold font-semibold underline underline-offset-2">clique para selecionar</span></p>
                <p className="text-[10px] text-muted mt-2">Múltiplos arquivos · Max 50 MB cada</p>
              </div>
            </div>

            {/* ── Lista de arquivos ── */}
            {entries.length > 0 && (
              <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <p className="text-xs font-bold text-text-main uppercase tracking-wider">
                    Arquivos ({entries.length})
                  </p>
                  {!processando && temAguardando && (
                    <button onClick={() => setEntries([])} className="text-xs text-muted hover:text-danger transition-colors">
                      Limpar
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-border">
                  {entries.map((entry, i) => (
                    <li key={i} className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        {/* Ícone status */}
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          entry.status === "concluido" ? "bg-emerald-100" :
                          entry.status === "erro"      ? "bg-red-100" :
                          entry.status === "processando" ? "bg-amber-100" : "bg-slate-100"
                        }`}>
                          {entry.status === "concluido" ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-600"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : entry.status === "erro" ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-red-500"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          ) : entry.status === "processando" ? (
                            <svg className="animate-spin w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-main truncate">{entry.file.name}</p>
                          <p className="text-xs text-muted">
                            {formatBytes(entry.file.size)}
                            {entry.totalPaginas && ` · ${entry.totalPaginas} págs`}
                            {entry.ocrUtilizado && " · OCR"}
                            {entry.erro && <span className="ml-2 text-red-500">{entry.erro}</span>}
                          </p>
                        </div>
                        {entry.status === "aguardando" && (
                          <button onClick={() => setEntries(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-muted hover:text-danger p-1 transition-colors flex-shrink-0">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        )}
                      </div>
                      {entry.status === "processando" && (
                        <div className="mt-2 h-1 bg-bg rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full transition-all duration-500"
                            style={{ width: `${entry.progresso}%` }} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {/* Botão enviar */}
                {temAguardando && (
                  <div className="px-5 py-4 border-t border-border bg-bg/50">
                    <button onClick={iniciar} disabled={processando || !processoId}
                      className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold rounded-xl py-3 text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm">
                      {processando ? (
                        <>
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Processando…
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          Enviar e processar {entries.filter(e => e.status === "aguardando").length} arquivo{entries.filter(e => e.status === "aguardando").length > 1 ? "s" : ""}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Próximos passos (pós-processamento) ── */}
            {todosConcluidos && processoId && (
              <PainelProximosPassos
                processoId={processoId}
                partes={partesDetectadas}
                onNovaAnalise={() => {}}
              />
            )}

          </div>
        </main>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-xl text-sm font-medium ${toast.type === "error" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}`}>
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
