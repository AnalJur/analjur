"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { api, type Cliente } from "@/lib/api";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Honorario {
  id: string;
  cliente_id: string;
  processo_id?: string;
  tipo: "fixo" | "exito" | "parcelas" | "hora";
  descricao?: string;
  valor_total: number;
  percentual_exito?: number;
  valor_causa?: number;
  status: "ativo" | "quitado" | "suspenso" | "cancelado";
  data_inicio: string;
  data_fim?: string;
  observacoes?: string;
  created_at: string;
  clientes?: { nome: string };
  processos?: { numero_cnj?: string; assunto?: string };
}

interface Parcela {
  id: string;
  honorario_id: string;
  cliente_id: string;
  processo_id?: string;
  numero_parcela: number;
  valor: number;
  vencimento: string;
  status: "pendente" | "pago" | "vencido" | "cancelado";
  data_pagamento?: string;
  valor_pago?: number;
  forma_pagamento?: string;
  observacoes?: string;
}

interface Dashboard {
  total_contratado: number;
  total_recebido: number;
  total_pendente: number;
  total_vencido: number;
  valor_proximos_30d: number;
  qtd_proximos_30d: number;
  valor_timesheet_acumulado: number;
  taxa_inadimplencia: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(d?: string) {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR");
}

function diasAte(vencimento: string) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const v = new Date(vencimento + "T00:00:00");
  return Math.floor((v.getTime() - hoje.getTime()) / 86_400_000);
}

const TIPO_LABEL: Record<string, string> = {
  fixo: "Fixo", exito: "Êxito", parcelas: "Parcelado", hora: "Por Hora",
};
const STATUS_LABEL: Record<string, string> = {
  ativo: "Ativo", quitado: "Quitado", suspenso: "Suspenso", cancelado: "Cancelado",
  pendente: "Pendente", pago: "Pago", vencido: "Vencido",
};

// ── Modal: Novo Honorário ─────────────────────────────────────────────────────

function ModalNovoHonorario({ onClose, onCriado }: {
  onClose: () => void;
  onCriado: (h: Honorario) => void;
}) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [processos, setProcessos] = useState<{ id: string; numero_cnj?: string; assunto?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    cliente_id: "", processo_id: "", tipo: "fixo",
    descricao: "", valor_total: "", num_parcelas: "1",
    percentual_exito: "", valor_causa: "", observacoes: "",
    data_inicio: new Date().toISOString().split("T")[0],
  });

  useEffect(() => {
    api.clientes.listar().then(setClientes).catch(() => {});
    api.processos.listar().then(setProcessos).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.cliente_id) return alert("Selecione um cliente.");
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/financeiro/honorarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("analjur_token")}` },
        body: JSON.stringify({
          cliente_id:       form.cliente_id,
          processo_id:      form.processo_id || undefined,
          tipo:             form.tipo,
          descricao:        form.descricao || undefined,
          valor_total:      parseFloat(form.valor_total) || 0,
          num_parcelas:     parseInt(form.num_parcelas) || 1,
          percentual_exito: form.percentual_exito ? parseFloat(form.percentual_exito) : undefined,
          valor_causa:      form.valor_causa ? parseFloat(form.valor_causa) : undefined,
          data_inicio:      form.data_inicio,
          observacoes:      form.observacoes || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const h = await res.json();
      onCriado(h);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao criar honorário");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40 placeholder-muted";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="bg-navy px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <div>
            <p className="text-white font-bold">Novo Honorário</p>
            <p className="text-white/50 text-xs mt-0.5">Contrato de honorários advocatícios</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Cliente *</label>
            <select className={inputCls} value={form.cliente_id} onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}>
              <option value="">— Selecione —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Processo (opcional)</label>
            <select className={inputCls} value={form.processo_id} onChange={e => setForm(f => ({ ...f, processo_id: e.target.value }))}>
              <option value="">— Sem processo —</option>
              {processos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.numero_cnj ?? p.id.slice(0, 8)} {p.assunto ? `— ${p.assunto}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Tipo *</label>
              <select className={inputCls} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                <option value="fixo">Fixo</option>
                <option value="parcelas">Parcelado</option>
                <option value="exito">Êxito</option>
                <option value="hora">Por Hora</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Data início</label>
              <input type="date" className={inputCls} value={form.data_inicio}
                onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Descrição</label>
            <input className={inputCls} placeholder="Ex: Honorários contratuais — Ação de Indenização"
              value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Valor total (R$)</label>
              <input type="number" step="0.01" min="0" className={inputCls} placeholder="0,00"
                value={form.valor_total} onChange={e => setForm(f => ({ ...f, valor_total: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Nº de parcelas</label>
              <input type="number" min="1" max="60" className={inputCls}
                value={form.num_parcelas} onChange={e => setForm(f => ({ ...f, num_parcelas: e.target.value }))} />
            </div>
          </div>
          {form.tipo === "exito" && (
            <div className="grid grid-cols-2 gap-3 bg-violet-50 border border-violet-200 rounded-xl p-3">
              <div>
                <label className="block text-xs font-semibold text-violet-700 mb-1.5">% Êxito</label>
                <input type="number" step="0.1" min="0" max="100" className={inputCls} placeholder="20"
                  value={form.percentual_exito} onChange={e => setForm(f => ({ ...f, percentual_exito: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-violet-700 mb-1.5">Valor da causa (R$)</label>
                <input type="number" step="0.01" min="0" className={inputCls} placeholder="0,00"
                  value={form.valor_causa} onChange={e => setForm(f => ({ ...f, valor_causa: e.target.value }))} />
              </div>
            </div>
          )}
          {form.valor_total && parseInt(form.num_parcelas) > 1 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
              <span className="font-bold">{form.num_parcelas}× </span>
              de {fmtBRL(parseFloat(form.valor_total) / parseInt(form.num_parcelas))} mensais
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Observações</label>
            <textarea rows={2} className={inputCls + " resize-none"} placeholder="Condições especiais, prazo de pagamento…"
              value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-border rounded-xl py-2.5 text-sm font-semibold text-muted hover:bg-bg transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl py-2.5 text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : null}
              {loading ? "Criando…" : "Criar Honorário"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal: Registrar Pagamento ────────────────────────────────────────────────

function ModalPagamento({ parcela, onClose, onPago }: {
  parcela: Parcela;
  onClose: () => void;
  onPago: (p: Parcela) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    valor_pago: parcela.valor.toString(),
    data_pagamento: new Date().toISOString().split("T")[0],
    forma_pagamento: "pix",
    observacoes: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/financeiro/parcelas/${parcela.id}/pagar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("analjur_token")}` },
        body: JSON.stringify({
          valor_pago: parseFloat(form.valor_pago),
          data_pagamento: form.data_pagamento,
          forma_pagamento: form.forma_pagamento,
          observacoes: form.observacoes || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onPago(await res.json());
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao registrar pagamento");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="bg-emerald-600 px-5 py-4 rounded-t-2xl flex items-center justify-between">
          <div>
            <p className="text-white font-bold">Registrar Pagamento</p>
            <p className="text-white/70 text-xs mt-0.5">Parcela {parcela.numero_parcela} · venc. {fmtData(parcela.vencimento)}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Valor pago (R$)</label>
            <input type="number" step="0.01" min="0" className={inputCls}
              value={form.valor_pago} onChange={e => setForm(f => ({ ...f, valor_pago: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Data</label>
              <input type="date" className={inputCls}
                value={form.data_pagamento} onChange={e => setForm(f => ({ ...f, data_pagamento: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Forma</label>
              <select className={inputCls} value={form.forma_pagamento} onChange={e => setForm(f => ({ ...f, forma_pagamento: e.target.value }))}>
                {["pix", "ted", "boleto", "dinheiro", "cartao", "outro"].map(f => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Observações</label>
            <input className={inputCls} placeholder="Comprovante, referência…"
              value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-border rounded-xl py-2.5 text-sm font-semibold text-muted hover:bg-bg transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-emerald-600 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-emerald-700 transition-all disabled:opacity-50">
              {loading ? "Registrando…" : "Confirmar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Linha de honorário com parcelas ──────────────────────────────────────────

function HonorarioRow({ h, onParcelaPaga }: { h: Honorario; onParcelaPaga: () => void }) {
  const [expandido, setExpandido] = useState(false);
  const [parcelas, setParcelas]   = useState<Parcela[]>([]);
  const [loadingParcelas, setLoadingParcelas] = useState(false);
  const [modalPag, setModalPag]   = useState<Parcela | null>(null);

  async function carregarParcelas() {
    if (expandido) { setExpandido(false); return; }
    setLoadingParcelas(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/financeiro/honorarios/${h.id}/parcelas`,
        { headers: { Authorization: `Bearer ${localStorage.getItem("analjur_token")}` } }
      );
      setParcelas(await res.json());
      setExpandido(true);
    } finally {
      setLoadingParcelas(false);
    }
  }

  const pagas   = parcelas.filter(p => p.status === "pago").length;
  const vencidas = parcelas.filter(p => p.status === "vencido").length;

  const statusCorH: Record<string, string> = {
    ativo:     "bg-emerald-100 text-emerald-700",
    quitado:   "bg-blue-100 text-blue-700",
    suspenso:  "bg-amber-100 text-amber-700",
    cancelado: "bg-gray-100 text-gray-500",
  };

  return (
    <>
      <div
        onClick={carregarParcelas}
        className="flex items-center gap-4 px-5 py-4 hover:bg-bg transition-colors cursor-pointer group border-b border-border/50 last:border-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-main truncate">
              {h.clientes?.nome ?? "—"}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusCorH[h.status] ?? "bg-gray-100 text-gray-500"}`}>
              {STATUS_LABEL[h.status]}
            </span>
            <span className="text-[10px] font-semibold text-muted px-2 py-0.5 rounded-full bg-bg border border-border">
              {TIPO_LABEL[h.tipo]}
            </span>
          </div>
          {h.descricao && <p className="text-xs text-muted mt-0.5 truncate">{h.descricao}</p>}
          {h.processos?.numero_cnj && (
            <p className="text-[10px] text-muted/60 mt-0.5 font-mono">{h.processos.numero_cnj}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-base font-bold text-text-main">{fmtBRL(h.valor_total)}</p>
          <p className="text-[10px] text-muted mt-0.5">desde {fmtData(h.data_inicio)}</p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-muted transition-transform flex-shrink-0 ${expandido ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {expandido && (
        <div className="bg-bg/50 border-b border-border">
          {loadingParcelas ? (
            <div className="py-4 text-center text-xs text-muted">Carregando parcelas…</div>
          ) : parcelas.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted">Sem parcelas.</div>
          ) : (
            <>
              {vencidas > 0 && (
                <div className="mx-4 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-semibold flex items-center gap-2">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {vencidas} parcela{vencidas > 1 ? "s" : ""} vencida{vencidas > 1 ? "s" : ""}
                </div>
              )}
              <div className="p-4 grid gap-2">
                {parcelas.map(p => {
                  const dias = diasAte(p.vencimento);
                  const corStatus: Record<string, string> = {
                    pago:      "border-emerald-200 bg-emerald-50",
                    vencido:   "border-red-300 bg-red-50",
                    cancelado: "border-gray-200 bg-gray-50",
                    pendente:  dias <= 7 ? "border-amber-300 bg-amber-50" : "border-border bg-surface",
                  };
                  const corTexto: Record<string, string> = {
                    pago: "text-emerald-700", vencido: "text-red-600",
                    cancelado: "text-gray-400", pendente: dias <= 7 ? "text-amber-700" : "text-text-main",
                  };
                  return (
                    <div key={p.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${corStatus[p.status] ?? "border-border"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-muted">#{p.numero_parcela}</span>
                          <span className={`text-sm font-bold ${corTexto[p.status]}`}>{fmtBRL(p.valor)}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            p.status === "pago"      ? "bg-emerald-100 text-emerald-700"
                            : p.status === "vencido" ? "bg-red-100 text-red-700"
                            : p.status === "cancelado" ? "bg-gray-100 text-gray-500"
                            : "bg-amber-100 text-amber-700"
                          }`}>{STATUS_LABEL[p.status]}</span>
                        </div>
                        <p className="text-[10px] text-muted mt-0.5">
                          {p.status === "pago"
                            ? `Pago em ${fmtData(p.data_pagamento)} via ${p.forma_pagamento ?? "—"}`
                            : p.status === "vencido"
                            ? `Venceu ${fmtData(p.vencimento)} (${Math.abs(dias)}d atrás)`
                            : `Vence ${fmtData(p.vencimento)}${dias >= 0 ? ` (${dias}d)` : ""}`
                          }
                        </p>
                      </div>
                      {(p.status === "pendente" || p.status === "vencido") && (
                        <button
                          onClick={e => { e.stopPropagation(); setModalPag(p); }}
                          className="text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors px-3 py-1.5 rounded-lg flex-shrink-0">
                          Registrar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {parcelas.length > 0 && (
                <div className="px-5 pb-3 flex items-center gap-3 text-xs text-muted border-t border-border pt-2">
                  <span className="text-emerald-600 font-semibold">{pagas} pago{pagas !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span>{parcelas.length - pagas} restante{parcelas.length - pagas !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span className="font-semibold">{fmtBRL(parcelas.filter(p => p.status === "pago").reduce((s, p) => s + (p.valor_pago ?? p.valor), 0))} recebido</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {modalPag && (
        <ModalPagamento
          parcela={modalPag}
          onClose={() => setModalPag(null)}
          onPago={updated => {
            setParcelas(prev => prev.map(p => p.id === updated.id ? updated : p));
            setModalPag(null);
            onParcelaPaga();
          }}
        />
      )}
    </>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function FinanceiroPage() {
  const router = useRouter();
  const [dash, setDash]         = useState<Dashboard | null>(null);
  const [honorarios, setHonorarios] = useState<Honorario[]>([]);
  const [parcelas30, setParcelas30] = useState<Parcela[]>([]);
  const [loading, setLoading]   = useState(true);
  const [modalNovo, setModalNovo] = useState(false);
  const [aba, setAba]           = useState<"honorarios" | "proximas" | "inadimplencia">("proximas");
  const [toast, setToast]       = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 3500);
  }, []);

  const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const authH = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("analjur_token") : ""}`,
  }), []);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, honRes, parRes] = await Promise.all([
        fetch(`${BASE}/financeiro/dashboard`, { headers: authH() }).then(r => r.json()),
        fetch(`${BASE}/financeiro/honorarios`, { headers: authH() }).then(r => r.json()),
        fetch(`${BASE}/financeiro/parcelas?status=pendente&vencimento_ate=${new Date(Date.now() + 30*86400000).toISOString().split("T")[0]}`, { headers: authH() }).then(r => r.json()),
      ]);
      setDash(dashRes);
      setHonorarios(Array.isArray(honRes) ? honRes : []);
      setParcelas30(Array.isArray(parRes) ? parRes : []);
    } catch {
      showToast("Erro ao carregar dados financeiros");
    } finally {
      setLoading(false);
    }
  }, [BASE, authH, showToast]);

  useEffect(() => { carregar(); }, [carregar]);

  // KPI cards
  const kpis = dash ? [
    {
      label: "Contratado",
      value: fmtBRL(dash.total_contratado),
      sub: "total em contratos",
      from: "from-[#042f1e]", to: "to-[#065f39]",
      accent: "text-emerald-300",
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
    },
    {
      label: "Recebido",
      value: fmtBRL(dash.total_recebido),
      sub: "efetivamente pago",
      from: "from-[#0f2447]", to: "to-[#1a3a6b]",
      accent: "text-blue-300",
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    },
    {
      label: "A receber (30d)",
      value: fmtBRL(dash.valor_proximos_30d),
      sub: `${dash.qtd_proximos_30d} parcela${dash.qtd_proximos_30d !== 1 ? "s" : ""}`,
      from: "from-[#3b1700]", to: "to-[#7c3200]",
      accent: "text-amber-300",
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    },
    {
      label: "Inadimplência",
      value: fmtBRL(dash.total_vencido),
      sub: `${dash.taxa_inadimplencia}% do total`,
      from: dash.total_vencido > 0 ? "from-[#3b0000]" : "from-[#042f1e]",
      to:   dash.total_vencido > 0 ? "to-[#7c0000]"   : "to-[#065f39]",
      accent: dash.total_vencido > 0 ? "text-red-300" : "text-emerald-300",
      alert: dash.total_vencido > 0,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    },
  ] : [];

  const parcelasVencidas = parcelas30.filter(p => {
    if (!p.vencimento) return false;
    return new Date(p.vencimento + "T00:00:00") < new Date();
  });

  return (
    <div className="flex h-screen bg-[#eef0f4] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar title="Financeiro" subtitle="Honorários, parcelas e recebimentos" />

        <div className="flex-1 overflow-hidden flex flex-col gap-3 p-3">

          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-4 gap-3 flex-shrink-0">
            {loading ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-slate-700 rounded-2xl p-4 animate-pulse h-24" />
            )) : kpis.map(k => (
              <div key={k.label}
                className={`relative bg-gradient-to-br ${k.from} ${k.to} rounded-2xl p-4 overflow-hidden`}>
                {k.alert && (
                  <span className="absolute top-2.5 right-2.5 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75"/>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400"/>
                  </span>
                )}
                <div className={`${k.accent} mb-2 opacity-80`}>{k.icon}</div>
                <p className="text-white text-lg font-bold leading-none">{k.value}</p>
                <p className={`text-[11px] font-semibold mt-1 ${k.accent} opacity-70`}>{k.sub}</p>
                <p className="text-white/40 text-[10px] mt-0.5 uppercase tracking-wide">{k.label}</p>
              </div>
            ))}
          </div>

          {/* ── Corpo ── */}
          <div className="flex-1 overflow-hidden grid grid-cols-5 gap-3 min-h-0">

            {/* ── Honorários / Tabs ── */}
            <div className="col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              {/* Header */}
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                <div className="flex gap-1">
                  {([
                    { id: "proximas", label: "Próximas" },
                    { id: "honorarios", label: "Contratos" },
                    { id: "inadimplencia", label: "Vencidas" },
                  ] as const).map(a => (
                    <button key={a.id} onClick={() => setAba(a.id)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${aba === a.id ? "bg-emerald-50 text-emerald-700" : "text-slate-400 hover:text-slate-700"}`}>
                      {a.label}
                      {a.id === "inadimplencia" && parcelasVencidas.length > 0 && (
                        <span className="ml-1.5 text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                          {parcelasVencidas.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <button onClick={() => setModalNovo(true)}
                  className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold rounded-lg px-3 py-1.5 text-xs hover:brightness-110 transition-all shadow-sm">
                  + Honorário
                </button>
              </div>

              {/* Conteúdo */}
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <svg className="animate-spin h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  </div>
                ) : aba === "honorarios" ? (
                  honorarios.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-emerald-500">
                          <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-700">Nenhum honorário</p>
                        <p className="text-xs text-slate-400 mt-0.5">Crie o primeiro contrato de honorários</p>
                      </div>
                      <button onClick={() => setModalNovo(true)}
                        className="bg-emerald-500 text-white font-semibold rounded-lg px-4 py-2 text-xs hover:bg-emerald-600 transition-all">
                        Criar honorário
                      </button>
                    </div>
                  ) : (
                    honorarios.map(h => (
                      <HonorarioRow key={h.id} h={h} onParcelaPaga={() => { carregar(); showToast("Pagamento registrado!"); }} />
                    ))
                  )
                ) : aba === "proximas" ? (
                  parcelas30.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                      <p className="text-xs font-semibold text-slate-600">Sem vencimentos nos próximos 30 dias</p>
                    </div>
                  ) : (
                    <div className="p-4 space-y-2">
                      {parcelas30.map(p => {
                        const dias = diasAte(p.vencimento);
                        return (
                          <div key={p.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${
                            dias < 0 ? "border-red-200 bg-red-50"
                            : dias <= 3 ? "border-amber-200 bg-amber-50"
                            : "border-slate-200 bg-white"
                          }`}>
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              dias < 0 ? "bg-red-500" : dias <= 3 ? "bg-amber-500" : "bg-emerald-400"
                            }`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-slate-800 truncate">
                                Parcela {p.numero_parcela}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {fmtData(p.vencimento)} · {dias < 0 ? `${Math.abs(dias)}d vencida` : dias === 0 ? "HOJE" : `${dias}d`}
                              </p>
                            </div>
                            <span className="text-sm font-bold text-slate-800 flex-shrink-0">{fmtBRL(p.valor)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  // Inadimplência
                  parcelasVencidas.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                      <p className="text-xs font-semibold text-slate-600">Sem parcelas vencidas</p>
                    </div>
                  ) : (
                    <div className="p-4 space-y-2">
                      {parcelasVencidas.map(p => (
                        <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-red-200 bg-red-50">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500 flex-shrink-0">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                          </svg>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-red-800">Parcela {p.numero_parcela}</p>
                            <p className="text-[10px] text-red-600">Venceu {fmtData(p.vencimento)} — {Math.abs(diasAte(p.vencimento))}d atrás</p>
                          </div>
                          <span className="text-sm font-bold text-red-700 flex-shrink-0">{fmtBRL(p.valor)}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>

            {/* ── Coluna direita: Timesheet + Ações ── */}
            <div className="col-span-2 flex flex-col gap-3 min-h-0 overflow-hidden">

              {/* Timesheet acumulado */}
              {dash && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex-shrink-0">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-violet-600">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700">Timesheet Acumulado</p>
                      <p className="text-[10px] text-slate-400">Horas lançadas com valor</p>
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-slate-800">{fmtBRL(dash.valor_timesheet_acumulado)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">em horas trabalhadas nos processos</p>
                  {dash.valor_timesheet_acumulado > 0 && (
                    <button
                      onClick={() => {
                        // Navega para o dashboard para escolher o processo
                        showToast("Abra um processo e use 'Gerar honorário do timesheet' na aba Financeiro");
                      }}
                      className="mt-3 w-full text-xs font-bold text-violet-600 border border-violet-200 rounded-xl py-2 hover:bg-violet-50 transition-colors">
                      Ver por processo →
                    </button>
                  )}
                </div>
              )}

              {/* Resumo rápido */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex-shrink-0">
                <p className="text-xs font-bold text-slate-700 mb-3">Resumo</p>
                <div className="space-y-2">
                  {[
                    { label: "Total contratado",    v: dash?.total_contratado ?? 0,    cor: "text-slate-800" },
                    { label: "Já recebido",         v: dash?.total_recebido ?? 0,      cor: "text-emerald-600" },
                    { label: "Pendente",            v: dash?.total_pendente ?? 0,       cor: "text-amber-600" },
                    { label: "Em atraso",           v: dash?.total_vencido ?? 0,        cor: "text-red-600" },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">{r.label}</span>
                      <span className={`text-xs font-bold ${r.cor}`}>{fmtBRL(r.v)}</span>
                    </div>
                  ))}
                  {dash && dash.total_contratado > 0 && (
                    <>
                      <div className="h-px bg-slate-100 my-1" />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Recebido / Contratado</span>
                        <span className="text-xs font-bold text-slate-700">
                          {Math.round((dash.total_recebido / dash.total_contratado) * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full"
                          style={{ width: `${Math.min(100, (dash.total_recebido / dash.total_contratado) * 100)}%` }} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Ações rápidas */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex-shrink-0">
                <p className="text-xs font-bold text-slate-700 mb-3">Ações</p>
                <div className="space-y-2">
                  {[
                    { label: "Clientes",    icon: "👥", href: "/clientes" },
                    { label: "Dashboard",   icon: "📊", href: "/dashboard" },
                    { label: "Agenda",      icon: "📅", href: "/agenda" },
                  ].map(a => (
                    <button key={a.label} onClick={() => router.push(a.href)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-slate-50 transition-all text-left">
                      <span className="text-base">{a.icon}</span>
                      <span className="text-xs font-semibold text-slate-600">{a.label}</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto text-slate-300">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {modalNovo && (
        <ModalNovoHonorario
          onClose={() => setModalNovo(false)}
          onCriado={h => {
            setHonorarios(prev => [h, ...prev]);
            setModalNovo(false);
            showToast("Honorário criado e parcelas geradas!");
            carregar();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-xl text-sm font-medium bg-slate-800 text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
