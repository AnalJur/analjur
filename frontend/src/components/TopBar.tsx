"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { getUser, clearAuth } from "@/lib/auth";
import { useSidebar } from "@/components/SidebarContext";

interface TopBarProps {
  title: string;
  subtitle?: string;
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  const router = useRouter();
  const { toggle: toggleMobile, toggleCollapse } = useSidebar();
  const [userEmail, setUserEmail] = useState<string>("");
  const [showMenu, setShowMenu]   = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const u = getUser();
    if (u) setUserEmail(u.email);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleLogout() { clearAuth(); router.push("/login"); }

  const initials    = userEmail ? userEmail.slice(0, 2).toUpperCase() : "U";
  const displayName = userEmail ? userEmail.split("@")[0] : "Usuário";

  return (
    <header className="sticky top-0 z-30 h-[57px] flex items-center bg-navy border-b border-white/8"
      style={{ backgroundImage: "linear-gradient(90deg, #0a1628 0%, #112040 100%)" }}>
      <div className="flex items-center justify-between px-4 w-full gap-3">

        <div className="flex items-center gap-2 min-w-0">
          {/* Desktop: toggle colapso da sidebar */}
          <button onClick={toggleCollapse}
            className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/8 transition-colors flex-shrink-0"
            aria-label="Alternar menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M9 3v18"/>
            </svg>
          </button>

          {/* Mobile: abre drawer */}
          <button onClick={toggleMobile}
            className="sm:hidden flex items-center justify-center w-8 h-8 rounded-lg text-white/40 hover:text-white hover:bg-white/8 transition-colors flex-shrink-0"
            aria-label="Abrir menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>

          {/* Título com accent dourado */}
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="w-[3px] h-5 rounded-full bg-gold flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white leading-tight truncate tracking-wide">{title}</h1>
              {subtitle && <p className="text-[11px] text-white/40 hidden sm:block truncate mt-0.5">{subtitle}</p>}
            </div>
          </div>
        </div>

        {/* Perfil */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button onClick={() => setShowMenu(v => !v)}
            className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 border border-white/10 hover:border-gold/50 hover:bg-white/5 transition-all">
            <div className="w-7 h-7 rounded-full bg-gold flex items-center justify-center text-navy font-bold text-xs select-none flex-shrink-0">
              {initials}
            </div>
            <span className="text-xs font-medium text-white/70 max-w-[100px] truncate hidden sm:block">{displayName}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`text-white/30 transition-transform flex-shrink-0 ${showMenu ? "rotate-180" : ""}`}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-surface rounded-xl border border-border shadow-2xl py-1 z-50">
              <div className="px-4 py-2.5 border-b border-border">
                <p className="text-[10px] text-muted uppercase tracking-wider font-semibold">Logado como</p>
                <p className="text-xs font-semibold text-text-main truncate mt-0.5">{userEmail}</p>
              </div>
              <button onClick={handleLogout}
                className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
