"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSidebar } from "./SidebarContext";

interface NavItem { href: string; label: string; icon: React.ReactNode }

function BarChart2Icon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
}
function FolderOpenIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 11 12 17"/><polyline points="9 14 12 17 15 14"/></svg>;
}
function UploadIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>;
}
function SettingsIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard",   icon: <BarChart2Icon /> },
  { href: "/upload",    label: "Enviar Docs", icon: <UploadIcon /> },
  { href: "/revisao",   label: "Revisão",     icon: <SettingsIcon /> },
  { href: "/admin",     label: "Operações",   icon: <FolderOpenIcon /> },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { open, close } = useSidebar();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-30 sm:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Sidebar drawer */}
      <aside
        className={`
          fixed left-0 top-0 h-screen w-60 bg-navy flex flex-col z-40
          transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full"}
          sm:translate-x-0
        `}
      >
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={close}>
            <Image
              src="/logo-icon.svg"
              alt="AnalJur"
              width={36}
              height={36}
              className="flex-shrink-0"
            />
            <span className="text-gold font-bold text-xl tracking-tight">AnalJur</span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-all duration-150 group
                  ${active
                    ? "bg-gold/10 text-gold border-l-2 border-gold pl-[10px]"
                    : "text-slate-300 hover:bg-white/5 hover:text-white border-l-2 border-transparent"
                  }
                `}
              >
                <span className={`flex-shrink-0 transition-colors ${active ? "text-gold" : "text-slate-400 group-hover:text-white"}`}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/10">
          <p className="text-xs text-slate-500">AnalJur v1.0</p>
        </div>
      </aside>
    </>
  );
}
