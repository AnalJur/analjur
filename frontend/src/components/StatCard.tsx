import { useRouter } from "next/navigation";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: string;
  accent?: boolean;
  href?: string;
  onClick?: () => void;
}

export default function StatCard({ label, value, icon, trend, accent, href, onClick }: StatCardProps) {
  const router = useRouter();
  const clickable = !!(href || onClick);

  function handleClick() {
    if (onClick) { onClick(); return; }
    if (href) router.push(href);
  }

  return (
    <div
      onClick={clickable ? handleClick : undefined}
      className={`
        bg-surface rounded-xl shadow-sm border-l-4 p-6 flex items-start gap-4
        transition-all duration-200
        ${accent ? "border-yellow-400" : "border-gold"}
        ${clickable
          ? "cursor-pointer hover:shadow-md hover:scale-[1.02] hover:brightness-105 active:scale-[0.99]"
          : "hover:shadow-md"}
      `}
    >
      {icon && (
        <div className={`flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center
          ${accent ? "bg-yellow-400/10 text-yellow-500" : "bg-gold/10 text-gold"}`}>
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted truncate">{label}</p>
        <p className="mt-1 text-2xl font-bold text-text-main">{value}</p>
        {trend && <p className="mt-1 text-xs text-muted">{trend}</p>}
        {clickable && (
          <p className="mt-1 text-xs text-gold/70 font-medium">Ver detalhes →</p>
        )}
      </div>
    </div>
  );
}
