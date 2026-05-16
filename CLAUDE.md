# Projeto: Analisador de Processos Jurídicos

## Visão Geral
Sistema RAG para análise de processos jurídicos de até 5.000 páginas.
Extrai texto de PDFs, divide em chunks, gera embeddings e usa Claude para análise estruturada.

## Stack Técnica
- **Backend**: Python 3.11+ | FastAPI | Uvicorn
- **PDF**: PyMuPDF (fitz) + pdfplumber + pytesseract (OCR)
- **Embeddings**: Voyage AI (voyage-law-2) — específico para jurídico
- **Banco Vetorial**: Supabase pgvector
- **LLM**: Claude claude-sonnet-4-20250514 via Anthropic API
- **Frontend**: Next.js 14 + Tailwind CSS + shadcn/ui

## Estrutura do Projeto
```
analise-processual/
├── CLAUDE.md                  ← você está aqui
├── .env                       ← variáveis de ambiente (nunca commitar)
├── .env.example               ← template de variáveis
├── backend/
│   ├── main.py                ← FastAPI app + rotas
│   ├── ingestao.py            ← extração PDF + chunking
│   ├── embeddings.py          ← Voyage AI embeddings
│   ├── retrieval.py           ← busca vetorial no Supabase
│   ├── analise.py             ← análise com Claude API
│   ├── models.py              ← Pydantic models
│   ├── database.py            ← conexão Supabase
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/        ← componentes React
│   │   ├── hooks/             ← custom hooks
│   │   └── lib/               ← utils e API client
│   └── package.json
└── docs/
    └── sql_setup.sql          ← schema Supabase
```

## Variáveis de Ambiente Necessárias
```
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

## Padrões de Código

### Chunking
- Tamanho: 1000 tokens por chunk
- Overlap: 150 tokens entre chunks
- Metadados obrigatórios por chunk:
  - tipo_peca (petição, decisão, laudo, etc.)
  - data (extraída do texto quando possível)
  - autor (parte, juiz, perito, etc.)
  - pagina_inicio / pagina_fim
  - processo_id

### Análise Estruturada
Sempre retornar análise no formato JSON com:
```json
{
  "tese_principal": "",
  "pontos_frageis": [],
  "contradicoes": [],
  "jurisprudencia_aplicavel": [],
  "lacunas_tecnicas": [],
  "cronologia": [],
  "riscos_juridicos": [],
  "prognostico": ""
}
```

### Identificação de Peças Processuais
Detectar automaticamente pelo conteúdo:
- Petição inicial
- Contestação
- Réplica
- Laudo pericial
- Decisão interlocutória
- Sentença
- Acórdão
- Recurso
- Parecer

## Comandos Úteis

```bash
# Iniciar backend
cd backend && uvicorn main:app --reload --port 8000

# Iniciar frontend
cd frontend && npm run dev

# Testar ingestão de PDF
cd backend && python -c "from ingestao import processar_pdf; processar_pdf('teste.pdf')"

# Ver logs de embeddings
cd backend && python embeddings.py --debug
```

## Regras de Desenvolvimento
1. NUNCA commitar o arquivo .env
2. Sempre validar entrada do usuário antes de processar PDF
3. Processar PDFs de forma assíncrona (não bloquear a API)
4. Chunks devem sempre ter metadados completos
5. Erros de OCR devem ser logados mas não interromper o processamento
6. Rate limit Voyage AI: 100 req/min — usar batch quando possível
7. Rate limit Anthropic: respeitar e implementar retry com backoff

## Fluxo Principal
```
1. Upload PDF → backend/main.py (POST /upload)
2. Extração texto → backend/ingestao.py
3. Chunking → backend/ingestao.py
4. Embeddings → backend/embeddings.py (Voyage Law-2)
5. Armazenamento → backend/database.py (Supabase pgvector)
6. Query usuário → backend/retrieval.py (busca semântica)
7. Contexto + Query → backend/analise.py (Claude API)
8. Resposta estruturada → frontend
```

## Próximos Passos (em ordem de prioridade)
- [ ] Implementar ingestao.py completo com suporte a OCR
- [ ] Implementar embeddings.py com batch processing
- [ ] Criar schema SQL no Supabase
- [ ] Implementar retrieval.py com filtros por metadados
- [ ] Implementar analise.py com prompts jurídicos
- [ ] Criar API FastAPI com endpoints documentados
- [ ] Construir frontend Next.js
- [ ] Adicionar autenticação
- [ ] Testes unitários
