"""
Gerador de relatório jurídico profissional em HTML (pronto para impressão/PDF).

Rota: GET /processos/{processo_id}/relatorio
Retorna: text/html — abre direto no browser, Ctrl+P para PDF.
"""

import uuid
import asyncio
import json
from datetime import date, datetime, timezone, timedelta
from html import escape
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from ..database import get_supabase, sb_run

router = APIRouter(tags=["Relatório"])

# ── Helpers ───────────────────────────────────────────────────────────────

def _fmt_data(s: Optional[str]) -> str:
    if not s:
        return "—"
    try:
        d = date.fromisoformat(s[:10])
        return d.strftime("%d/%m/%Y")
    except Exception:
        return s[:10]


def _esc(v) -> str:
    if v is None:
        return "—"
    return escape(str(v))


def _relev_label(r: str) -> str:
    return {"critica": "Crítica", "alta": "Alta", "media": "Média", "baixa": "Baixa"}.get(r, r.capitalize())


def _relev_cor(r: str) -> str:
    return {"critica": "#dc2626", "alta": "#ea580c", "media": "#ca8a04", "baixa": "#16a34a"}.get(r, "#6b7280")


def _tipo_peca_label(t: str) -> str:
    return t.replace("_", " ").title()


def _render_val(v, depth: int = 0) -> str:
    """Renderiza um valor JSON como HTML legível."""
    if v is None or v == "":
        return "<em style='color:#9ca3af'>—</em>"
    if isinstance(v, bool):
        return "Sim" if v else "Não"
    if isinstance(v, (int, float)):
        return _esc(v)
    if isinstance(v, str):
        return _esc(v).replace("\n", "<br>")
    if isinstance(v, list):
        if not v:
            return "<em style='color:#9ca3af'>Nenhum</em>"
        if all(isinstance(x, str) for x in v):
            items = "".join(f"<li>{_esc(x)}</li>" for x in v)
            return f"<ul style='margin:4px 0 4px 16px;padding:0'>{items}</ul>"
        return "".join(
            f"<div style='border-left:3px solid #e5e7eb;margin:6px 0;padding-left:10px'>{_render_val(x, depth+1)}</div>"
            for x in v
        )
    if isinstance(v, dict):
        rows = ""
        for k, val in v.items():
            label = k.replace("_", " ").upper()
            rows += (
                f"<div style='margin:6px 0'>"
                f"<span style='font-size:10pt;font-weight:bold;color:#6b7280;display:block;letter-spacing:.4px'>{_esc(label)}</span>"
                f"{_render_val(val, depth+1)}"
                f"</div>"
            )
        return rows
    return _esc(str(v))


# ── Seções por tipo de análise ─────────────────────────────────────────────

_SECAO_LABEL: dict[str, str] = {
    "estado_atual":          "Situação Atual",
    "resumo_executivo":      "Resumo Executivo",
    "riscos":                "Análise de Riscos",
    "teses":                 "Teses Jurídicas",
    "estrategia_vencedora":  "Estratégia Vencedora",
    "diagnostico_completo":  "Diagnóstico Completo",
    "proximos_passos":       "Próximos Passos",
    "impacto_atualizacao":   "Impacto de Atualização",
}

_SECAO_EMOJI: dict[str, str] = {
    "estado_atual":         "📋",
    "resumo_executivo":     "📌",
    "riscos":               "⚠️",
    "teses":                "⚖️",
    "estrategia_vencedora": "🏆",
    "diagnostico_completo": "🔬",
    "proximos_passos":      "🗺️",
    "impacto_atualizacao":  "📡",
}

# Ordem de exibição preferencial
_SECAO_ORDEM = [
    "resumo_executivo", "estado_atual", "diagnostico_completo",
    "estrategia_vencedora", "riscos", "teses",
    "proximos_passos", "impacto_atualizacao",
]


def _render_estrategia(c: dict) -> str:
    """Renderização especial para estrategia_vencedora."""
    html = ""

    # Probabilidade de êxito
    prob = c.get("probabilidade_exito", {})
    if isinstance(prob, dict):
        vt = prob.get("vitoria_total", 0)
        vp = prob.get("vitoria_parcial", 0)
        dt = prob.get("derrota_total", 0)
        html += f"""
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:12px 0">
          <p style="font-size:11pt;font-weight:bold;color:#166534;margin:0 0 10px">Probabilidade de Êxito</p>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:80px;text-align:center;background:#dcfce7;border-radius:6px;padding:8px">
              <p style="font-size:18pt;font-weight:bold;color:#15803d;margin:0">{vt}%</p>
              <p style="font-size:9pt;color:#166534;margin:0">Vitória Total</p>
            </div>
            <div style="flex:1;min-width:80px;text-align:center;background:#fef9c3;border-radius:6px;padding:8px">
              <p style="font-size:18pt;font-weight:bold;color:#a16207;margin:0">{vp}%</p>
              <p style="font-size:9pt;color:#a16207;margin:0">Vitória Parcial</p>
            </div>
            <div style="flex:1;min-width:80px;text-align:center;background:#fee2e2;border-radius:6px;padding:8px">
              <p style="font-size:18pt;font-weight:bold;color:#b91c1c;margin:0">{dt}%</p>
              <p style="font-size:9pt;color:#b91c1c;margin:0">Derrota Total</p>
            </div>
          </div>
          {f'<p style="font-size:10pt;color:#374151;margin:10px 0 0;font-style:italic">{_esc(prob.get("observacao",""))}</p>' if prob.get("observacao") else ""}
        </div>
        """

    # Argumento campeão
    arg = c.get("argumento_campeao") or c.get("argumento_campea")
    if arg:
        html += f"""
        <div style="background:#fefce8;border-left:4px solid #ca8a04;padding:12px 16px;margin:12px 0;border-radius:0 8px 8px 0">
          <p style="font-size:10pt;font-weight:bold;color:#a16207;margin:0 0 4px">🥇 Argumento Principal</p>
          <p style="font-size:11pt;color:#1c1917;margin:0">{_esc(arg)}</p>
        </div>
        """

    # Top argumentos
    top = c.get("top_argumentos") or []
    if top:
        html += "<p style='font-weight:bold;margin:12px 0 6px'>Argumentos Rankeados:</p><ol style='margin:0;padding-left:18px'>"
        for a in top:
            if isinstance(a, dict):
                html += f"<li style='margin-bottom:6px'><strong>{_esc(a.get('argumento',''))}</strong>"
                if a.get("fundamento"):
                    html += f" <em style='color:#6b7280'>({_esc(a['fundamento'])})</em>"
                html += "</li>"
            else:
                html += f"<li style='margin-bottom:4px'>{_esc(a)}</li>"
        html += "</ol>"

    # Jurisprudência de ouro
    juris = c.get("jurisprudencia_de_ouro") or []
    if juris:
        html += "<p style='font-weight:bold;margin:12px 0 6px'>⭐ Jurisprudência de Ouro:</p>"
        for j in juris:
            if isinstance(j, dict):
                html += f"""
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin:6px 0">
                  <p style="font-size:10pt;font-weight:bold;color:#1e40af;margin:0">{_esc(j.get("tribunal","") + " — " + j.get("numero",""))}</p>
                  <p style="font-size:10pt;color:#1e3a8a;margin:3px 0 0;font-style:italic">{_esc(j.get("tese",""))}</p>
                </div>
                """
            else:
                html += f"<p style='color:#1e40af'>• {_esc(j)}</p>"

    # Plano 30 dias
    plano = c.get("plano_30_dias") or []
    if plano:
        html += "<p style='font-weight:bold;margin:12px 0 6px'>📅 Plano de Ação (30 dias):</p><ol style='margin:0;padding-left:18px'>"
        for item in plano:
            if isinstance(item, dict):
                html += f"<li style='margin-bottom:6px'><strong>{_esc(item.get('acao',''))}</strong>"
                if item.get("prazo"):
                    html += f" <span style='color:#dc2626;font-size:9pt'> ⏰ {_esc(item['prazo'])}</span>"
                html += "</li>"
            else:
                html += f"<li style='margin-bottom:4px'>{_esc(item)}</li>"
        html += "</ol>"

    # Armadilhas críticas
    arm = c.get("armadilhas_criticas") or []
    if arm:
        html += f"""
        <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:12px 16px;margin:12px 0">
          <p style="font-weight:bold;color:#be123c;margin:0 0 8px">⚠️ Armadilhas Críticas</p>
          <ul style="margin:0;padding-left:18px;color:#9f1239">
        """
        for a in arm:
            html += f"<li style='margin-bottom:4px'>{_esc(a)}</li>"
        html += "</ul></div>"

    # Mensagem ao cliente
    msg = c.get("mensagem_ao_cliente")
    if msg:
        html += f"""
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:12px 0">
          <p style="font-size:10pt;font-weight:bold;color:#475569;margin:0 0 6px">💬 Em linguagem simples para o cliente:</p>
          <p style="font-size:11pt;color:#1e293b;font-style:italic;margin:0">{_esc(msg)}</p>
        </div>
        """

    # Fallback para outros campos não mapeados
    mapeados = {"probabilidade_exito","argumento_campeao","argumento_campea","top_argumentos",
                "jurisprudencia_de_ouro","plano_30_dias","armadilhas_criticas","mensagem_ao_cliente",
                "contra_argumentos_adversario","provas_decisivas","negociacao"}
    resto = {k: v for k, v in c.items() if k not in mapeados and v}
    if resto:
        html += _render_val(resto)

    return html


def _render_analise_conteudo(tipo: str, conteudo: dict) -> str:
    if tipo == "estrategia_vencedora":
        return _render_estrategia(conteudo)
    return _render_val(conteudo)


# ── CSS do relatório ───────────────────────────────────────────────────────

_CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Times New Roman', serif;
  font-size: 11.5pt;
  color: #1a1a1a;
  background: #fff;
  padding: 0;
}
.pagina {
  max-width: 800px;
  margin: 0 auto;
  padding: 2cm 2.2cm;
}
/* Capa */
.capa {
  border-bottom: 3px solid #1a1a3a;
  padding-bottom: 24px;
  margin-bottom: 30px;
}
.capa-topo {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.escritorio-nome {
  font-size: 14pt;
  font-weight: bold;
  color: #1a1a3a;
  letter-spacing: .5px;
}
.confidencial {
  font-size: 9pt;
  font-weight: bold;
  color: #dc2626;
  border: 1.5px solid #dc2626;
  padding: 3px 10px;
  border-radius: 4px;
  letter-spacing: 1px;
}
.titulo-relatorio {
  font-size: 18pt;
  font-weight: bold;
  color: #1a1a3a;
  margin: 12px 0 6px;
  letter-spacing: .3px;
}
.subtitulo-relatorio {
  font-size: 11pt;
  color: #6b7280;
  font-style: italic;
  margin-bottom: 18px;
}
.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 20px;
  margin-top: 16px;
}
.meta-item label {
  font-size: 8.5pt;
  font-weight: bold;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: .6px;
  display: block;
  margin-bottom: 2px;
}
.meta-item span {
  font-size: 10.5pt;
  color: #111827;
}
/* Seções */
.secao {
  margin: 28px 0 0;
  page-break-inside: avoid;
}
.secao-header {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 2px solid #1a1a3a;
  padding-bottom: 6px;
  margin-bottom: 14px;
}
.secao-num {
  background: #1a1a3a;
  color: #fff;
  font-size: 9pt;
  font-weight: bold;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.secao-titulo {
  font-size: 13pt;
  font-weight: bold;
  color: #1a1a3a;
}
.secao-meta {
  font-size: 9pt;
  color: #9ca3af;
  margin-left: auto;
}
/* Tabela de prazos */
.tabela-prazos {
  width: 100%;
  border-collapse: collapse;
  font-size: 10pt;
  margin-top: 8px;
}
.tabela-prazos th {
  background: #1a1a3a;
  color: #fff;
  padding: 7px 10px;
  text-align: left;
  font-size: 9pt;
  font-weight: bold;
  letter-spacing: .3px;
}
.tabela-prazos td {
  padding: 7px 10px;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: top;
}
.tabela-prazos tr:nth-child(even) td { background: #f9fafb; }
.badge-prazo {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 99px;
  font-size: 8.5pt;
  font-weight: bold;
}
.badge-vencido  { background:#fee2e2; color:#b91c1c; }
.badge-urgente  { background:#ffedd5; color:#c2410c; }
.badge-normal   { background:#dcfce7; color:#15803d; }
/* Cronologia */
.linha-evento {
  display: flex;
  gap: 14px;
  margin-bottom: 10px;
  align-items: flex-start;
}
.evento-data {
  font-size: 9pt;
  color: #6b7280;
  width: 80px;
  flex-shrink: 0;
  padding-top: 2px;
  font-variant-numeric: tabular-nums;
}
.evento-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;
}
.evento-corpo { flex: 1; }
.evento-desc {
  font-size: 10.5pt;
  color: #111827;
  line-height: 1.4;
}
.evento-tipo {
  font-size: 8.5pt;
  color: #9ca3af;
  margin-top: 2px;
}
/* Rodapé */
.rodape {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid #d1d5db;
}
.aviso-legal {
  font-size: 8.5pt;
  color: #9ca3af;
  line-height: 1.6;
  font-style: italic;
}
.rodape-info {
  display: flex;
  justify-content: space-between;
  font-size: 9pt;
  color: #9ca3af;
  margin-top: 10px;
}
/* Impressão */
@media print {
  @page { margin: 1.5cm 2cm; }
  .no-print { display: none !important; }
  .pagina { padding: 0; max-width: 100%; }
  .secao { page-break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}
/* Botão de impressão (não imprime) */
.btn-imprimir {
  position: fixed;
  top: 20px;
  right: 20px;
  background: #1a1a3a;
  color: #fff;
  border: none;
  padding: 10px 22px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,.25);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: -apple-system, sans-serif;
  transition: background .15s;
}
.btn-imprimir:hover { background: #2d2d5e; }
"""


# ── Gerador principal ──────────────────────────────────────────────────────

async def _gerar_html(processo_id: uuid.UUID) -> str:
    sb = get_supabase()

    # Carrega tudo em paralelo
    proc_r, ana_r, prazos_r, cron_r = await asyncio.gather(
        sb_run(lambda: sb.table("processos").select("*").eq("id", str(processo_id)).limit(1).execute()),
        sb_run(lambda: sb.table("analises").select("*").eq("processo_id", str(processo_id)).order("created_at", desc=True).execute()),
        sb_run(lambda: sb.table("prazos").select("*").eq("processo_id", str(processo_id)).in_("status", ["em_aberto"]).order("vencimento").execute()),
        sb_run(lambda: sb.table("cronologia").select("*").eq("processo_id", str(processo_id)).order("data_evento", desc=True).limit(30).execute()),
    )

    if not proc_r.data:
        raise ValueError("Processo não encontrado")

    proc      = proc_r.data[0]
    analises  = ana_r.data or []
    prazos    = prazos_r.data or []
    cronologia = cron_r.data or []

    # Deduplica análises por tipo (mantém a mais recente)
    tipos_vistos: set[str] = set()
    analises_unicas = []
    for a in analises:
        if a["tipo"] not in tipos_vistos:
            tipos_vistos.add(a["tipo"])
            analises_unicas.append(a)

    # Ordena pelas seções preferenciais
    ordem_map = {t: i for i, t in enumerate(_SECAO_ORDEM)}
    analises_unicas.sort(key=lambda a: ordem_map.get(a["tipo"], 99))

    # Metadados do processo
    numero_cnj  = proc.get("numero_cnj") or "Não informado"
    tribunal    = proc.get("tribunal") or ""
    vara        = proc.get("vara") or ""
    assunto     = proc.get("assunto") or "Processo Jurídico"
    status      = proc.get("status") or "ativo"
    responsavel = proc.get("responsavel") or ""
    emitido_em  = datetime.now(timezone.utc).strftime("%d/%m/%Y às %H:%M")

    # ── HTML ──────────────────────────────────────────────────────────────

    secoes_html = ""
    num_secao   = 1

    # ── Seção: Dados do Processo ──────────────────────────────────────────
    secoes_html += f"""
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">{num_secao}</div>
        <span class="secao-titulo">Dados do Processo</span>
      </div>
      <div class="meta-grid" style="grid-template-columns:1fr 1fr;gap:10px 24px">
        <div class="meta-item"><label>Número CNJ</label><span style="font-family:monospace;font-size:10.5pt">{_esc(numero_cnj)}</span></div>
        <div class="meta-item"><label>Status</label><span>{_esc(status.capitalize())}</span></div>
        {"<div class='meta-item'><label>Tribunal</label><span>" + _esc(tribunal) + "</span></div>" if tribunal else ""}
        {"<div class='meta-item'><label>Vara / Câmara</label><span>" + _esc(vara) + "</span></div>" if vara else ""}
        {"<div class='meta-item' style='grid-column:1/-1'><label>Assunto</label><span>" + _esc(assunto) + "</span></div>" if assunto else ""}
        {"<div class='meta-item'><label>Responsável</label><span>" + _esc(responsavel) + "</span></div>" if responsavel else ""}
      </div>
    </div>
    """
    num_secao += 1

    # ── Seções de análise IA ──────────────────────────────────────────────
    for analise in analises_unicas:
        tipo    = analise["tipo"]
        label   = _SECAO_LABEL.get(tipo, tipo.replace("_", " ").title())
        emoji   = _SECAO_EMOJI.get(tipo, "📄")
        conteudo = analise.get("conteudo_json") or {}
        criado  = _fmt_data(analise.get("created_at"))
        modelo  = analise.get("modelo_ia", "IA")
        confianca = analise.get("confianca")
        conf_str = f"confiança {int(confianca * 100)}%" if confianca else ""

        corpo = _render_analise_conteudo(tipo, conteudo)

        secoes_html += f"""
        <div class="secao">
          <div class="secao-header">
            <div class="secao-num">{num_secao}</div>
            <span class="secao-titulo">{emoji} {_esc(label)}</span>
            <span class="secao-meta">{_esc(criado)}{' · ' + conf_str if conf_str else ''}</span>
          </div>
          <div style="font-size:10.5pt;line-height:1.65;color:#1f2937">
            {corpo}
          </div>
        </div>
        """
        num_secao += 1

    # ── Seção: Prazos Processuais ─────────────────────────────────────────
    if prazos:
        hoje = date.today()
        linhas = ""
        for p in prazos:
            venc_str = p.get("vencimento", "")
            try:
                venc = date.fromisoformat(venc_str)
                dias = (venc - hoje).days
                if dias < 0:
                    badge = f'<span class="badge-prazo badge-vencido">Vencido há {abs(dias)}d</span>'
                elif dias <= 7:
                    badge = f'<span class="badge-prazo badge-urgente">Vence em {dias}d</span>'
                else:
                    badge = f'<span class="badge-prazo badge-normal">Em {dias}d</span>'
            except Exception:
                badge = ""

            linhas += f"""
            <tr>
              <td style="font-weight:600">{_esc(p.get("titulo",""))}</td>
              <td style="font-family:monospace;font-size:9.5pt">{_fmt_data(venc_str)}</td>
              <td>{badge}</td>
              <td style="font-size:9.5pt;color:#6b7280">{_esc(p.get("fundamento_legal","") or p.get("tipo",""))}</td>
            </tr>
            """

        secoes_html += f"""
        <div class="secao">
          <div class="secao-header">
            <div class="secao-num">{num_secao}</div>
            <span class="secao-titulo">⏰ Prazos Processuais</span>
            <span class="secao-meta">{len(prazos)} prazo{len(prazos) != 1 and "s" or ""} em aberto</span>
          </div>
          <table class="tabela-prazos">
            <thead><tr><th>Prazo</th><th>Vencimento</th><th>Situação</th><th>Fundamento / Tipo</th></tr></thead>
            <tbody>{linhas}</tbody>
          </table>
        </div>
        """
        num_secao += 1

    # ── Seção: Cronologia Recente ─────────────────────────────────────────
    if cronologia:
        cores_relev = {
            "critica": "#dc2626",
            "alta":    "#ea580c",
            "media":   "#ca8a04",
            "baixa":   "#6b7280",
        }
        eventos_html = ""
        for ev in cronologia:
            cor = cores_relev.get(ev.get("relevancia", "baixa"), "#9ca3af")
            data_str = _fmt_data(ev.get("data_evento"))
            desc = ev.get("descricao", "")
            tipo_ev = _tipo_peca_label(ev.get("tipo_evento", ""))
            fonte = ev.get("fonte", "")
            fonte_txt = "" if fonte in ("manual", "") else f" · {fonte.upper()}"
            eventos_html += f"""
            <div class="linha-evento">
              <span class="evento-data">{_esc(data_str)}</span>
              <div class="evento-dot" style="background:{cor}"></div>
              <div class="evento-corpo">
                <p class="evento-desc">{_esc(desc)}</p>
                <p class="evento-tipo">{_esc(tipo_ev)}{fonte_txt}</p>
              </div>
            </div>
            """

        secoes_html += f"""
        <div class="secao">
          <div class="secao-header">
            <div class="secao-num">{num_secao}</div>
            <span class="secao-titulo">📅 Cronologia Processual</span>
            <span class="secao-meta">Últimos {len(cronologia)} eventos</span>
          </div>
          <div style="padding:4px 0">
            {eventos_html}
          </div>
        </div>
        """
        num_secao += 1

    # ── Aviso quando não há análises ──────────────────────────────────────
    if not analises_unicas and not prazos and not cronologia:
        secoes_html += """
        <div style="text-align:center;padding:40px;color:#9ca3af;font-style:italic">
          Nenhuma análise ou dados encontrados para este processo.<br>
          Realize upload dos documentos e gere as análises IA antes de emitir o relatório.
        </div>
        """

    # ── HTML final ────────────────────────────────────────────────────────
    info_linha = " · ".join(filter(None, [tribunal, vara]))
    tags = proc.get("tags") or []
    tags_html = "".join(
        f"<span style='background:#eff6ff;color:#1d4ed8;font-size:8.5pt;padding:2px 8px;border-radius:99px;margin-right:4px'>{_esc(t)}</span>"
        for t in tags
    )

    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Relatório — {_esc(numero_cnj)}</title>
  <style>{_CSS}</style>
</head>
<body>

<button class="btn-imprimir no-print" onclick="window.print()">
  🖨 Imprimir / Salvar PDF
</button>

<div class="pagina">

  <!-- CAPA -->
  <div class="capa">
    <div class="capa-topo">
      <span class="escritorio-nome">⚖ AnalJus — Sistema Jurídico Inteligente</span>
      <span class="confidencial">CONFIDENCIAL</span>
    </div>
    <h1 class="titulo-relatorio">Relatório Jurídico do Processo</h1>
    <p class="subtitulo-relatorio">{_esc(assunto)}</p>

    <div class="meta-grid">
      <div class="meta-item">
        <label>Número CNJ</label>
        <span style="font-family:monospace">{_esc(numero_cnj)}</span>
      </div>
      <div class="meta-item">
        <label>Emitido em</label>
        <span>{_esc(emitido_em)}</span>
      </div>
      {"<div class='meta-item'><label>Tribunal / Vara</label><span>" + _esc(info_linha) + "</span></div>" if info_linha else ""}
      {"<div class='meta-item'><label>Responsável</label><span>" + _esc(responsavel) + "</span></div>" if responsavel else ""}
    </div>
    {"<div style='margin-top:14px'>" + tags_html + "</div>" if tags_html else ""}
  </div>

  <!-- SEÇÕES -->
  {secoes_html}

  <!-- RODAPÉ -->
  <div class="rodape">
    <p class="aviso-legal">
      Este relatório foi gerado automaticamente pelo sistema AnalJus com auxílio de inteligência artificial,
      com base nos documentos processuais fornecidos. Seu conteúdo tem caráter orientativo e informativo,
      não substituindo a análise e o juízo profissional do advogado responsável pelo processo.
      As probabilidades de êxito são estimativas baseadas nos elementos disponíveis e não constituem
      garantia de resultado. Este documento é de uso exclusivo do destinatário, sendo vedada
      sua reprodução ou circulação sem autorização expressa do escritório responsável.
    </p>
    <div class="rodape-info">
      <span>AnalJus · Sistema de Análise Processual Inteligente</span>
      <span>Emitido em {_esc(emitido_em)}</span>
    </div>
  </div>

</div>
</body>
</html>"""

    return html


# ── Rota ─────────────────────────────────────────────────────────────────

@router.get("/processos/{processo_id}/relatorio", response_class=HTMLResponse)
async def gerar_relatorio(processo_id: uuid.UUID):
    """
    Gera e retorna um relatório jurídico profissional em HTML.
    Abra no browser e use Ctrl+P para salvar como PDF.
    """
    try:
        html = await _gerar_html(processo_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar relatório: {e}")

    return HTMLResponse(content=html, media_type="text/html; charset=utf-8")
