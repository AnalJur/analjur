"""
Cliente DataJud (CNJ) — monitoramento automático de movimentações processuais.

API pública: https://api-publica.datajud.cnj.jus.br
Docs: https://datajud-wiki.cnj.jus.br/api-publica/
"""

import uuid
import asyncio
from datetime import datetime, timezone
from typing import Optional

import httpx
from loguru import logger

from ..database import get_supabase, sb_run

# ── Configuração DataJud ───────────────────────────────────────────────────

DATAJUD_BASE = "https://api-publica.datajud.cnj.jus.br"
# Chave pública CNJ — autorizada para consultas gerais
DATAJUD_KEY  = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TaENMV1Jzd2d0Z0Q="

# Sigla do tribunal → índice ElasticSearch do DataJud
TRIBUNAL_INDEX: dict[str, str] = {
    # Justiça Estadual
    "TJAC":  "api_publica_tjac",  "TJAL":  "api_publica_tjal",
    "TJAM":  "api_publica_tjam",  "TJAP":  "api_publica_tjap",
    "TJBA":  "api_publica_tjba",  "TJCE":  "api_publica_tjce",
    "TJDF":  "api_publica_tjdft", "TJDFT": "api_publica_tjdft",
    "TJES":  "api_publica_tjes",  "TJGO":  "api_publica_tjgo",
    "TJMA":  "api_publica_tjma",  "TJMG":  "api_publica_tjmg",
    "TJMS":  "api_publica_tjms",  "TJMT":  "api_publica_tjmt",
    "TJPA":  "api_publica_tjpa",  "TJPB":  "api_publica_tjpb",
    "TJPE":  "api_publica_tjpe",  "TJPI":  "api_publica_tjpi",
    "TJPR":  "api_publica_tjpr",  "TJRJ":  "api_publica_tjrj",
    "TJRN":  "api_publica_tjrn",  "TJRO":  "api_publica_tjro",
    "TJRR":  "api_publica_tjrr",  "TJRS":  "api_publica_tjrs",
    "TJSC":  "api_publica_tjsc",  "TJSE":  "api_publica_tjse",
    "TJSP":  "api_publica_tjsp",  "TJTO":  "api_publica_tjto",
    # Justiça Federal
    "TRF1":  "api_publica_trf1",  "TRF2":  "api_publica_trf2",
    "TRF3":  "api_publica_trf3",  "TRF4":  "api_publica_trf4",
    "TRF5":  "api_publica_trf5",  "TRF6":  "api_publica_trf6",
    # Justiça do Trabalho
    "TRT1":  "api_publica_trt1",  "TRT2":  "api_publica_trt2",
    "TRT3":  "api_publica_trt3",  "TRT4":  "api_publica_trt4",
    "TRT5":  "api_publica_trt5",  "TRT6":  "api_publica_trt6",
    "TRT7":  "api_publica_trt7",  "TRT8":  "api_publica_trt8",
    "TRT9":  "api_publica_trt9",  "TRT10": "api_publica_trt10",
    "TRT11": "api_publica_trt11", "TRT12": "api_publica_trt12",
    "TRT13": "api_publica_trt13", "TRT14": "api_publica_trt14",
    "TRT15": "api_publica_trt15", "TRT16": "api_publica_trt16",
    "TRT17": "api_publica_trt17", "TRT18": "api_publica_trt18",
    "TRT19": "api_publica_trt19", "TRT20": "api_publica_trt20",
    "TRT21": "api_publica_trt21", "TRT22": "api_publica_trt22",
    "TRT23": "api_publica_trt23", "TRT24": "api_publica_trt24",
    "TST":   "api_publica_tst",
    # Superiores
    "STJ":   "api_publica_stj",
    "STF":   "api_publica_stf",
    "STM":   "api_publica_stm",
    # Justiça Militar Estadual
    "TJMMG": "api_publica_tjmmg",
    "TJMSP": "api_publica_tjmsp",
    "TJMRS": "api_publica_tjmrs",
}

# ── Mapeamento TPU (Tabela Processual Unificada) ───────────────────────────
# código → (tipo_evento_interno, relevancia)

_TPU: dict[int, tuple[str, str]] = {
    1:     ("distribuicao",              "alta"),
    3:     ("decisao_interlocutoria",    "alta"),
    7:     ("baixa",                     "alta"),
    10:    ("suspensao",                 "media"),
    11:    ("reabertura",                "media"),
    14:    ("decurso_prazo",             "media"),
    22:    ("despacho",                  "baixa"),
    26:    ("intimacao",                 "media"),
    49:    ("arquivamento",              "alta"),
    50:    ("extincao",                  "critica"),
    51:    ("sentenca",                  "critica"),
    54:    ("homologacao_acordo",        "critica"),
    60:    ("audiencia",                 "alta"),
    123:   ("conclusao_sentenca",        "media"),
    131:   ("transito_julgado",          "critica"),
    132:   ("julgamento",                "alta"),
    183:   ("impugnacao",                "media"),
    193:   ("decisao_interlocutoria",    "alta"),
    196:   ("acordao",                   "critica"),
    237:   ("remessa_superior",          "critica"),
    246:   ("citacao",                   "alta"),
    848:   ("distribuicao",              "alta"),
    871:   ("recurso",                   "alta"),
    891:   ("embargos_declaracao",       "media"),
    970:   ("agravo",                    "alta"),
    980:   ("sustentacao_oral",          "media"),
    11803: ("publicacao_dje",            "alta"),
}


def _tipo_evento(codigo: int, nome: str) -> str:
    if codigo in _TPU:
        return _TPU[codigo][0]
    n = nome.lower()
    if "sentença"    in n: return "sentenca"
    if "acórdão"     in n: return "acordao"
    if "decisão"     in n: return "decisao_interlocutoria"
    if "despacho"    in n: return "despacho"
    if "recurso"     in n: return "recurso"
    if "audiência"   in n: return "audiencia"
    if "intimação"   in n: return "intimacao"
    if "publicação"  in n: return "publicacao"
    if "citação"     in n: return "citacao"
    if "trânsito"    in n: return "transito_julgado"
    if "extinção"    in n: return "extincao"
    if "homologação" in n: return "homologacao_acordo"
    if "distribuição" in n: return "distribuicao"
    return "movimentacao"


def _relevancia(codigo: int, nome: str) -> str:
    if codigo in _TPU:
        return _TPU[codigo][1]
    n = nome.lower()
    if any(k in n for k in ["sentença", "acórdão", "trânsito", "extinção", "homolog", "remessa"]):
        return "critica"
    if any(k in n for k in ["decisão", "recurso", "audiência", "citação", "distribuição", "julgamento"]):
        return "alta"
    if any(k in n for k in ["intimação", "despacho", "conclusão", "publicação"]):
        return "media"
    return "baixa"


# ── Infere o índice DataJud a partir do número CNJ ────────────────────────

_TJ_NUM: dict[str, str] = {
    "01": "TJAC", "02": "TJAL", "03": "TJAM", "04": "TJAP",
    "05": "TJBA", "06": "TJCE", "07": "TJDF", "08": "TJES",
    "09": "TJGO", "10": "TJMA", "11": "TJMG", "12": "TJMS",
    "13": "TJMT", "14": "TJPA", "15": "TJPB", "16": "TJPE",
    "17": "TJPI", "18": "TJPR", "19": "TJRJ", "20": "TJRN",
    "21": "TJRO", "22": "TJRR", "23": "TJRS", "24": "TJSC",
    "25": "TJSE", "26": "TJSP", "27": "TJTO",
}


def _tribunal_do_cnj(numero_cnj: str) -> Optional[str]:
    """
    Extrai a sigla do tribunal do número CNJ.
    Formato: NNNNNNN-DD.AAAA.J.TT.OOOO
    J = segmento; TT = número do tribunal dentro do segmento.
    """
    import re
    m = re.match(r"\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}", numero_cnj)
    if not m:
        return None
    seg, tt = m.group(1), m.group(2)
    if   seg == "8": return _TJ_NUM.get(tt)          # TJXX
    elif seg == "4": return f"TRF{int(tt)}"           # TRF1-6
    elif seg == "5": return f"TRT{int(tt)}"           # TRT1-24
    elif seg == "3": return "STJ"
    elif seg == "1": return "STF"
    return None


def _get_index(tribunal: str) -> Optional[str]:
    t = tribunal.upper().strip()
    if t in TRIBUNAL_INDEX:
        return TRIBUNAL_INDEX[t]
    for key in TRIBUNAL_INDEX:
        if key in t:
            return TRIBUNAL_INDEX[key]
    return None


# ── Consulta DataJud ───────────────────────────────────────────────────────

async def consultar_datajud(numero_cnj: str, tribunal: str) -> dict:
    """
    Retorna o documento completo do processo no DataJud, ou {} se não encontrado.
    """
    index = _get_index(tribunal)
    if not index:
        inferido = _tribunal_do_cnj(numero_cnj)
        if inferido:
            index = _get_index(inferido)
    if not index:
        raise ValueError(
            f"Tribunal '{tribunal}' não reconhecido. Use a sigla oficial (ex: TJSP, TRT2, STJ)."
        )

    # Remove formatação CNJ para busca
    numero_limpo = numero_cnj.replace(".", "").replace("-", "").replace("/", "")

    url  = f"{DATAJUD_BASE}/{index}/_search"
    hdrs = {
        "Authorization": f"ApiKey {DATAJUD_KEY}",
        "Content-Type":  "application/json",
    }
    body = {
        "query": {"match": {"numeroProcesso": numero_limpo}},
        "sort":  [{"dataHoraUltimaAtualizacao": {"order": "desc"}}],
        "size":  1,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=hdrs, json=body)
        resp.raise_for_status()
        data = resp.json()

    hits = data.get("hits", {}).get("hits", [])
    if not hits:
        return {}
    return hits[0].get("_source", {})


# ── Sincronização de um processo ──────────────────────────────────────────

async def sincronizar_processo(processo_id: uuid.UUID) -> dict:
    """
    Sincroniza um processo com o DataJud:
      1. Busca movimentações recentes no CNJ
      2. Cria registros de cronologia para eventos novos (evita duplicatas)
      3. Atualiza metadados["datajud_sync"] com stats do sync

    Retorna: {novos, total_datajud, tribunal, classe, status, ultimo_sync}
    """
    sb = get_supabase()

    # Carrega o processo
    proc_res = await sb_run(
        lambda: sb.table("processos")
        .select("numero_cnj,tribunal,metadados")
        .eq("id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not proc_res.data:
        raise ValueError("Processo não encontrado")

    proc       = proc_res.data[0]
    numero_cnj: str = proc.get("numero_cnj") or ""
    tribunal:   str = proc.get("tribunal")   or ""

    if not numero_cnj:
        raise ValueError(
            "Processo sem número CNJ. Preencha o campo 'Número CNJ' antes de sincronizar."
        )

    if not tribunal:
        tribunal = _tribunal_do_cnj(numero_cnj) or ""
        if not tribunal:
            raise ValueError(
                "Tribunal não identificado. Preencha o campo 'Tribunal' (ex: TJSP) no processo."
            )

    # Consulta DataJud
    dados = await consultar_datajud(numero_cnj, tribunal)
    if not dados:
        return {
            "novos": 0, "total_datajud": 0,
            "tribunal": tribunal, "status": "nao_encontrado",
            "msg": "Processo não encontrado no DataJud para este tribunal.",
        }

    movimentos = dados.get("movimentos", [])

    # Carrega chaves de cronologia existente (fonte=datajud) para evitar duplicatas
    cron_res = await sb_run(
        lambda: sb.table("cronologia")
        .select("data_evento,descricao")
        .eq("processo_id", str(processo_id))
        .eq("fonte", "datajud")
        .execute()
    )
    existentes: set[str] = set()
    for ev in (cron_res.data or []):
        chave = f"{ev.get('data_evento', '')}|{ev.get('descricao', '')[:60]}"
        existentes.add(chave)

    # Processa movimentos novos
    novos = 0
    for mov in movimentos:
        nome_mov  = mov.get("nome", "Movimentação")
        data_hora = mov.get("dataHora", "")
        data_ev: Optional[str] = None

        if data_hora:
            try:
                dt     = datetime.fromisoformat(data_hora.replace("Z", "+00:00"))
                data_ev = dt.date().isoformat()
            except Exception:
                pass

        # Monta descrição completa
        descricao = nome_mov
        complementos = mov.get("complementosTabelados", [])
        if complementos:
            textos = [c.get("nome", "") for c in complementos if c.get("nome")]
            if textos:
                descricao += f" — {'; '.join(textos)}"

        chave = f"{data_ev or ''}|{descricao[:60]}"
        if chave in existentes:
            continue

        codigo   = mov.get("codigo", 0)
        tipo_ev  = _tipo_evento(codigo, nome_mov)
        relev    = _relevancia(codigo, nome_mov)

        row: dict = {
            "processo_id": str(processo_id),
            "tipo_evento": tipo_ev,
            "descricao":   descricao,
            "relevancia":  relev,
            "fonte":       "datajud",
            "validado":    True,
        }
        if data_ev:
            row["data_evento"] = data_ev

        await sb_run(lambda r=row: sb.table("cronologia").insert(r).execute())
        existentes.add(chave)
        novos += 1

    # Atualiza metadados do processo
    meta = proc.get("metadados") or {}
    meta["datajud_sync"] = {
        "ultimo_sync":         datetime.now(timezone.utc).isoformat(),
        "total_movimentos":    len(movimentos),
        "novos_eventos":       novos,
        "tribunal_confirmado": dados.get("tribunal", tribunal),
        "classe":              dados.get("classe", {}).get("nome"),
        "sistema":             dados.get("sistema", {}).get("nome"),
        "status":              "ok",
    }

    # Captura partes detectadas pelo DataJud (para referência)
    partes_dj = dados.get("partes", [])
    if partes_dj:
        meta["partes_datajud"] = [
            {
                "nome": p.get("nome", ""),
                "polo": p.get("polo", ""),
                "tipo": (p.get("tipo") or {}).get("nome", "") if isinstance(p.get("tipo"), dict) else "",
            }
            for p in partes_dj[:20]
        ]

    await sb_run(
        lambda: sb.table("processos")
        .update({"metadados": meta})
        .eq("id", str(processo_id))
        .execute()
    )

    logger.info(
        f"DataJud sync processo {processo_id}: "
        f"{novos} novo(s) evento(s) de {len(movimentos)} movimentos"
    )

    return {
        "novos":       novos,
        "total_datajud": len(movimentos),
        "tribunal":    dados.get("tribunal", tribunal),
        "classe":      dados.get("classe", {}).get("nome"),
        "sistema":     dados.get("sistema", {}).get("nome"),
        "status":      "ok",
        "ultimo_sync": meta["datajud_sync"]["ultimo_sync"],
    }


# ── Sync em lote (para cron job noturno) ──────────────────────────────────

async def sincronizar_todos_ativos() -> dict:
    """
    Sincroniza todos os processos ativos com número CNJ preenchido.
    Respeita rate-limit: máx 3 requests simultâneos + 500ms entre cada batch.
    """
    sb = get_supabase()
    procs_res = await sb_run(
        lambda: sb.table("processos")
        .select("id,numero_cnj,tribunal")
        .eq("status", "ativo")
        .not_.is_("numero_cnj", "null")
        .execute()
    )
    procs = [p for p in (procs_res.data or []) if p.get("numero_cnj")]

    resultado = {
        "total":        len(procs),
        "ok":           0,
        "erros":        0,
        "nao_encontrados": 0,
        "novos_eventos": 0,
    }

    sem = asyncio.Semaphore(3)

    async def _sync_one(proc: dict):
        async with sem:
            try:
                r = await sincronizar_processo(uuid.UUID(proc["id"]))
                if r.get("status") == "nao_encontrado":
                    resultado["nao_encontrados"] += 1
                else:
                    resultado["ok"]           += 1
                    resultado["novos_eventos"] += r.get("novos", 0)
            except Exception as exc:
                logger.warning(f"Erro sync DataJud [{proc['id']}]: {exc}")
                resultado["erros"] += 1
            finally:
                await asyncio.sleep(0.5)   # rate limiting respeitoso

    await asyncio.gather(*[_sync_one(p) for p in procs])
    logger.info(f"Sync DataJud em lote concluído: {resultado}")
    return resultado
