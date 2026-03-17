"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Loader2, HelpCircle } from "lucide-react";

interface QuizCardProps {
  question: string;
  options: string[];
  correctIndex: number;
  selectedIndex: number | null;
  isAnswered: boolean;
  onAnswer: (index: number) => void;
  isLoading?: boolean;
}

export function QuizCard({
  question,
  options,
  correctIndex,
  selectedIndex,
  isAnswered,
  onAnswer,
  isLoading = false,
}: QuizCardProps) {
  // Local state for immediate click feedback — useCopilotAction render
  // doesn't re-render when parent's quizStates Map updates
  const [localSelected, setLocalSelected] = useState<number | null>(null);
  const [localAnswered, setLocalAnswered] = useState(false);

  const effectiveSelected = localSelected ?? selectedIndex;
  const effectiveAnswered = localAnswered || isAnswered;
  const isCorrect = effectiveSelected === correctIndex;

  const handleClick = (index: number) => {
    if (effectiveAnswered) return;
    setLocalSelected(index);
    setLocalAnswered(true);
    onAnswer(index);
  };

  if (isLoading) {
    return (
      <div className="my-4 rounded-xl border bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          <span className="text-sm text-slate-600 dark:text-slate-400">Preparing question...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-white/80" />
          <span className="text-xs font-semibold text-white/90 uppercase tracking-wider">
            Knowledge Check
          </span>
        </div>
      </div>

      {/* Question */}
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed">
          {question}
        </h3>
      </div>

      {/* Options */}
      <div className="p-4 space-y-2">
        {options.map((option, index) => {
          const isSelected = effectiveSelected === index;
          const isCorrectOption = index === correctIndex;
          const letter = String.fromCharCode(65 + index);

          return (
            <button
              key={index}
              onClick={() => handleClick(index)}
              disabled={effectiveAnswered}
              className={cn(
                "w-full flex items-center gap-3 p-4 rounded-lg border-2 text-left transition-all duration-200",
                !effectiveAnswered && "border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer",
                effectiveAnswered && isCorrectOption && "!border-emerald-300 dark:!border-emerald-700 !bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20",
                effectiveAnswered && isSelected && !isCorrectOption && "!border-rose-300 dark:!border-rose-700 !bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/20 dark:to-pink-950/20",
                effectiveAnswered && !isSelected && !isCorrectOption && "!border-slate-100 dark:!border-slate-800 !opacity-50"
              )}
            >
              {/* Letter badge */}
              <span
                className={cn(
                  "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-colors",
                  !effectiveAnswered && "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
                  effectiveAnswered && isCorrectOption && "!bg-gradient-to-r from-emerald-500 to-teal-500 !text-white",
                  effectiveAnswered && isSelected && !isCorrectOption && "!bg-gradient-to-r from-rose-500 to-pink-500 !text-white",
                  effectiveAnswered && !isSelected && !isCorrectOption && "bg-slate-100 dark:bg-slate-800 text-slate-400"
                )}
              >
                {letter}
              </span>

              {/* Option text */}
              <span
                className={cn(
                  "flex-1 text-sm font-medium",
                  !effectiveAnswered && "text-slate-700 dark:text-slate-300",
                  effectiveAnswered && isCorrectOption && "text-emerald-800 dark:text-emerald-200",
                  effectiveAnswered && isSelected && !isCorrectOption && "text-rose-800 dark:text-rose-200",
                  effectiveAnswered && !isSelected && !isCorrectOption && "text-slate-500"
                )}
              >
                {option}
              </span>

              {/* Result icon */}
              {effectiveAnswered && isCorrectOption && (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 drop-shadow-sm flex-shrink-0" />
              )}
              {effectiveAnswered && isSelected && !isCorrectOption && (
                <XCircle className="h-5 w-5 text-rose-500 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Result feedback */}
      {effectiveAnswered && (
        <div
          className={cn(
            "px-5 py-4 border-t",
            isCorrect
              ? "!bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 !border-emerald-200 dark:!border-emerald-800"
              : "bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800"
          )}
        >
          {isCorrect ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                Correct!
              </span>
            </div>
          ) : (
            <div className="text-sm text-slate-600 dark:text-slate-400">
              <span className="font-medium">Correct answer: </span>
              <span className="text-slate-800 dark:text-slate-200">
                {String.fromCharCode(65 + correctIndex)}. {options[correctIndex]}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
