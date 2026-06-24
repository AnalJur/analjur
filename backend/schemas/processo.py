import uuid
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field


# ── Processo ──────────────────────────────────────────────────────────────

class ProcessoCreate(BaseModel):
    numero_cnj:  Optional[str] = None
    tribunal:    Optional[str] = None
    vara:        Optional[str] = None
    assunto:     Optional[str] = None
    tags:        list[str] = []
    metadados:   dict = {}
    cliente_id:  Optional[uuid.UUID] = None


class ProcessoUpdate(BaseModel):
    numero_cnj:     Optional[str] = None
    tribunal:       Optional[str] = None
    vara:           Optional[str] = None
    assunto:        Optional[str] = None
    status:         Optional[str] = None
    responsavel_id: Optional[uuid.UUID] = None
    responsavel:    Optional[str] = None   # texto livre; armazenado em metadados["responsavel"]
    tags:           Optional[list[str]] = None
    metadados:      Optional[dict] = None
    cliente_id:     Optional[uuid.UUID] = None


class ProcessoOut(BaseModel):
    id:                 uuid.UUID
    numero_cnj:         Optional[str] = None
    tribunal:           Optional[str] = None
    vara:               Optional[str] = None
    assunto:            Optional[str] = None
    status:             str = "ativo"
    tags:               list[str] = []
    responsavel:        Optional[str] = None
    cliente_id:         Optional[uuid.UUID] = None
    cliente_nome:       Optional[str] = None
    total_documentos:   int = 0
    total_pecas:        int = 0
    total_chunks:       int = 0
    tarefas_pendentes:  int = 0
    analises_pendentes: int = 0
    ultimo_upload:      Optional[datetime] = None
    ultimo_snapshot:    Optional[datetime] = None
    created_at:         datetime
    updated_at:         datetime

    class Config:
        from_attributes = True


# ── Parte ─────────────────────────────────────────────────────────────────

class ParteCreate(BaseModel):
    tipo:      str
    nome:      str
    documento: Optional[str] = None
    oab:       Optional[str] = None
    email:     Optional[str] = None


class ParteOut(ParteCreate):
    id:         uuid.UUID
    created_at: datetime

    class Config:
        from_attributes = True


# ── Documento ─────────────────────────────────────────────────────────────

class DocumentoOut(BaseModel):
    id:            uuid.UUID
    nome_original: str
    tamanho_bytes: Optional[int] = None
    total_paginas: Optional[int] = None
    ocr_utilizado: bool = False
    status:        str = "pendente"
    erro_msg:      Optional[str] = None
    uploaded_at:   datetime
    processado_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Peça ──────────────────────────────────────────────────────────────────

class PecaUpdate(BaseModel):
    tipo_peca:    Optional[str] = None
    conteudo_texto: Optional[str] = None
    resumo:       Optional[str] = None
    autor:        Optional[str] = None


class PecaOut(BaseModel):
    id:                     uuid.UUID
    documento_id:           Optional[uuid.UUID] = None
    tipo_peca:              str
    pagina_inicio:          int = 1
    pagina_fim:             int = 1
    data_documento:         Optional[date] = None
    autor:                  Optional[str] = None
    resumo:                 Optional[str] = None
    conteudo_texto:         Optional[str] = None
    confianca_classificacao: Optional[float] = None
    created_at:             datetime

    class Config:
        from_attributes = True


# ── Cronologia ────────────────────────────────────────────────────────────

class CronologiaCreate(BaseModel):
    data_evento:     Optional[date] = None
    data_aproximada: bool = False
    tipo_evento:     str
    descricao:       str
    relevancia:      str = "media"
    fonte:           str = "manual"


class CronologiaUpdate(BaseModel):
    data_evento:     Optional[date] = None
    data_aproximada: Optional[bool] = None
    tipo_evento:     Optional[str] = None
    descricao:       Optional[str] = None
    relevancia:      Optional[str] = None
    fonte:           Optional[str] = None
    validado:        Optional[bool] = None


class CronologiaOut(BaseModel):
    id:              uuid.UUID
    data_evento:     Optional[date] = None
    data_aproximada: bool = False
    tipo_evento:     str
    descricao:       str
    relevancia:      str = "media"
    fonte:           str = ""
    validado:        bool = False

    class Config:
        from_attributes = True


# ── Snapshot ──────────────────────────────────────────────────────────────

class SnapshotOut(BaseModel):
    id:              uuid.UUID
    versao:          int
    trigger:         str
    resumo_mudancas: Optional[str] = None
    estado_json:     dict
    created_at:      datetime

    class Config:
        from_attributes = True


# ── Análise ───────────────────────────────────────────────────────────────

class AnaliseSolicitacao(BaseModel):
    tipo: str = Field(
        default="estado_atual",
        description="resumo_executivo | riscos | teses | estado_atual | impacto_atualizacao | proximos_passos | estrategia"
    )
    contexto_extra: Optional[str] = None
    documento_ids:  Optional[list[uuid.UUID]] = None


class AnaliseOut(BaseModel):
    id:             uuid.UUID
    tipo:           str
    conteudo_json:  dict
    modelo_ia:      str
    confianca:      Optional[float] = None
    status_revisao: str = "pendente"
    revisado_at:    Optional[datetime] = None
    tokens_input:   Optional[int] = None
    tokens_output:  Optional[int] = None
    created_at:     datetime

    class Config:
        from_attributes = True


# ── Chat ──────────────────────────────────────────────────────────────────

class ChatMensagem(BaseModel):
    role:    str
    content: str


class ChatRequest(BaseModel):
    processo_id:  uuid.UUID
    mensagens:    list[ChatMensagem]
    tipo_peca:    Optional[str] = None
    usar_sonnet:  bool = False   # True → Sonnet (estratégia complexa); False → Haiku (rápido)


class ChatResponse(BaseModel):
    resposta:   str
    fontes:     list[dict]
    tokens:     int


# ── Tarefa de revisão ─────────────────────────────────────────────────────

class TarefaCreate(BaseModel):
    tipo:          str
    titulo:        str
    descricao:     Optional[str] = None
    prioridade:    str = "normal"
    deadline:      Optional[datetime] = None
    atribuido_para: Optional[uuid.UUID] = None
    metadados:     dict = {}


class TarefaUpdate(BaseModel):
    status:      Optional[str] = None
    comentario:  Optional[str] = None
    prioridade:  Optional[str] = None
    deadline:    Optional[datetime] = None


class TarefaOut(BaseModel):
    id:             uuid.UUID
    tipo:           str
    titulo:         str
    descricao:      Optional[str] = None
    status:         str = "pendente"
    prioridade:     str = "normal"
    deadline:       Optional[datetime] = None
    atribuido_para: Optional[uuid.UUID] = None
    comentario:     Optional[str] = None
    created_at:     datetime
    updated_at:     datetime

    class Config:
        from_attributes = True


# ── Minuta ────────────────────────────────────────────────────────────────

class MinutaSolicitacao(BaseModel):
    tipo: str = Field(description=(
        "peticao_inicial | tutela_antecipada | impugnacao_cumprimento | "
        "apelacao_civel | embargos_declaracao | agravo_instrumento | "
        "recurso_ordinario_trabalhista | recurso_especial | "
        "habeas_corpus | mandado_seguranca | parecer | resumo_executivo"
    ))
    titulo: str
    instrucoes: Optional[str] = None


class MinutaUpdate(BaseModel):
    conteudo_md: Optional[str] = None
    titulo:      Optional[str] = None
    status:      Optional[str] = None


class MinutaOut(BaseModel):
    id:          uuid.UUID
    tipo:        str
    titulo:      str
    conteudo_md: str
    versao:      int
    status:      str
    confianca:   Optional[float]
    fontes_json: list
    created_at:  datetime
    updated_at:  datetime

    class Config:
        from_attributes = True


# ── Prazos ───────────────────────────────────────────────────────────────

class PrazoCreate(BaseModel):
    titulo:          str
    descricao:       Optional[str] = None
    tipo:            str = "processual"
    fundamento_legal: Optional[str] = None
    data_inicio:     Optional[date] = None
    prazo_dias:      Optional[int] = None
    vencimento:      date
    status:          str = "em_aberto"
    prioridade:      str = "normal"
    responsavel:     Optional[str] = None
    observacoes:     Optional[str] = None


class PrazoUpdate(BaseModel):
    titulo:          Optional[str] = None
    descricao:       Optional[str] = None
    tipo:            Optional[str] = None
    fundamento_legal: Optional[str] = None
    data_inicio:     Optional[date] = None
    prazo_dias:      Optional[int] = None
    vencimento:      Optional[date] = None
    status:          Optional[str] = None
    prioridade:      Optional[str] = None
    responsavel:     Optional[str] = None
    observacoes:     Optional[str] = None


class PrazoOut(BaseModel):
    id:              uuid.UUID
    processo_id:     uuid.UUID
    titulo:          str
    descricao:       Optional[str] = None
    tipo:            str = "processual"
    fundamento_legal: Optional[str] = None
    data_inicio:     Optional[date] = None
    prazo_dias:      Optional[int] = None
    vencimento:      date
    status:          str = "em_aberto"
    prioridade:      str = "normal"
    responsavel:     Optional[str] = None
    observacoes:     Optional[str] = None
    created_at:      datetime
    updated_at:      datetime

    class Config:
        from_attributes = True


# ── Job ───────────────────────────────────────────────────────────────────

class JobOut(BaseModel):
    id:           uuid.UUID
    tipo:         str
    status:       str = "pendente"
    tentativas:   int = 0
    erro_msg:     Optional[str] = None
    started_at:   Optional[datetime] = None
    finished_at:  Optional[datetime] = None
    created_at:   datetime

    class Config:
        from_attributes = True
