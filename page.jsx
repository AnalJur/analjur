"use client";

import { useState, useRef, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── helpers ─────────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

function usePolling(processoId, onDone) {
  const timer = useRef(null);
  const start = useCallback(() => {
    timer.current = setInterval(async () => {
      try {
        const s = await api(`/status/${processoId}`);
        onDone(s);
        if (s.status === "concluido" || s.status === "erro") {
          clearInterval(timer.current);
        }
      } catch {}
    }, 2000);
  }, [processoId, onDone]);
  const stop = useCallback(() => clearInterval(timer.current), []);
  return { start, stop };
}

// ── componentes ─────────────────────────────────────────────────────────────

function ProgressBar({ value }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${value}%` }} />
    </div>
  );
}

function Badge({ label, variant = "neutral" }) {
  return <span className={`badge badge-${variant}`}>{label}</span>;
}

function JsonViewer({ data }) {
  if (!data) return null;
  const render = (val, depth = 0) => {
    if (typeof val === "string") return <span className="jv-str">"{val}"</span>;
    if (typeof val === "number") return <span className="jv-num">{val}</span>;
    if (typeof val === "boolean") return <span className="jv-bool">{String(val)}</span>;
    if (Array.isArray(val))
      return (
        <span>
          {"["}
          <div style={{ paddingLeft: 16 }}>
            {val.map((v, i) => (
              <div key={i}>{render(v, depth + 1)}{i < val.length - 1 ? "," : ""}</div>
            ))}
          </div>
          {"]"}
        </span>
      );
    if (typeof val === "object" && val !== null)
      return (
        <span>
          {"{"}
          <div style={{ paddingLeft: 16 }}>
            {Object.entries(val).map(([k, v], i, arr) => (
              <div key={k}>
                <span className="jv-key">"{k}"</span>:{" "}{render(v, depth + 1)}
                {i < arr.length - 1 ? "," : ""}
              </div>
            ))}
          </div>
          {"}"}
        </span>
      );
    return <span>{String(val)}</span>;
  };
  return <div className="json-viewer">{render(data)}</div>;
}

// ── página principal ─────────────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab] = useState("upload");          // upload | analisar | chat
  const [processo, setProcesso] = useState(null);     // { id, arquivo, status }
  const [ingestaoStatus, setIngestaoStatus] = useState(null);
  const [analise, setAnalise] = useState(null);
  const [loadingAnalise, setLoadingAnalise] = useState(false);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);
  const [tipoAnalise, setTipoAnalise] = useState("analise_completa");
  const [queryCustom, setQueryCustom] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef();
  const chatEndRef = useRef();

  const polling = usePolling(processo?.id, (s) => {
    setIngestaoStatus(s);
    if (s.status === "concluido") setTab("analisar");
  });

  // upload
  const handleFile = async (file) => {
    if (!file || !file.name.endsWith(".pdf")) return alert("Apenas PDF!");
    const fd = new FormData();
    fd.append("arquivo", file);
    try {
      const res = await api("/upload", { method: "POST", body: fd });
      const p = { id: res.processo_id, arquivo: res.arquivo };
      setProcesso(p);
      setIngestaoStatus({ status: "iniciando", progresso: 0 });
      setTab("upload");
      polling.start();
    } catch (e) {
      alert("Erro no upload: " + e.message);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  // análise
  const handleAnalisar = async () => {
    if (!processo) return;
    setLoadingAnalise(true);
    setAnalise(null);
    try {
      const res = await api("/analisar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processo_id: processo.id,
          tipo_analise: tipoAnalise,
          query: queryCustom || "Faça uma análise completa do processo",
          top_k: 10,
        }),
      });
      setAnalise(res);
    } catch (e) {
      setAnalise({ erro: e.message });
    }
    setLoadingAnalise(false);
  };

  // chat
  const handleChat = async () => {
    if (!chatInput.trim() || !processo) return;
    const msg = chatInput.trim();
    setChatInput("");
    const novaMensagem = { role: "user", content: msg };
    setChat((c) => [...c, novaMensagem]);
    setLoadingChat(true);
    try {
      const res = await api("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processo_id: processo.id,
          mensagem: msg,
          historico: chat,
        }),
      });
      setChat((c) => [...c, { role: "assistant", content: res.resposta }]);
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", content: "Erro: " + e.message }]);
    }
    setLoadingChat(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const statusLabel = {
    iniciando: "Iniciando...",
    extraindo: "Extraindo texto do PDF...",
    gerando_embeddings: "Gerando embeddings...",
    salvando: "Salvando no banco...",
    concluido: "Pronto",
    erro: "Erro",
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #0d0f14;
          --surface: #161a23;
          --surface2: #1e2433;
          --border: #2a3045;
          --accent: #4f7fff;
          --accent2: #7c3aed;
          --gold: #f0b429;
          --danger: #ef4444;
          --success: #22c55e;
          --text: #e2e8f0;
          --muted: #64748b;
          --radius: 10px;
          --font: 'IBM Plex Mono', monospace;
        }

        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');

        body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; line-height: 1.6; min-height: 100vh; }

        /* layout */
        .shell { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
        .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 28px 16px; display: flex; flex-direction: column; gap: 6px; }
        .logo { font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 800; color: var(--accent); letter-spacing: -0.5px; margin-bottom: 32px; line-height: 1.2; }
        .logo span { color: var(--gold); }
        .nav-btn { background: none; border: none; color: var(--muted); font-family: var(--font); font-size: 12px; text-align: left; padding: 9px 12px; border-radius: 6px; cursor: pointer; transition: all .15s; display: flex; align-items: center; gap: 8px; }
        .nav-btn:hover { background: var(--surface2); color: var(--text); }
        .nav-btn.active { background: var(--accent); color: #fff; }
        .nav-btn svg { opacity: .7; flex-shrink: 0; }

        .main { padding: 36px 40px; overflow-y: auto; }
        .page-title { font-family: 'Syne', sans-serif; font-size: 26px; font-weight: 800; margin-bottom: 8px; }
        .page-sub { color: var(--muted); font-size: 12px; margin-bottom: 28px; }

        /* cards */
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; margin-bottom: 20px; }
        .card-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 16px; }

        /* drop zone */
        .dropzone { border: 2px dashed var(--border); border-radius: var(--radius); padding: 48px 24px; text-align: center; cursor: pointer; transition: all .2s; }
        .dropzone.drag { border-color: var(--accent); background: rgba(79,127,255,.05); }
        .dropzone:hover { border-color: var(--accent); }
        .dropzone-icon { font-size: 40px; margin-bottom: 12px; }
        .dropzone-label { color: var(--muted); font-size: 12px; }
        .dropzone-label strong { color: var(--text); }

        /* progress */
        .progress-track { height: 4px; background: var(--surface2); border-radius: 99px; overflow: hidden; margin: 12px 0 6px; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent2)); border-radius: 99px; transition: width .4s ease; }

        /* tabs */
        .tabs { display: flex; gap: 4px; margin-bottom: 24px; }
        .tab-btn { padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border); background: none; color: var(--muted); font-family: var(--font); font-size: 12px; cursor: pointer; transition: all .15s; }
        .tab-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
        .tab-btn:hover:not(.active) { background: var(--surface2); color: var(--text); }

        /* select & input */
        select, input, textarea { background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: var(--font); font-size: 12px; border-radius: 6px; padding: 9px 12px; width: 100%; outline: none; transition: border .15s; }
        select:focus, input:focus, textarea:focus { border-color: var(--accent); }
        textarea { resize: vertical; min-height: 80px; }
        label { font-size: 11px; color: var(--muted); display: block; margin-bottom: 6px; margin-top: 14px; text-transform: uppercase; letter-spacing: .5px; }

        /* button */
        .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 22px; border-radius: 6px; border: none; font-family: var(--font); font-size: 12px; cursor: pointer; transition: all .15s; font-weight: 500; }
        .btn-primary { background: var(--accent); color: #fff; }
        .btn-primary:hover { background: #3d6bef; }
        .btn-primary:disabled { opacity: .4; cursor: not-allowed; }
        .btn-ghost { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }

        /* badge */
        .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
        .badge-neutral { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); }
        .badge-success { background: rgba(34,197,94,.1); color: var(--success); border: 1px solid rgba(34,197,94,.3); }
        .badge-danger { background: rgba(239,68,68,.1); color: var(--danger); border: 1px solid rgba(239,68,68,.3); }
        .badge-accent { background: rgba(79,127,255,.1); color: var(--accent); border: 1px solid rgba(79,127,255,.3); }
        .badge-gold { background: rgba(240,180,41,.1); color: var(--gold); border: 1px solid rgba(240,180,41,.3); }

        /* json viewer */
        .json-viewer { font-size: 11.5px; line-height: 1.8; overflow-x: auto; }
        .jv-key { color: var(--accent); }
        .jv-str { color: #a3e635; }
        .jv-num { color: var(--gold); }
        .jv-bool { color: #f472b6; }

        /* chat */
        .chat-messages { height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 4px 0 12px; }
        .msg { max-width: 80%; padding: 10px 14px; border-radius: 10px; font-size: 12.5px; line-height: 1.6; }
        .msg-user { background: var(--accent); color: #fff; align-self: flex-end; border-bottom-right-radius: 2px; }
        .msg-assistant { background: var(--surface2); border: 1px solid var(--border); align-self: flex-start; border-bottom-left-radius: 2px; }
        .chat-input-row { display: flex; gap: 8px; margin-top: 12px; }
        .chat-input-row input { flex: 1; }
        .typing { color: var(--muted); font-size: 11px; font-style: italic; align-self: flex-start; }

        /* status bar */
        .status-bar { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .dot-ok { background: var(--success); box-shadow: 0 0 6px var(--success); }
        .dot-loading { background: var(--gold); animation: pulse 1s infinite; }
        .dot-err { background: var(--danger); }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

        /* grid */
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media(max-width:700px){ .shell{grid-template-columns:1fr} .sidebar{display:none} .grid2{grid-template-columns:1fr} }
      `}</style>

      <div className="shell">
        {/* sidebar */}
        <aside className="sidebar">
          <div className="logo">⚖ Iuris<span>AI</span></div>
          {[
            { id: "upload", icon: "⬆", label: "Upload PDF" },
            { id: "analisar", icon: "🔍", label: "Analisar" },
            { id: "chat", icon: "💬", label: "Chat" },
          ].map((n) => (
            <button
              key={n.id}
              className={`nav-btn ${tab === n.id ? "active" : ""}`}
              onClick={() => setTab(n.id)}
            >
              <span>{n.icon}</span> {n.label}
            </button>
          ))}
          {processo && (
            <div style={{ marginTop: "auto", padding: "12px", background: "var(--surface2)", borderRadius: 8, fontSize: 11 }}>
              <div style={{ color: "var(--muted)", marginBottom: 4 }}>PROCESSO ATIVO</div>
              <div style={{ color: "var(--accent)", fontWeight: 600 }}>{processo.id}</div>
              <div style={{ color: "var(--muted)", wordBreak: "break-all" }}>{processo.arquivo}</div>
            </div>
          )}
        </aside>

        {/* main */}
        <main className="main">

          {/* ── UPLOAD ── */}
          {tab === "upload" && (
            <>
              <div className="page-title">Upload do Processo</div>
              <div className="page-sub">Envie o PDF do processo judicial. Até 5.000 páginas suportado.</div>

              <div
                className={`dropzone ${dragging ? "drag" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="dropzone-icon">📄</div>
                <div className="dropzone-label">
                  <strong>Clique ou arraste o PDF aqui</strong><br />
                  Suporta PDFs nativos e escaneados (OCR automático)
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  style={{ display: "none" }}
                  onChange={(e) => handleFile(e.target.files[0])}
                />
              </div>

              {ingestaoStatus && (
                <div className="card" style={{ marginTop: 20 }}>
                  <div className="card-title">Status da Ingestão</div>
                  <div className="status-bar">
                    <div className={`status-dot ${
                      ingestaoStatus.status === "concluido" ? "dot-ok" :
                      ingestaoStatus.status === "erro" ? "dot-err" : "dot-loading"
                    }`} />
                    <div>
                      <div>{statusLabel[ingestaoStatus.status] || ingestaoStatus.status}</div>
                      {ingestaoStatus.chunks && (
                        <div style={{ color: "var(--muted)", fontSize: 11 }}>
                          {ingestaoStatus.chunks} chunks identificados
                        </div>
                      )}
                    </div>
                    <Badge
                      label={ingestaoStatus.status}
                      variant={
                        ingestaoStatus.status === "concluido" ? "success" :
                        ingestaoStatus.status === "erro" ? "danger" : "gold"
                      }
                    />
                  </div>
                  <ProgressBar value={ingestaoStatus.progresso || 0} />
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{ingestaoStatus.progresso}% concluído</div>

                  {ingestaoStatus.status === "concluido" && (
                    <div className="grid2" style={{ marginTop: 16 }}>
                      {[
                        ["Páginas", ingestaoStatus.total_paginas],
                        ["Chunks", ingestaoStatus.total_chunks],
                        ["OCR usado", ingestaoStatus.tem_ocr ? "Sim" : "Não"],
                        ["Erros", ingestaoStatus.erros?.length || 0],
                      ].map(([k, v]) => (
                        <div key={k} style={{ background: "var(--surface2)", borderRadius: 8, padding: "10px 14px" }}>
                          <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{k}</div>
                          <div style={{ fontSize: 22, fontWeight: 600, color: "var(--accent)" }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── ANALISAR ── */}
          {tab === "analisar" && (
            <>
              <div className="page-title">Análise do Processo</div>
              <div className="page-sub">Análise estruturada com RAG + Claude Sonnet 4</div>

              {!processo && (
                <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>
                  Nenhum processo carregado. Faça o upload primeiro.
                </div>
              )}

              {processo && (
                <div className="card">
                  <label>Tipo de Análise</label>
                  <select value={tipoAnalise} onChange={(e) => setTipoAnalise(e.target.value)}>
                    <option value="analise_completa">Análise Completa (teses, riscos, jurisprudência)</option>
                    <option value="teses">Teses das Partes</option>
                    <option value="cronologia">Cronologia dos Eventos</option>
                    <option value="riscos">Riscos Jurídicos</option>
                  </select>

                  <label>Instrução Adicional (opcional)</label>
                  <textarea
                    value={queryCustom}
                    onChange={(e) => setQueryCustom(e.target.value)}
                    placeholder="Ex: Foque nos argumentos sobre dano moral. Identifique contradições entre a petição inicial e a contestação."
                  />

                  <div style={{ marginTop: 16 }}>
                    <button
                      className="btn btn-primary"
                      onClick={handleAnalisar}
                      disabled={loadingAnalise}
                    >
                      {loadingAnalise ? "⏳ Analisando..." : "🔍 Analisar"}
                    </button>
                  </div>
                </div>
              )}

              {analise && (
                <div className="card">
                  <div className="card-title">Resultado da Análise</div>
                  {analise.erro ? (
                    <div style={{ color: "var(--danger)" }}>Erro: {analise.erro}</div>
                  ) : (
                    <JsonViewer data={analise} />
                  )}
                </div>
              )}
            </>
          )}

          {/* ── CHAT ── */}
          {tab === "chat" && (
            <>
              <div className="page-title">Chat Processual</div>
              <div className="page-sub">Faça perguntas livres sobre o processo</div>

              {!processo ? (
                <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: 40 }}>
                  Nenhum processo carregado. Faça o upload primeiro.
                </div>
              ) : (
                <div className="card">
                  <div className="chat-messages">
                    {chat.length === 0 && (
                      <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", margin: "auto" }}>
                        Faça uma pergunta sobre o processo {processo.id}
                      </div>
                    )}
                    {chat.map((m, i) => (
                      <div key={i} className={`msg ${m.role === "user" ? "msg-user" : "msg-assistant"}`}>
                        {m.content}
                      </div>
                    ))}
                    {loadingChat && <div className="typing">Claude está analisando...</div>}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="chat-input-row">
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ex: Quais são os pontos frágeis da contestação?"
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleChat()}
                    />
                    <button className="btn btn-primary" onClick={handleChat} disabled={loadingChat}>
                      Enviar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

        </main>
      </div>
    </>
  );
}
