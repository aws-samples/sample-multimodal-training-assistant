"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { RotateCcw, Check, ChevronLeft, ChevronRight, Loader2, BookOpen, Sparkles } from "lucide-react";

interface Flashcard {
  front: string;
  back: string;
}

interface FlashcardDeckProps {
  topic: string;
  cards: Flashcard[];
  isLoading?: boolean;
}

const masteredCache = new Map<string, Set<number>>();
const reviewLaterCache = new Map<string, Set<number>>();

export function FlashcardDeck({ topic, cards, isLoading = false }: FlashcardDeckProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [mastered, setMastered] = useState<Set<number>>(
    () => masteredCache.get(topic) ?? new Set()
  );
  const [reviewLater, setReviewLater] = useState<Set<number>>(
    () => reviewLaterCache.get(topic) ?? new Set()
  );

  if (isLoading || cards.length === 0) {
    return (
      <div className="my-4 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
          <span className="text-sm text-slate-600 dark:text-slate-400">Generating flashcards...</span>
        </div>
      </div>
    );
  }

  const card = cards[currentIndex];
  const masteredCount = mastered.size;
  const allMastered = masteredCount === cards.length;

  const handleMastered = () => {
    setMastered((prev) => {
      const next = new Set(prev).add(currentIndex);
      masteredCache.set(topic, next);
      return next;
    });
    setReviewLater((prev) => {
      const next = new Set(prev);
      next.delete(currentIndex);
      reviewLaterCache.set(topic, next);
      return next;
    });
    goNext();
  };

  const handleReview = () => {
    setReviewLater((prev) => {
      const next = new Set(prev).add(currentIndex);
      reviewLaterCache.set(topic, next);
      return next;
    });
    goNext();
  };

  const goNext = () => {
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev + 1) % cards.length);
  };

  const goPrev = () => {
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
  };

  const cardStatus = mastered.has(currentIndex) ? "mastered" : reviewLater.has(currentIndex) ? "review" : "unseen";

  return (
    <div className="my-4 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <BookOpen className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <span className="text-xs font-semibold text-white/90 uppercase tracking-wider block">
                Flashcards
              </span>
              <span className="text-[10px] text-white/60">{topic}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/15 backdrop-blur-sm rounded-full">
            <Sparkles className="h-3 w-3 text-white/80" />
            <span className="text-xs text-white/90 font-medium">
              {masteredCount}/{cards.length}
            </span>
          </div>
        </div>
      </div>

      {/* Card dots + progress */}
      <div className="px-5 pt-4 pb-1">
        <div className="flex items-center gap-1 justify-center mb-2">
          {cards.map((_, i) => (
            <button
              key={i}
              onClick={() => { setIsFlipped(false); setCurrentIndex(i); }}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                i === currentIndex ? "w-6" : "w-1.5",
                mastered.has(i) ? "bg-emerald-400" : reviewLater.has(i) ? "bg-amber-400" : i === currentIndex ? "bg-indigo-500 dark:bg-indigo-400" : "bg-slate-300 dark:bg-slate-600"
              )}
            />
          ))}
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
          {currentIndex + 1} / {cards.length}
          {cardStatus === "mastered" && " — mastered"}
          {cardStatus === "review" && " — needs review"}
        </p>
      </div>

      {/* Card with 3D flip */}
      <div className="px-5 py-3" style={{ perspective: "1000px" }}>
        <button
          onClick={() => setIsFlipped(!isFlipped)}
          className="w-full relative"
          style={{
            transformStyle: "preserve-3d",
            transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
            transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          {/* Front */}
          <div
            className={cn(
              "min-h-[180px] rounded-2xl p-7 text-center flex flex-col items-center justify-center",
              "transition-colors shadow-md",
              cardStatus === "mastered"
                ? "bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border-2 border-emerald-300 dark:border-emerald-700"
                : "bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-800 dark:to-indigo-950/30 border-2 border-indigo-200/60 dark:border-indigo-800/40"
            )}
            style={{ backfaceVisibility: "hidden" }}
          >
            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mb-4">
              <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">Q</span>
            </div>
            <p className="text-[15px] font-medium leading-relaxed text-slate-800 dark:text-slate-100">
              {card.front}
            </p>
            <p className="text-[10px] text-slate-400 mt-4 uppercase tracking-widest">tap to flip</p>
          </div>

          {/* Back */}
          <div
            className="min-h-[180px] rounded-2xl bg-gradient-to-br from-slate-50 to-sky-50 dark:from-slate-800 dark:to-sky-950/30 border-2 border-sky-200/60 dark:border-sky-800/40 p-7 text-center flex flex-col items-center justify-center absolute inset-0 shadow-md"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <div className="w-8 h-8 rounded-full bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center mb-4">
              <span className="text-sm font-bold text-sky-600 dark:text-sky-400">A</span>
            </div>
            <p className="text-[15px] font-medium leading-relaxed text-slate-800 dark:text-slate-100">
              {card.back}
            </p>
          </div>
        </button>
      </div>

      {/* Controls */}
      <div className="px-5 pb-5 pt-1 flex items-center justify-between gap-3">
        <button
          onClick={goPrev}
          className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center"
        >
          <ChevronLeft className="h-4 w-4 text-slate-500" />
        </button>

        <div className="flex gap-2 flex-1 justify-center">
          {isFlipped ? (
            <>
              <button
                onClick={handleReview}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Again
              </button>
              <button
                onClick={handleMastered}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-sm font-medium text-white transition-all shadow-sm shadow-emerald-500/25"
              >
                <Check className="h-3.5 w-3.5" />
                Got it
              </button>
            </>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">Tap card to reveal</span>
          )}
        </div>

        <button
          onClick={goNext}
          className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center"
        >
          <ChevronRight className="h-4 w-4 text-slate-500" />
        </button>
      </div>

      {/* Completion */}
      {allMastered && (
        <div className="px-5 pb-4">
          <div className="rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-200 dark:border-emerald-800 p-4 text-center">
            <Sparkles className="h-5 w-5 text-emerald-500 mx-auto mb-1.5" />
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">All cards mastered</p>
          </div>
        </div>
      )}
    </div>
  );
}
