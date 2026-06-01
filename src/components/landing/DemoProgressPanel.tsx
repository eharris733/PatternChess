export function DemoProgressPanel({ label }: { label: string }) {
  return (
    <div className="border-2 border-text-primary bg-surface p-6 flex items-center gap-4">
      <div className="h-4 w-4 border-2 border-text-primary border-t-transparent animate-spin rounded-full" />
      <span className="font-mono uppercase text-xs tracking-tight text-text-primary">{label}</span>
    </div>
  );
}
