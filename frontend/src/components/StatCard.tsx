interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: string;
  accent?: boolean;
}

export default function StatCard({ label, value, icon, trend, accent }: StatCardProps) {
  return (
    <div className={`bg-surface rounded-xl shadow-sm hover:shadow-md transition-all duration-200 border-l-4 p-6 flex items-start gap-4 ${accent ? "border-yellow-400" : "border-gold"}`}>
      {icon && (
        <div className="flex-shrink-0 w-11 h-11 rounded-lg bg-gold/10 flex items-center justify-center text-gold">
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted truncate">{label}</p>
        <p className="mt-1 text-2xl font-bold text-text-main">{value}</p>
        {trend && <p className="mt-1 text-xs text-muted">{trend}</p>}
      </div>
    </div>
  );
}
