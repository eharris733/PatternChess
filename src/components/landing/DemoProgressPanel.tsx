export function DemoProgressPanel({ label }: { label: string }) {
  return (
    <div className="border-2 border-[#1A1A1A] bg-white p-6 flex items-center gap-4">
      <div className="h-4 w-4 border-2 border-[#1A1A1A] border-t-transparent animate-spin rounded-full" />
      <span className="font-mono uppercase text-xs tracking-tight text-[#1A1A1A]">{label}</span>
    </div>
  );
}
