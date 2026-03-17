"use client";

import { useState } from "react";

// ============================================
// Types
// ============================================
interface Source {
  id: string;
  name: string;
  type: "video" | "document" | "text";
  content?: string;
  score?: number;
  metadata: {
    timestamps?: string[];
    pages?: string[];
  };
}

interface KBSearchResultsProps {
  status: "inProgress" | "executing" | "complete" | "error";
  query?: string;
  result?: any;
  error?: string;
}

// ============================================
// Loading States
// ============================================
function SearchLoadingState({ query }: { query?: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-md">
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Knowledge Base Search</h3>
            <p className="text-xs text-indigo-600 dark:text-indigo-400">
              {query ? `Searching for "${query}"...` : "Searching..."}
            </p>
          </div>
        </div>
        <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    </div>
  );
}

// ============================================
// Empty State
// ============================================
function EmptyState({ query }: { query?: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-amber-200 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-amber-950/30 dark:via-gray-900 dark:to-orange-950/30 shadow-lg">
      <div className="p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">No Results Found</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-sm mx-auto">
          We couldn&apos;t find any sources matching your query{query && <span className="font-medium"> &quot;{query}&quot;</span>}.
        </p>
        <div className="bg-amber-100/50 dark:bg-amber-900/20 rounded-xl p-4 max-w-sm mx-auto">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">💡 Suggestions:</p>
          <ul className="text-xs text-amber-600 dark:text-amber-500 space-y-1 text-left">
            <li>• Try using different keywords</li>
            <li>• Use broader search terms</li>
            <li>• Check for spelling errors</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Error State
// ============================================
function ErrorState({ error, query }: { error?: string; query?: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-red-200 dark:border-red-800/50 bg-gradient-to-br from-red-50 via-white to-rose-50 dark:from-red-950/30 dark:via-gray-900 dark:to-rose-950/30 shadow-lg">
      <div className="p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/30 dark:to-rose-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">Search Error</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-sm mx-auto">
          Something went wrong while searching the knowledge base.
        </p>
        {error && (
          <div className="bg-red-100/50 dark:bg-red-900/20 rounded-xl p-4 max-w-md mx-auto mb-4">
            <p className="text-xs font-mono text-red-600 dark:text-red-400 break-all">{error}</p>
          </div>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Please try again or rephrase your query.
        </p>
      </div>
    </div>
  );
}

// ============================================
// Source Card Component
// ============================================
function SourceCard({ source, index }: { source: Source; index: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const handleTimestampClick = (timestamp: string, filename: string) => {
    if (typeof window !== "undefined" && (window as any).seekVideo) {
      (window as any).seekVideo(timestamp, filename);
    }
  };

  const handlePageClick = (page: string, filename: string) => {
    if (typeof window !== "undefined" && (window as any).openPDF) {
      (window as any).openPDF(page, filename);
    }
  };

  const getFileIcon = (type: string, name: string) => {
    if (type === "video" || name.match(/\.(mp4|webm|mov|avi)$/i)) {
      return (
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      );
    }
    if (type === "document" || name.match(/\.pdf$/i)) {
      return (
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-500 to-gray-600 flex items-center justify-center shadow-lg">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
    );
  };

  const getTypeLabel = (type: string, name: string) => {
    if (type === "video" || name.match(/\.(mp4|webm|mov|avi)$/i)) return "Video";
    if (type === "document" || name.match(/\.pdf$/i)) return "PDF Document";
    return "Document";
  };

  const hasTimestamps = source.metadata.timestamps && source.metadata.timestamps.length > 0;
  const hasPages = source.metadata.pages && source.metadata.pages.length > 0;

  return (
    <div 
      className="group p-4 bg-white dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg transition-all duration-300 hover:border-indigo-300 dark:hover:border-indigo-600 animate-slide-up backdrop-blur-sm"
      style={{ animationDelay: `${index * 75}ms` }}
    >
      <div className="flex items-start gap-4">
        {/* File Icon */}
        {getFileIcon(source.type, source.name)}
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                {source.name}
              </h4>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {getTypeLabel(source.type, source.name)}
                </span>
                {source.score !== undefined && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    {Math.round(source.score * 100)}% match
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {/* Content Preview */}
          {source.content && (
            <div className="mt-3">
              <p className={`text-xs text-gray-600 dark:text-gray-400 leading-relaxed ${!isExpanded ? 'line-clamp-2' : ''}`}>
                {source.content}
              </p>
              {source.content.length > 150 && (
                <button 
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium mt-1"
                >
                  {isExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
          
          {/* Citation Buttons */}
          {(hasTimestamps || hasPages) && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50">
              <div className="flex flex-wrap gap-2">
                {hasTimestamps && source.metadata.timestamps!.map((ts, idx) => (
                  <button
                    key={`ts-${idx}`}
                    onClick={() => handleTimestampClick(ts, source.name)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-rose-50 to-pink-50 hover:from-rose-100 hover:to-pink-100 dark:from-rose-900/20 dark:to-pink-900/20 dark:hover:from-rose-800/30 dark:hover:to-pink-800/30 text-rose-700 dark:text-rose-300 rounded-lg border border-rose-200 dark:border-rose-700/50 transition-all duration-200 hover:scale-105 hover:shadow-md transform group/btn"
                  >
                    <svg className="w-3.5 h-3.5 group-hover/btn:animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    </svg>
                    <span className="font-mono">{ts}</span>
                  </button>
                ))}
                {hasPages && source.metadata.pages!.map((page, idx) => (
                  <button
                    key={`pg-${idx}`}
                    onClick={() => handlePageClick(page, source.name)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 dark:from-blue-900/20 dark:to-indigo-900/20 dark:hover:from-blue-800/30 dark:hover:to-indigo-800/30 text-blue-700 dark:text-blue-300 rounded-lg border border-blue-200 dark:border-blue-700/50 transition-all duration-200 hover:scale-105 hover:shadow-md transform group/btn"
                  >
                    <svg className="w-3.5 h-3.5 group-hover/btn:animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>Page {page}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Main Component
// ============================================
export function KBSearchResults({ status, query, result, error }: KBSearchResultsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Loading states
  if (status === "inProgress" || status === "executing") {
    return <SearchLoadingState query={query} />;
  }

  // Error state
  if (status === "error" || error) {
    return <ErrorState error={error} query={query} />;
  }

  // Parse result
  let data: { sources: Source[]; rawText?: string } = { sources: [] };
  
  try {
    if (!result) {
      data = { sources: [] };
    } else if (typeof result === 'string') {
      const trimmed = result.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        data = JSON.parse(trimmed);
      } else {
        data = { sources: [], rawText: trimmed };
      }
    } else {
      data = result;
    }
  } catch (e) {
    return <ErrorState error={String(e)} query={query} />;
  }

  // Empty state
  if (!data?.sources || data.sources.length === 0) {
    return <EmptyState query={query} />;
  }

  // Success state with results - collapsed by default
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-md">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-left">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Knowledge Base Results
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Found {data.sources.length} source{data.sources.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
              ✓ Complete
            </span>
            {isExpanded ? (
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </div>
      </button>

      {/* Results - only shown when expanded */}
      {isExpanded && (
        <div className="p-4 space-y-3">
          {data.sources.map((source, index) => (
            <SourceCard key={source.id || index} source={source} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
