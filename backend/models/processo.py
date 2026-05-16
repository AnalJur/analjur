import uuid
from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Boolean, Integer, Float, Date, ForeignKey, Text, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base, TimestampMixin, TimestampUpdateMixin, uuid_pk


class Tenant(Base, TimestampUpdateMixin):
    __tablename__ = "tenants"

    id:     Mapped[uuid.UUID] = uuid_pk()
    nome:   Mapped[str]       = mapped_column(String, nullable=False)
    plano:  Mapped[str]       = mapped_column(String, default="starter")
    ativo:  Mapped[bool]      = mapped_column(Boolean, default=True)
    config: Mapped[dict]      = mapped_column(JSONB, default=dict)


class Usuario(Base, TimestampMixin):
    __tablename__ = "usuarios"

    id:            Mapped[uuid.UUID]      = uuid_pk()
    tenant_id:     Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    email:         Mapped[str]            = mapped_column(String, nullable=False, unique=True)
    nome:          Mapped[str]            = mapped_column(String, nullable=False)
    role:          Mapped[str]            = mapped_column(String, default="advogado")
    ativo:         Mapped[bool]           = mapped_column(Boolean, default=True)
    ultimo_acesso: Mapped[Optional[datetime]] = mapped_column(nullable=True)


class Processo(Base, TimestampUpdateMixin):
    __tablename__ = "processos"

    id:             Mapped[uuid.UUID]       = uuid_pk()
    tenant_id:      Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    numero_cnj:     Mapped[Optional[str]]   = mapped_column(String, nullable=True)
    tribunal:       Mapped[Optional[str]]   = mapped_column(String, nullable=True)
    vara:           Mapped[Optional[str]]   = mapped_column(String, nullable=True)
    assunto:        Mapped[Optional[str]]   = mapped_column(String, nullable=True)
    status:         Mapped[str]             = mapped_column(String, default="ativo")
    responsavel_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    tags:           Mapped[list]            = mapped_column(ARRAY(String), default=list)
    metadados:      Mapped[dict]            = mapped_column(JSONB, default=dict)
    created_by:     Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)

    documentos:  "list[Documento]"  = relationship("Documento",  back_populates="processo", cascade="all, delete-orphan")
    partes:      "list[Parte]"      = relationship("Parte",      back_populates="processo", cascade="all, delete-orphan")
    cronologia:  "list[Cronologia]" = relationship("Cronologia", back_populates="processo", cascade="all, delete-orphan")
    snapshots:   "list[Snapshot]"   = relationship("Snapshot",   back_populates="processo", cascade="all, delete-orphan")
    analises:    "list[Analise]"    = relationship("Analise",    back_populates="processo", cascade="all, delete-orphan")
    tarefas:     "list[TarefaRevisao]" = relationship("TarefaRevisao", back_populates="processo", cascade="all, delete-orphan")
    minutas:     "list[Minuta]"     = relationship("Minuta",     back_populates="processo", cascade="all, delete-orphan")


class Parte(Base, TimestampMixin):
    __tablename__ = "partes"

    id:          Mapped[uuid.UUID]      = uuid_pk()
    processo_id: Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("processos.id"), nullable=False)
    tipo:        Mapped[str]            = mapped_column(String, nullable=False)
    nome:        Mapped[str]            = mapped_column(String, nullable=False)
    documento:   Mapped[Optional[str]]  = mapped_column(String, nullable=True)
    oab:         Mapped[Optional[str]]  = mapped_column(String, nullable=True)
    email:       Mapped[Optional[str]]  = mapped_column(String, nullable=True)

    processo: "Processo" = relationship("Processo", back_populates="partes")


class Documento(Base):
    __tablename__ = "documentos"

    id:             Mapped[uuid.UUID]       = uuid_pk()
    processo_id:    Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("processos.id"), nullable=False)
    tenant_id:      Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    nome_original:  Mapped[str]             = mapped_column(String, nullable=False)
    storage_path:   Mapped[str]             = mapped_column(String, nullable=False)
    content_hash:   Mapped[str]             = mapped_column(String, nullable=False)
    mime_type:      Mapped[str]             = mapped_column(String, default="application/pdf")
    tamanho_bytes:  Mapped[Optional[int]]   = mapped_column(Integer, nullable=True)
    total_paginas:  Mapped[Optional[int]]   = mapped_column(Integer, nullable=True)
    ocr_utilizado:  Mapped[bool]            = mapped_column(Boolean, default=False)
    status:         Mapped[str]             = mapped_column(String, default="aguardando")
    erro_msg:       Mapped[Optional[str]]   = mapped_column(Text, nullable=True)
    uploaded_by:    Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    uploaded_at:    Mapped[datetime]        = mapped_column(default=datetime.utcnow)
    processado_at:  Mapped[Optional[datetime]] = mapped_column(nullable=True)

    processo: "Processo"  = relationship("Processo", back_populates="documentos")
    pecas:    "list[Peca]" = relationship("Peca", back_populates="documento", cascade="all, delete-orphan")


class Peca(Base, TimestampMixin):
    __tablename__ = "pecas"

    id:                     Mapped[uuid.UUID]       = uuid_pk()
    documento_id:           Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("documentos.id"), nullable=False)
    processo_id:            Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("processos.id"), nullable=False)
    tipo_peca:              Mapped[str]             = mapped_column(String, nullable=False)
    pagina_inicio:          Mapped[int]             = mapped_column(Integer, nullable=False)
    pagina_fim:             Mapped[int]             = mapped_column(Integer, nullable=False)
    data_documento:         Mapped[Optional[date]]  = mapped_column(Date, nullable=True)
    autor:                  Mapped[Optional[str]]   = mapped_column(String, nullable=True)
    conteudo_texto:         Mapped[Optional[str]]   = mapped_column(Text, nullable=True)
    resumo:                 Mapped[Optional[str]]   = mapped_column(Text, nullable=True)
    metadados:              Mapped[dict]            = mapped_column(JSONB, default=dict)
    confianca_classificacao: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    documento: "Documento"  = relationship("Documento", back_populates="pecas")
    chunks:    "list[Chunk]" = relationship("Chunk", back_populates="peca", cascade="all, delete-orphan")


class Chunk(Base, TimestampMixin):
    __tablename__ = "chunks"

    id:          Mapped[uuid.UUID]      = uuid_pk()
    peca_id:     Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("pecas.id"), nullable=False)
    processo_id: Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("processos.id"), nullable=False)
    tenant_id:   Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    conteudo:    Mapped[str]            = mapped_column(Text, nullable=False)
    pagina:      Mapped[Optional[int]]  = mapped_column(Integer, nullable=True)
    chunk_index: Mapped[int]            = mapped_column(Integer, nullable=False)
    tokens:      Mapped[Optional[int]]  = mapped_column(Integer, nullable=True)
    # embedding armazenado via supabase-py (vector não mapeado no ORM para evitar dependência extra)

    peca: "Peca" = relationship("Peca", back_populates="chunks")


class Cronologia(Base, TimestampMixin):
    __tablename__ = "cronologia"

    id:              Mapped[uuid.UUID]      = uuid_pk()
    processo_id:     Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("processos.id"), nullable=False)
    peca_id:         Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("pecas.id"), nullable=True)
    data_evento:     Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    data_aproximada: Mapped[bool]           = mapped_column(Boolean, default=False)
    tipo_evento:     Mapped[str]            = mapped_column(String, nullable=False)
    descricao:       Mapped[str]            = mapped_column(Text, nullable=False)
    relevancia:      Mapped[str]            = mapped_column(String, default="media")
    fonte:           Mapped[str]            = mapped_column(String, default="ia")
    validado:        Mapped[bool]           = mapped_column(Boolean, default=False)

    processo: "Processo" = relationship("Processo", back_populates="cronologia")


class Snapshot(Base, TimestampMixin):
    __tablename__ = "snapshots"

    id:              Mapped[uuid.UUID]       = uuid_pk()
    processo_id:     Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("processos.id"), nullable=False)
    versao:          Mapped[int]             = mapped_column(Integer, nullable=False)
    trigger:         Mapped[str]             = mapped_column(String, nullable=False)
    estado_json:     Mapped[dict]            = mapped_column(JSONB, nullable=False)
    resumo_mudancas: Mapped[Optional[str]]   = mapped_column(Text, nullable=True)
    documentos_ids:  Mapped[Optional[list]]  = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=True)
    criado_por:      Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)

    processo: "Processo" = relationship("Processo", back_populates="snapshots")


class Analise(Base, TimestampMixin):
    __tablename__ = "analises"

    id:                Mapped[uuid.UUID]       = uuid_pk()
    processo_id:       Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("processos.id"), nullable=False)
    snapshot_id:       Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("snapshots.id"), nullable=True)
    tipo:              Mapped[str]             = mapped_column(String, nullable=False)
    conteudo_json:     Mapped[dict]            = mapped_column(JSONB, nullable=False)
    modelo_ia:         Mapped[str]             = mapped_column(String, nullable=False)
    tokens_input:      Mapped[Optional[int]]   = mapped_column(Integer, nullable=True)
    tokens_output:     Mapped[Optional[int]]   = mapped_column(Integer, nullable=True)
    confianca:         Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status_revisao:    Mapped[str]             = mapped_column(String, default="pendente")
    revisado_por:      Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    revisado_at:       Mapped[Optional[datetime]]  = mapped_column(nullable=True)
    comentario_revisao: Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    created_by:        Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)

    processo: "Processo" = relationship("Processo", back_populates="analises")


class TarefaRevisao(Base, TimestampUpdateMixin):
    __tablename__ = "tarefas_revisao"

    id:             Mapped[uuid.UUID]       = uuid_pk()
    processo_id:    Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("processos.id"), nullable=False)
    analise_id:     Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("analises.id"), nullable=True)
    tipo:           Mapped[str]             = mapped_column(String, nullable=False)
    titulo:         Mapped[str]             = mapped_column(String, nullable=False)
    descricao:      Mapped[Optional[str]]   = mapped_column(Text, nullable=True)
    status:         Mapped[str]             = mapped_column(String, default="pendente")
    prioridade:     Mapped[str]             = mapped_column(String, default="normal")
    deadline:       Mapped[Optional[datetime]] = mapped_column(nullable=True)
    atribuido_para: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    atribuido_por:  Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    concluido_por:  Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    concluido_at:   Mapped[Optional[datetime]]  = mapped_column(nullable=True)
    comentario:     Mapped[Optional[str]]   = mapped_column(Text, nullable=True)
    metadados:      Mapped[dict]            = mapped_column(JSONB, default=dict)

    processo: "Processo" = relationship("Processo", back_populates="tarefas")


class Minuta(Base, TimestampUpdateMixin):
    __tablename__ = "minutas"

    id:           Mapped[uuid.UUID]       = uuid_pk()
    processo_id:  Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("processos.id"), nullable=False)
    analise_id:   Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("analises.id"), nullable=True)
    tipo:         Mapped[str]             = mapped_column(String, nullable=False)
    titulo:       Mapped[str]             = mapped_column(String, nullable=False)
    conteudo_md:  Mapped[str]             = mapped_column(Text, nullable=False)
    versao:       Mapped[int]             = mapped_column(Integer, default=1)
    status:       Mapped[str]             = mapped_column(String, default="rascunho")
    fontes_json:  Mapped[list]            = mapped_column(JSONB, default=list)
    confianca:    Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    criado_por:   Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    revisado_por: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    revisado_at:  Mapped[Optional[datetime]]  = mapped_column(nullable=True)

    processo: "Processo" = relationship("Processo", back_populates="minutas")


class MinutaHistorico(Base, TimestampMixin):
    __tablename__ = "minutas_historico"

    id:          Mapped[uuid.UUID]       = uuid_pk()
    minuta_id:   Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("minutas.id"), nullable=False)
    versao:      Mapped[int]             = mapped_column(Integer, nullable=False)
    conteudo_md: Mapped[str]             = mapped_column(Text, nullable=False)
    alterado_por: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)


class Job(Base, TimestampMixin):
    __tablename__ = "jobs"

    id:             Mapped[uuid.UUID]       = uuid_pk()
    tipo:           Mapped[str]             = mapped_column(String, nullable=False)
    payload:        Mapped[dict]            = mapped_column(JSONB, nullable=False)
    status:         Mapped[str]             = mapped_column(String, default="pendente")
    prioridade:     Mapped[int]             = mapped_column(Integer, default=5)
    tentativas:     Mapped[int]             = mapped_column(Integer, default=0)
    max_tentativas: Mapped[int]             = mapped_column(Integer, default=3)
    erro_msg:       Mapped[Optional[str]]   = mapped_column(Text, nullable=True)
    resultado:      Mapped[Optional[dict]]  = mapped_column(JSONB, nullable=True)
    criado_por:     Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    started_at:     Mapped[Optional[datetime]]  = mapped_column(nullable=True)
    finished_at:    Mapped[Optional[datetime]]  = mapped_column(nullable=True)
    scheduled_for:  Mapped[datetime]        = mapped_column(default=datetime.utcnow)


class AuditLog(Base, TimestampMixin):
    __tablename__ = "audit_log"

    id:          Mapped[uuid.UUID]       = uuid_pk()
    tenant_id:   Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True)
    usuario_id:  Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    acao:        Mapped[str]             = mapped_column(String, nullable=False)
    entidade:    Mapped[str]             = mapped_column(String, nullable=False)
    entidade_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    dados_antes: Mapped[Optional[dict]]  = mapped_column(JSONB, nullable=True)
    dados_depois: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    ip:          Mapped[Optional[str]]   = mapped_column(String, nullable=True)
    user_agent:  Mapped[Optional[str]]   = mapped_column(String, nullable=True)
