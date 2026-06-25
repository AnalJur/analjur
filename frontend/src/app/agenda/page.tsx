"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { api, type EventoAgenda, type AgendaResult } from "@/lib/api";

// ── Constantes ────────────────────────────────────────────────────────────

const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES  = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

// ── Cores ─────────────────────────────────────────────────────────────────

const COR: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  red:    { bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200",    dot: "bg-red-500" },
  orange: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
  yellow: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200", dot: "bg-yellow-500" },
  green:  { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200",  dot: "bg-green-500" },
  blue:   { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200",   dot: "bg-blue-500" },
  purple: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500" },
  gray:   { bg: "bg-gray-50",   text: "text-gray-500",   border: "border-gray-200",   dot: "bg-gray-400" },
};

const TIPO_ICON: Record<string, string> = {
  prazo:       "⏰",
  atendimento: "📋",
  tarefa:      "⚡",
};

const TIPO_ATEND_LABEL: Record<string, string> = {
  presencial:       "Presencial",
  videoconferencia: "Videoconferência",
  telefone:         "Telefone",
  email:            "E-mail",
};

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtHora(min: number) {
  const h = Math.floor(min / 60); const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? `${m}min` : ""}` : `${m}min`;
}

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

// ── Chip de evento no grid ────────────────────────────────────────────────

function EventoChip({ e, onClick }: { e: EventoAgenda; onClick: () => void }) {
  const c = COR[e.cor] ?? COR.gray;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left text-[10px] font-medium truncate px-1.5 py-0.5 rounded ${c.bg} ${c.text} hover:opacity-80 transition-opacity`}>
      {TIPO_ICON[e.tipo]} {e.titulo}
    </button>
  );
}

// ── Painel lateral — detalhe do dia ──────────────────────────────────────

function PainelDia({
  data, eventos, onFechar,
}: {
  data: string; eventos: EventoAgenda[]; onFechar: () => void;
}) {
  const router = useRouter();
  const [, m, d] = data.split("-").map(Number);
  const titulo   = `${d} de ${MESES[m - 1]}`;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <div>
          <p className="text-xs text-muted uppercase tracking-wide font-semibold">Agenda</p>
          <p className="text-base font-bold text-text-main">{titulo}</p>
        </div>
        <button onClick={onFechar}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface text-muted text-xl transition-colors">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {eventos.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-3xl mb-2">✓</p>
            <p className="text-sm font-semibold text-text-main mb-1">Dia livre</p>
            <p className="text-xs text-muted">Nenhum evento agendado</p>
          </div>
        ) : (
          eventos.map(e => {
            const c = COR[e.cor] ?? COR.gray;
            return (
              <div key={e.id}
                className={`rounded-xl border ${c.border} ${c.bg} p-3 space-y-1.5`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-base flex-shrink-0">{TIPO_ICON[e.tipo]}</span>
                    <p className={`text-sm font-semibold leading-tight ${c.text}`}>
                      {e.titulo}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${c.bg} ${c.text} border ${c.border} flex-shrink-0`}>
                    {e.tipo}
                  </span>
                </div>

                {/* Processo vinculado */}
                {e.numero_cnj && (
                  <button
                    onClick={() => e.processo_id && router.push(`/processo/${e.processo_id}`)}
                    className="text-xs text-muted hover:text-gold transition-colors text-left truncate w-full font-mono">
                    ↗ {e.numero_cnj}
                    {e.assunto && <span className="font-sans font-normal ml-1 text-muted">· {e.assunto}</span>}
                  </button>
                )}

                {/* Extras por tipo */}
                {e.tipo === "atendimento" && e.extra && (
                  <p className="text-xs text-muted">
                    {e.extra.tipo_atend && TIPO_ATEND_LABEL[e.extra.tipo_atend]}
                    {e.extra.duracao_min && ` · ${fmtHora(e.extra.duracao_min)}`}
                    {e.descricao && ` · ${e.descricao}`}
                  </p>
                )}
                {e.tipo === "prazo" && e.descricao && (
                  <p className="text-xs text-muted line-clamp-2">{e.descricao}</p>
                )}
                {e.tipo === "prazo" && (
                  <p className={`text-xs font-semibold ${c.text}`}>
                    {e.status === "cumprido" ? "✓ Cumprido"
                      : e.status === "vencido" ? "⚠ Vencido"
                      : `Prioridade: ${e.prioridade}`}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Célula do dia no grid ─────────────────────────────────────────────────

function CelulaDia({
  date: dateStr, diaMes, isHoje, isMesAtual, eventos, selecionado, onClick,
}: {
  date: string;
  diaMes: number;
  isHoje: boolean;
  isMesAtual: boolean;
  eventos: EventoAgenda[];
  selecionado: boolean;
  onClick: () => void;
}) {
  const MAX_CHIPS = 3;
  const visiveis  = eventos.slice(0, MAX_CHIPS);
  const resto     = eventos.length - MAX_CHIPS;

  return (
    <div
      onClick={onClick}
      className={`min-h-[90px] p-1.5 border-b border-r border-border cursor-pointer transition-colors
        ${selecionado ? "bg-gold/5" : "hover:bg-surface"}
        ${!isMesAtual ? "opacity-40" : ""}`}>
      {/* Número do dia */}
      <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold mb-1 mx-0.5
        ${isHoje ? "bg-gold text-navy" : "text-text-main"}`}>
        {diaMes}
      </div>

      {/* Chips de eventos */}
      <div className="space-y-0.5">
        {visiveis.map(e => (
          <EventoChip key={e.id} e={e} onClick={onClick} />
        ))}
        {resto > 0 && (
          <p className="text-[10px] text-muted px-1.5">+{resto} mais</p>
        )}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────

export default function AgendaPage() {
  const hoje_s = hoje();
  const [ano, setAno]       = useState(() => new Date().getFullYear());
  const [mes, setMes]       = useState(() => new Date().getMonth()); // 0-indexed
  const [dados, setDados]   = useState<AgendaResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [diaSel, setDiaSel] = useState<string | null>(hoje_s);
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "prazo" | "atendimento" | "tarefa">("todos");

  // Primeiro e último dia do mês exibido (com margem para semanas parciais)
  const { inicio, fim, diasGrid } = useMemo(() => {
    const primeiro = new Date(ano, mes, 1);
    const ultimo   = new Date(ano, mes + 1, 0);

    // Início = domingo da semana do dia 1
    const ini = new Date(primeiro);
    ini.setDate(ini.getDate() - ini.getDay());

    // Fim = sábado da semana do último dia (mínimo 5 semanas = 35 dias)
    const f = new Date(ultimo);
    f.setDate(f.getDate() + (6 - f.getDay()));
    if ((f.getTime() - ini.getTime()) / 86400000 < 34) {
      f.setDate(f.getDate() + 7);
    }

    const dias: { date: string; diaMes: number; isMesAtual: boolean }[] = [];
    const cur = new Date(ini);
    while (cur <= f) {
      dias.push({
        date:        cur.toISOString().slice(0, 10),
        diaMes:      cur.getDate(),
        isMesAtual:  cur.getMonth() === mes && cur.getFullYear() === ano,
      });
      cur.setDate(cur.getDate() + 1);
    }

    return {
      inicio:   ini.toISOString().slice(0, 10),
      fim:      f.toISOString().slice(0, 10),
      diasGrid: dias,
    };
  }, [ano, mes]);

  const carregar = useCallback(() => {
    setLoading(true);
    api.agenda.listar(inicio, fim)
      .then(setDados)
      .finally(() => setLoading(false));
  }, [inicio, fim]);

  useEffect(() => { carregar(); }, [carregar]);

  // Mapa data → eventos
  const eventosPorDia = useMemo(() => {
    const m: Record<string, EventoAgenda[]> = {};
    for (const e of dados?.eventos ?? []) {
      if (!e.data) continue;
      if (filtroTipo !== "todos" && e.tipo !== filtroTipo) continue;
      if (!m[e.data]) m[e.data] = [];
      m[e.data].push(e);
    }
    return m;
  }, [dados, filtroTipo]);

  const eventosDiaSel = diaSel ? (eventosPorDia[diaSel] ?? []) : [];

  function navMes(delta: number) {
    const d = new Date(ano, mes + delta, 1);
    setAno(d.getFullYear());
    setMes(d.getMonth());
    setDiaSel(null);
  }

  const resumo = dados?.resumo;

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar />
      <div className="flex-1 sm:ml-0 flex flex-col min-w-0 overflow-hidden">
        <TopBar title="Agenda" subtitle="Prazos · Atendimentos · Tarefas" />

        <main className="flex-1 flex flex-col overflow-hidden p-4 sm:p-6 gap-4">

          {/* Cards de resumo */}
          {resumo && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
              {[
                { label: "Prazos no mês",    value: resumo.total_prazos,       cor: "text-text-main", icon: "⏰" },
                { label: "Prazos críticos",  value: resumo.prazos_criticos,    cor: "text-red-600",   icon: "🔴" },
                { label: "Atendimentos",     value: resumo.total_atendimentos, cor: "text-blue-600",  icon: "📋" },
                { label: "Tarefas c/ prazo", value: resumo.total_tarefas,      cor: "text-purple-600",icon: "⚡" },
              ].map(c => (
                <div key={c.label}
                  className="bg-bg border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                  <span className="text-2xl">{c.icon}</span>
                  <div>
                    <p className={`text-xl font-bold ${c.cor}`}>{c.value}</p>
                    <p className="text-xs text-muted">{c.label}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Calendário + Painel */}
          <div className="flex-1 flex gap-4 min-h-0">
            {/* Calendário */}
            <div className="flex-1 bg-bg border border-border rounded-2xl flex flex-col overflow-hidden min-w-0">
              {/* Header do calendário */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-3">
                  <button onClick={() => navMes(-1)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface text-muted hover:text-text-main transition-colors text-lg font-bold">
                    ‹
                  </button>
                  <h2 className="text-base font-bold text-text-main min-w-[160px] text-center">
                    {MESES[mes]} {ano}
                  </h2>
                  <button onClick={() => navMes(1)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface text-muted hover:text-text-main transition-colors text-lg font-bold">
                    ›
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* Filtro por tipo */}
                  <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-0.5">
                    {(["todos", "prazo", "atendimento", "tarefa"] as const).map(t => (
                      <button key={t}
                        onClick={() => setFiltroTipo(t)}
                        className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors capitalize ${
                          filtroTipo === t ? "bg-gold text-navy" : "text-muted hover:text-text-main"
                        }`}>
                        {t === "todos" ? "Todos" : `${TIPO_ICON[t]} ${t}`}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const now = new Date();
                      setAno(now.getFullYear()); setMes(now.getMonth());
                      setDiaSel(hoje_s);
                    }}
                    className="text-xs font-semibold text-gold hover:text-gold-light border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/5 transition-colors">
                    Hoje
                  </button>
                </div>
              </div>

              {/* Dias da semana */}
              <div className="grid grid-cols-7 border-b border-border flex-shrink-0">
                {SEMANA.map(s => (
                  <div key={s}
                    className="text-center text-[10px] font-bold text-muted uppercase tracking-wide py-2 border-r border-border last:border-r-0">
                    {s}
                  </div>
                ))}
              </div>

              {/* Grid de dias */}
              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-7">
                    {diasGrid.map(({ date: d, diaMes, isMesAtual }) => (
                      <CelulaDia
                        key={d}
                        date={d}
                        diaMes={diaMes}
                        isHoje={d === hoje_s}
                        isMesAtual={isMesAtual}
                        eventos={eventosPorDia[d] ?? []}
                        selecionado={diaSel === d}
                        onClick={() => setDiaSel(diaSel === d ? null : d)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Legenda */}
              <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border flex-shrink-0 flex-wrap">
                {[
                  { cor: "red",    label: "Vencido / Crítico" },
                  { cor: "orange", label: "Urgente (≤7d)" },
                  { cor: "yellow", label: "Atenção (≤15d)" },
                  { cor: "green",  label: "Em dia" },
                  { cor: "blue",   label: "Atendimento" },
                  { cor: "purple", label: "Tarefa" },
                ].map(({ cor, label }) => (
                  <div key={cor} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${COR[cor].dot}`} />
                    <span className="text-[10px] text-muted">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Painel lateral do dia selecionado */}
            {diaSel && (
              <div className="w-72 bg-bg border border-border rounded-2xl flex-shrink-0 overflow-hidden flex flex-col">
                <PainelDia
                  data={diaSel}
                  eventos={eventosDiaSel}
                  onFechar={() => setDiaSel(null)}
                />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
