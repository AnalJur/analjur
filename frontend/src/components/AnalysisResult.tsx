interface AnalysisResultProps {
  data: Record<string, unknown>;
}

export default function AnalysisResult({ data }: AnalysisResultProps) {
  return (
    <pre className="bg-surface rounded-lg p-4 text-xs text-muted overflow-auto font-mono whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
