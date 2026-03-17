"use client";

export function ThinkingIndicator() {
  return (
    <div className="flex flex-col gap-2 py-1 w-full">
      <span className="text-sm text-slate-400 dark:text-slate-500 animate-pulse">
        Flipping through everything I know...
      </span>
      <div className="h-1 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500"
          style={{
            width: "30%",
            animation: "shimmer 1.8s ease-in-out infinite",
          }}
        />
      </div>
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(430%); }
        }
      `}</style>
    </div>
  );
}
