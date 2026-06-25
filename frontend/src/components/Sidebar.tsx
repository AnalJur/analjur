"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "./SidebarContext";

interface NavItem { href: string; label: string; icon: React.ReactNode }

const navItems: NavItem[] = [
  {
    href: "/dashboard", label: "Dashboard",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  },
  {
    href: "/agenda", label: "Agenda",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1" fill="currentColor"/><circle cx="12" cy="15" r="1" fill="currentColor"/><circle cx="16" cy="15" r="1" fill="currentColor"/></svg>,
  },
  {
    href: "/clientes", label: "Clientes",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>,
  },
  {
    href: "/upload", label: "Enviar Docs",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  },
  {
    href: "/revisao", label: "Revisão",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  },
  {
    href: "/financeiro", label: "Financeiro",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  },
  {
    href: "/admin", label: "Operações",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { open, close, collapsed, toggleCollapse } = useSidebar();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-30 sm:hidden" onClick={close} aria-hidden="true" />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed left-0 top-0 h-screen bg-navy flex flex-col z-40
        transition-all duration-200 ease-in-out
        ${collapsed ? "w-[60px]" : "w-60"}
        ${open ? "translate-x-0" : "-translate-x-full"}
        sm:translate-x-0
      `}>
        {/* Logo */}
        <div className={`flex items-center border-b border-white/10 h-[57px] flex-shrink-0 ${collapsed ? "justify-center" : "px-5"}`}>
          <Link href="/dashboard" onClick={close} className="flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.svg" alt="AnalJur" width={28} height={28} className="flex-shrink-0" />
            {!collapsed && (
              <span className="text-gold font-bold text-lg tracking-tight truncate">AnalJur</span>
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href} onClick={close}
                title={collapsed ? item.label : undefined}
                className={`
                  relative flex items-center h-10 rounded-xl text-sm font-medium
                  transition-all duration-150 group
                  ${collapsed ? "justify-center" : "gap-3 px-3"}
                  ${active ? "bg-gold/15 text-gold" : "text-slate-400 hover:bg-white/6 hover:text-white"}
                `}>
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-gold rounded-r-full" />
                )}
                <span className={`flex-shrink-0 ${active ? "text-gold" : "text-slate-500 group-hover:text-white"} transition-colors`}>
                  {item.icon}
                </span>
                {!collapsed && item.label}

                {/* Tooltip no modo colapsado */}
                {collapsed && (
                  <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-xl z-50 border border-white/10">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Botão colapsar — só desktop */}
        <div className="hidden sm:block border-t border-white/10 p-2 flex-shrink-0">
          <button onClick={toggleCollapse}
            title={collapsed ? "Expandir" : "Recolher"}
            className={`w-full flex items-center h-9 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-all group ${collapsed ? "justify-center" : "gap-2 px-3"}`}>
            {/* Panel-left icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform duration-200 flex-shrink-0 ${collapsed ? "rotate-180" : ""}`}>
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M9 3v18"/>
              <polyline points="5 9 3 12 5 15" className="opacity-0"/>
            </svg>
            {!collapsed && <span className="text-xs font-medium">Recolher</span>}
          </button>
        </div>
      </aside>

      {/* Spacer invisível que empurra o conteúdo */}
      <div className={`hidden sm:block flex-shrink-0 transition-all duration-200 ${collapsed ? "w-[60px]" : "w-60"}`} />
    </>
  );
}
