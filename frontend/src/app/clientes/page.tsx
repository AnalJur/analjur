"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type Cliente } from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtData(s?: string) {
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

// ── Form padrão ───────────────────────────────────────────────────────────

const FORM_VAZIO = {
  nome: "", tipo: "pf" as "pf" | "pj",
  cpf_cnpj: "", email: "", telefone: "", endereco: "", observacoes: "",
};

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
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface text-muted transition-colors text-lg">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Card do cliente ───────────────────────────────────────────────────────

function ClienteCard({ cliente, onEdit, onDelete, onClick }: {
  cliente: Cliente;
  onEdit: (c: Cliente) => void;
  onDelete: (c: Cliente) => void;
  onClick: (c: Cliente) => void;
}) {
  return (
    <div
      onClick={() => onClick(cliente)}
      className="bg-bg border border-border rounded-2xl p-5 hover:border-gold/40 hover:shadow-lg transition-all cursor-pointer group relative">

      {/* Ações — aparecem no hover */}
      <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); onEdit(cliente); }}
          title="Editar cliente"
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-surface border border-border hover:border-gold/40 hover:text-gold text-muted transition-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(cliente); }}
          title="Excluir cliente"
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-surface border border-border hover:border-red-400/50 hover:text-red-400 text-muted transition-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4 pr-16">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold flex-shrink-0 ${
          cliente.tipo === "pj" ? "bg-blue-100 text-blue-700" : "bg-gold/10 text-gold"
        }`}>
          {cliente.tipo === "pj" ? "🏢" : "👤"}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-main leading-tight truncate">{cliente.nome}</p>
          {cliente.cpf_cnpj && (
            <p className="text-xs text-muted mt-0.5">{fmtCpfCnpj(cliente.cpf_cnpj)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-surface rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-text-main">{cliente.total_processos}</p>
          <p className="text-xs text-muted mt-0.5">Processos</p>
        </div>
        <div className="bg-surface rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-gold">{cliente.processos_ativos}</p>
          <p className="text-xs text-muted mt-0.5">Ativos</p>
        </div>
      </div>

      <div className="space-y-1.5 text-xs text-muted">
        {cliente.email && (
          <p className="flex items-center gap-2 truncate">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 7L2 7"/></svg>
            <span className="truncate">{cliente.email}</span>
          </p>
        )}
        {cliente.telefone && (
          <p className="flex items-center gap-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6.03 6.03l1.88-1.88a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>{cliente.telefone}</span>
          </p>
        )}
        {cliente.ultima_movimentacao && (
          <p className="flex items-center gap-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>Última mov. {fmtData(cliente.ultima_movimentacao)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Formulário criar/editar ───────────────────────────────────────────────

function FormCliente({ inicial, onSalvar, onCancelar }: {
  inicial?: Partial<typeof FORM_VAZIO>;
  onSalvar: (form: typeof FORM_VAZIO) => Promise<void>;
  onCancelar: () => void;
}) {
  const [form, setForm] = useState({ ...FORM_VAZIO, ...inicial });
  const [salvando, setSalvando] = useState(false);

  function set(k: keyof typeof FORM_VAZIO, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.nome.trim()) return;
    setSalvando(true);
    try { await onSalvar(form); }
    finally { setSalvando(false); }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-muted mb-1">Nome / Razão Social *</label>
          <input
            autoFocus
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
            placeholder="Nome completo ou razão social"
            value={form.nome}
            onChange={e => set("nome", e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Tipo</label>
          <select
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
            value={form.tipo}
            onChange={e => set("tipo", e.target.value)}>
            <option value="pf">👤 Pessoa Física</option>
            <option value="pj">🏢 Pessoa Jurídica</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">
            {form.tipo === "pj" ? "CNPJ" : "CPF"}
          </label>
          <input
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
            placeholder={form.tipo === "pj" ? "00.000.000/0000-00" : "000.000.000-00"}
            value={form.cpf_cnpj}
            onChange={e => set("cpf_cnpj", e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">E-mail</label>
          <input type="email"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
            placeholder="email@exemplo.com"
            value={form.email}
            onChange={e => set("email", e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Telefone</label>
          <input
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
            placeholder="(11) 99999-9999"
            value={form.telefone}
            onChange={e => set("telefone", e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-muted mb-1">Endereço</label>
          <input
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40"
            placeholder="Rua, número, cidade — UF"
            value={form.endereco}
            onChange={e => set("endereco", e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-muted mb-1">Observações</label>
          <textarea rows={3}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-main focus:outline-none focus:ring-2 focus:ring-gold/40 resize-none"
            placeholder="Informações adicionais sobre o cliente…"
            value={form.observacoes}
            onChange={e => set("observacoes", e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-2 border-t border-border">
        <button onClick={onCancelar}
          className="text-sm border border-border rounded-lg px-4 py-2 text-muted hover:text-text-main hover:border-gold/40 transition-colors">
          Cancelar
        </button>
        <button onClick={submit} disabled={salvando || !form.nome.trim()}
          className="bg-gold text-navy font-semibold rounded-lg px-4 py-2 text-sm hover:bg-gold-light transition-all disabled:opacity-50">
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────

function ClientesInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [clientes, setClientes]     = useState<Cliente[]>([]);
  const [loading, setLoading]       = useState(true);
  const [busca, setBusca]           = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "pf" | "pj">("todos");
  const [modal, setModal]           = useState<"criar" | Cliente | null>(null);
  const [deletando, setDeletando]   = useState<string | null>(null);

  // Parâmetros da URL vindos do processo (DataJud ou upload)
  const paramNovo      = searchParams.get("novo");
  const paramNome      = searchParams.get("nome") ?? "";
  const paramProcesso  = searchParams.get("processo") ?? "";
  const paramPolo      = searchParams.get("polo") ?? "";

  const carregar = useCallback(() => {
    setLoading(true);
    api.clientes.listar()
      .then(setClientes)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Abre modal automaticamente se vier com ?novo=1
  useEffect(() => {
    if (paramNovo === "1") {
      setModal("criar");
    }
  }, [paramNovo]);

  const filtrados = clientes.filter(c => {
    const matchBusca = !busca ||
      c.nome.toLowerCase().includes(busca.toLowerCase()) ||
      (c.cpf_cnpj ?? "").includes(busca) ||
      (c.email ?? "").toLowerCase().includes(busca.toLowerCase());
    const matchTipo = filtroTipo === "todos" || c.tipo === filtroTipo;
    return matchBusca && matchTipo;
  });

  async function criar(form: typeof FORM_VAZIO) {
    const body = Object.fromEntries(
      Object.entries(form).filter(([, v]) => v !== "")
    ) as Partial<Cliente>;
    const novo = await api.clientes.criar(body);
    setClientes(prev => [novo, ...prev]);
    setModal(null);

    // Se veio de um processo (DataJud), vincula automaticamente e volta
    if (paramProcesso) {
      await api.clientes.vincularProcesso(novo.id, paramProcesso).catch(() => {});
      router.push(`/processo/${paramProcesso}`);
    }
  }

  async function atualizar(id: string, form: typeof FORM_VAZIO) {
    const body = Object.fromEntries(
      Object.entries(form).filter(([, v]) => v !== "")
    ) as Partial<Cliente>;
    const upd = await api.clientes.atualizar(id, body);
    setClientes(prev => prev.map(c => c.id === id ? upd : c));
    setModal(null);
  }

  async function deletar(c: Cliente) {
    if (!confirm(`Excluir cliente "${c.nome}"? Os processos vinculados serão desvinculados.`)) return;
    setDeletando(c.id);
    try {
      await api.clientes.deletar(c.id);
      setClientes(prev => prev.filter(x => x.id !== c.id));
    } finally { setDeletando(null); }
  }

  const totalAtivos = clientes.reduce((a, c) => a + c.processos_ativos, 0);
  const totalProcessos = clientes.reduce((a, c) => a + c.total_processos, 0);

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          title="Clientes"
          subtitle={`${clientes.length} cadastrados · ${totalProcessos} processos · ${totalAtivos} ativos`}
        />

        {/* Barra de ações */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-6 py-3 border-b border-border bg-surface flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button onClick={() => router.back()}
              className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-border/60 text-muted hover:text-text-main transition-all group flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="group-hover:-translate-x-0.5 transition-transform">
                <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
              </svg>
            </button>
            <div className="relative flex-1 min-w-40 max-w-md">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                className="w-full pl-8 pr-4 py-1.5 text-xs bg-bg border border-border rounded-lg text-text-main placeholder-muted focus:outline-none focus:ring-2 focus:ring-gold/40"
                placeholder="Buscar por nome, CPF/CNPJ, e-mail…"
                value={busca}
                onChange={e => setBusca(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1 bg-bg border border-border rounded-lg p-0.5">
              {(["todos", "pf", "pj"] as const).map(t => (
                <button key={t} onClick={() => setFiltroTipo(t)}
                  className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    filtroTipo === t ? "bg-gold text-navy" : "text-muted hover:text-text-main"
                  }`}>
                  {t === "todos" ? "Todos" : t === "pf" ? "PF" : "PJ"}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setModal("criar")}
            className="bg-gold text-navy font-bold rounded-lg px-4 py-1.5 text-xs hover:bg-gold-light transition-colors flex-shrink-0">
            + Novo Cliente
          </button>
        </div>

        <main className="flex-1 overflow-y-auto px-6 py-5">
        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-bg border border-border rounded-2xl p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 bg-surface rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-surface rounded w-3/4" />
                    <div className="h-2 bg-surface rounded w-1/2" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="h-14 bg-surface rounded-xl" />
                  <div className="h-14 bg-surface rounded-xl" />
                </div>
                <div className="space-y-2">
                  <div className="h-2 bg-surface rounded w-full" />
                  <div className="h-2 bg-surface rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-4xl mb-3">👥</p>
            <p className="text-base font-semibold text-text-main mb-1">
              {busca || filtroTipo !== "todos" ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
            </p>
            <p className="text-sm text-muted mb-6">
              {busca || filtroTipo !== "todos"
                ? "Tente ajustar os filtros"
                : "Cadastre o primeiro cliente para começar"}
            </p>
            {!busca && filtroTipo === "todos" && (
              <button onClick={() => setModal("criar")}
                className="bg-gold text-navy font-semibold rounded-xl px-5 py-2.5 text-sm hover:bg-gold-light transition-colors">
                + Cadastrar Primeiro Cliente
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtrados.map(c => (
              <ClienteCard
                key={c.id}
                cliente={c}
                onEdit={setModal}
                onDelete={deletar}
                onClick={c => router.push(`/clientes/${c.id}`)}
              />
            ))}
          </div>
        )}
        </main>
      </div>

      {/* Modal criar */}
      {modal === "criar" && (
        <Modal
          title={paramNome ? `Cadastrar: ${paramNome}` : "Novo Cliente"}
          onClose={() => setModal(null)}
        >
          {paramNome && (
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-amber-500">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>
                Identificado no DataJud como <strong>{paramNome}</strong>
                {paramPolo ? ` (Polo ${paramPolo === "ATIVO" ? "Ativo" : "Passivo"})` : ""}.
                {paramProcesso ? " Após salvar, será vinculado ao processo automaticamente." : ""}
              </span>
            </div>
          )}
          <FormCliente
            inicial={{ nome: paramNome }}
            onSalvar={criar}
            onCancelar={() => setModal(null)}
          />
        </Modal>
      )}

      {/* Modal editar */}
      {modal && modal !== "criar" && (
        <Modal title="Editar Cliente" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <FormCliente
              inicial={{
                nome: modal.nome, tipo: modal.tipo,
                cpf_cnpj: modal.cpf_cnpj ?? "", email: modal.email ?? "",
                telefone: modal.telefone ?? "", endereco: modal.endereco ?? "",
                observacoes: modal.observacoes ?? "",
              }}
              onSalvar={form => atualizar(modal.id, form)}
              onCancelar={() => setModal(null)}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function ClientesPage() {
  return (
    <Suspense>
      <ClientesInner />
    </Suspense>
  );
}
