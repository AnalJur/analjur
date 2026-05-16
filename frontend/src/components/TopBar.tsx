"use client";

interface TopBarProps {
  title: string;
  subtitle?: string;
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-surface shadow-sm border-b border-border">
      <div className="flex items-center justify-between px-8 py-4">
        <div>
          <h1 className="text-lg font-semibold text-text-main">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 bg-bg rounded-full px-4 py-2 border border-border">
            <div className="w-7 h-7 rounded-full bg-gold flex items-center justify-center text-navy font-bold text-xs select-none">
              U
            </div>
            <span className="text-sm font-medium text-text-main">Usuário</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      </div>
    </header>
  );
}
