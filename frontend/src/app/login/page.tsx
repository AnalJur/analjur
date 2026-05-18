"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (!email || !senha) {
      setErro("Preencha todos os campos.");
      return;
    }

    setLoading(true);
    try {
      const data = await api.auth.login(email, senha);
      setAuth(data.access_token, data.user);
      router.push("/dashboard");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Credenciais inválidas");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-navy flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <img
            src="/logo-icon.svg"
            alt="AnalJur"
            width={40}
            height={40}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <span className="text-gold font-bold text-2xl tracking-tight">
            AnalJur
          </span>
        </div>

        <div className="space-y-6">
          <div className="w-16 h-1 bg-gold rounded-full" />
          <h2 className="text-4xl font-bold text-white leading-tight">
            Análise Inteligente de Processos Jurídicos
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed max-w-md">
            Transforme documentos jurídicos complexos em insights claros e
            acionáveis com o poder da inteligência artificial.
          </p>

          <div className="grid grid-cols-2 gap-4 pt-4">
            {[
              { num: "10x", desc: "Mais rápido na análise" },
              { num: "99%", desc: "Precisão nos dados" },
              { num: "500+", desc: "Processos analisados" },
              { num: "24/7", desc: "Disponibilidade" },
            ].map((stat) => (
              <div key={stat.num} className="bg-navy-light rounded-xl p-4">
                <p className="text-gold font-bold text-2xl">{stat.num}</p>
                <p className="text-slate-400 text-sm mt-1">{stat.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-slate-600 text-sm">
          AnalJur © 2025 · Todos os direitos reservados
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-center px-8 sm:px-16 lg:px-24 bg-surface">
        <div className="w-full max-w-md mx-auto">
          <div className="lg:hidden flex items-center gap-2 mb-10">
            <img
              src="/logo-icon.svg"
              alt="AnalJur"
              width={32}
              height={32}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="text-navy font-bold text-xl">AnalJur</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-text-main">
              Bem-vindo de volta
            </h1>
            <p className="text-muted mt-1">
              Acesse sua conta para continuar
            </p>
          </div>

          {erro && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
              {erro}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-text-main"
              >
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text-main placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold transition-all duration-200"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="senha"
                className="block text-sm font-medium text-text-main"
              >
                Senha
              </label>
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-bg text-text-main placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold transition-all duration-200"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm text-gold hover:text-gold-light transition-colors duration-200"
              >
                Esqueci a senha
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gold text-navy font-semibold rounded-lg px-5 py-2.5 hover:bg-gold-light transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-muted lg:hidden">
            AnalJur © 2025 · Todos os direitos reservados
          </p>
        </div>
      </div>
    </div>
  );
}
