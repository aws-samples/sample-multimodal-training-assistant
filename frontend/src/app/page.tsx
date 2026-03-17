"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  CopilotKit,
  useCopilotAction,
  useCoAgent,
} from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useAuthToken } from "@/components/AuthProvider";
import { MediaViewer } from "@/components/media-viewer";
import { QuizCard } from "@/components/quiz-card";
import { FlashcardDeck } from "@/components/flashcard-deck";
import { VoicePanel } from "@/components/VoiceChat";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { getSignedWebSocketUrl } from "@/lib/signWebSocketUrl";
import { DataPanel, DropOverlay } from "@/components/DataPanel";

// ============================================
// Types
// ============================================
type ChecklistItem = {
  id: string;
  task: string;
  completed: boolean;
};

type ProgressSummary = {
  courses: { course_id: string; quiz_count: number; flashcards_reviewed: number; last_activity: string }[];
  total_quizzes: number;
  accuracy: number;
};

type CourseSummary = {
  id: string;
  title: string;
  subtopics: { id: string; title: string; order: number }[];
  type: string;
};

type AppMode = "training" | "self-study";

type LessonState = {
  subtopic_id: string;
  phase: "teaching" | "quiz" | "feedback" | "complete";
  attempts: number;
};

type TrainingState = {
  checklist: ChecklistItem[];
  topic: string;
  user_id: string;
  progress_summary: ProgressSummary | null;
  courses_summary: CourseSummary[] | null;
  active_course: string | null;
  active_subtopic: string | null;
  lesson_state?: LessonState;
  requested_mode?: "training" | "self-study";
};

type QuizState = {
  question: string;
  options: string[];
  correctIndex: number;
  selectedIndex: number | null;
  answered: boolean;
  resolve: ((result: string) => void) | null;
};

// ============================================
// Checklist Panel Component
// ============================================
function ChecklistPanel({ checklist, topic, onToggle, isCollapsed, onToggleCollapse, quizHistory, progressSummary, coursesSummary, activeCourse, activeSubtopic, onSelectCourse, onSelectSubtopic, onSendMessage, appMode, lessonState }: {
  checklist: ChecklistItem[]; topic: string; onToggle: (id: string) => void;
  isCollapsed: boolean; onToggleCollapse: () => void; quizHistory: { question: string; isCorrect: boolean; timestamp: number }[];
  progressSummary: ProgressSummary | null;
  coursesSummary: CourseSummary[] | null; activeCourse: string | null; activeSubtopic: string | null;
  onSelectCourse: (courseId: string | null) => void; onSelectSubtopic: (courseId: string, subtopicId: string) => void;
  onSendMessage: (message: string) => void; appMode: AppMode; lessonState?: LessonState;
}) {
  const hasChecklist = checklist.length > 0;
  const showCourses = appMode === "self-study";
  const defaultTab = hasChecklist ? "checklist" : (showCourses ? "courses" : "checklist");
  const [activeTab, setActiveTab] = useState<"checklist" | "progress" | "courses">(defaultTab);

  useEffect(() => {
    if (!showCourses && activeTab === "courses") {
      setActiveTab("checklist");
    }
  }, [showCourses, activeTab]);
  const [courseInput, setCourseInput] = useState("");
  const completedCount = checklist.filter((item) => item.completed).length;
  const progress = checklist.length > 0 ? (completedCount / checklist.length) * 100 : 0;
  // Combine persisted progress (from DynamoDB via agent) with current session quiz history
  const dbQuizzes = progressSummary?.total_quizzes ?? 0;
  const dbAccuracy = progressSummary?.accuracy ?? 0;
  const dbCorrect = dbQuizzes > 0 ? Math.round(dbAccuracy * dbQuizzes / 100) : 0;
  const sessionQuizzes = quizHistory.length;
  const sessionCorrect = quizHistory.filter((q) => q.isCorrect).length;
  const totalQuizzes = dbQuizzes + sessionQuizzes;
  const totalCorrect = dbCorrect + sessionCorrect;
  const accuracy = totalQuizzes > 0 ? Math.round((totalCorrect / totalQuizzes) * 100) : 0;
  let streak = 0;
  for (let i = quizHistory.length - 1; i >= 0; i--) { if (quizHistory[i].isCorrect) streak++; else break; }

  if (isCollapsed) {
    return (
      <div className="flex-shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <button
          onClick={onToggleCollapse}
          className="w-12 h-full flex flex-col items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          title="Expand checklist"
        >
          <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400" style={{ writingMode: "vertical-rl" }}>
            {completedCount}/{checklist.length}
          </span>
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={`${showCourses ? "w-80" : "w-64"} bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col h-full shadow-lg`}>
      {/* Tabbed Header */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-2">
          <div className="flex gap-1">
            <button onClick={() => setActiveTab("checklist")} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeTab === "checklist" ? "bg-white/20 text-white" : "text-white/60 hover:text-white/80"}`}>Checklist</button>
            <button onClick={() => setActiveTab("progress")} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeTab === "progress" ? "bg-white/20 text-white" : "text-white/60 hover:text-white/80"}`}>Progress</button>
            {showCourses && <button onClick={() => setActiveTab("courses")} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeTab === "courses" ? "bg-white/20 text-white" : "text-white/60 hover:text-white/80"}`}>Courses</button>}
          </div>
          <button onClick={onToggleCollapse} className="p-1 hover:bg-white/20 rounded transition-colors" title="Collapse sidebar">
            <svg className="w-4 h-4 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
        </div>
      </div>

      {activeTab === "checklist" && (<>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">{topic}</h3>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2"><div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} /></div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{completedCount} of {checklist.length} completed</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {checklist.map((item, index) => {
            const letter = String.fromCharCode(65 + index);
            return (
              <button key={item.id} onClick={() => onToggle(item.id)} className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all duration-200 ${item.completed ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}>
                <span className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-colors ${item.completed ? "bg-emerald-500 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"}`}>
                  {item.completed ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg> : letter}
                </span>
                <span className={`flex-1 text-sm font-medium ${item.completed ? "text-emerald-800 dark:text-emerald-200 line-through" : "text-slate-700 dark:text-slate-300"}`}>{item.task}</span>
              </button>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <p className="text-xs text-center text-slate-500 dark:text-slate-400">Try asking: &quot;How am I doing on my checklist?&quot;</p>
        </div>
      </>)}

      {activeTab === "progress" && (
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/20 p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{accuracy}%</p>
              <p className="text-[11px] text-slate-500 mt-1">Accuracy</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 p-4 text-center">
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{streak}</p>
              <p className="text-[11px] text-slate-500 mt-1">Streak</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{totalCorrect}/{totalQuizzes}</p>
              <p className="text-[11px] text-slate-500 mt-1">Correct</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-700 p-4 text-center">
              <p className="text-2xl font-bold text-slate-600 dark:text-slate-300">{Math.round(progress)}%</p>
              <p className="text-[11px] text-slate-500 mt-1">Checklist</p>
            </div>
          </div>
          {totalQuizzes > 0 ? (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Recent Results</h4>
              <div className="space-y-2">
                {quizHistory.slice(-8).reverse().map((q, i) => (
                  <div key={i} className={`flex items-center gap-2 p-2.5 rounded-lg text-xs ${q.isCorrect ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-red-50 dark:bg-red-950/20"}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${q.isCorrect ? "bg-emerald-500" : "bg-red-500"}`}>{q.isCorrect ? "✓" : "✗"}</span>
                    <span className="flex-1 text-slate-700 dark:text-slate-300 truncate">{q.question}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-slate-400">No quiz results yet</p>
              <p className="text-xs text-slate-400 mt-1">Try asking for a quiz!</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "courses" && showCourses && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {(!coursesSummary || coursesSummary.length === 0) && (
            <div className="text-center py-8 space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">No courses yet</p>
              <div className="px-2">
                <input
                  type="text"
                  value={courseInput}
                  onChange={(e) => setCourseInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && courseInput.trim()) { onSendMessage("create a course about " + courseInput.trim()); setCourseInput(""); } }}
                  placeholder="e.g. Amazon DynamoDB"
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder-slate-400"
                />
                <button
                  onClick={() => { if (courseInput.trim()) { onSendMessage("create a course about " + courseInput.trim()); setCourseInput(""); } }}
                  className="mt-2 w-full px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                >
                  Create a course
                </button>
              </div>
            </div>
          )}

          {coursesSummary && coursesSummary.length > 0 && !activeCourse && (
            <>
              {coursesSummary.map((course) => (
                <button
                  key={course.id}
                  onClick={() => onSelectCourse(course.id)}
                  className="w-full text-left p-3 rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all"
                >
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{course.title}</p>
                  <p className="text-xs text-slate-500 mt-1">{course.subtopics.length} subtopics · {course.type || "course"}</p>
                </button>
              ))}
              <div className="pt-2 px-2">
                <input
                  type="text"
                  value={courseInput}
                  onChange={(e) => setCourseInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && courseInput.trim()) { onSendMessage("create a course about " + courseInput.trim()); setCourseInput(""); } }}
                  placeholder="Create another course..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder-slate-400"
                />
              </div>
            </>
          )}

          {coursesSummary && activeCourse && (() => {
            const course = coursesSummary.find((c) => c.id === activeCourse);
            if (!course) return null;
            const sorted = [...course.subtopics].sort((a, b) => a.order - b.order);
            return (
              <>
                <button
                  onClick={() => onSelectCourse(null)}
                  className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium"
                >
                  ← All Courses
                </button>
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{course.title}</h4>
                <div className="space-y-1">
                  {sorted.map((st) => {
                    const isActive = activeSubtopic === st.id;
                    const isLessonActive = lessonState?.subtopic_id === st.id;
                    const lessonPhase = isLessonActive ? lessonState?.phase : null;
                    return (
                      <button
                        key={st.id}
                        onClick={() => onSelectSubtopic(course.id, st.id)}
                        className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${isActive ? "bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-300 dark:border-indigo-700" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}
                      >
                        {lessonPhase === "complete" ? (
                          <span className="flex-shrink-0 w-4 h-4 text-green-500">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          </span>
                        ) : isLessonActive ? (
                          <span className="flex-shrink-0 w-4 h-4 text-amber-500 animate-pulse">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                          </span>
                        ) : isActive ? (
                          <span className="flex-shrink-0 w-4 h-4 text-indigo-500">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </span>
                        ) : (
                          <span className="flex-shrink-0 text-xs text-slate-400">•</span>
                        )}
                        <span className={`flex-1 ${isActive ? "text-indigo-700 dark:text-indigo-300 font-medium" : "text-slate-700 dark:text-slate-300"}`}>{st.title}</span>
                        {isLessonActive && lessonPhase !== "complete" && (
                          <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium">
                            {lessonPhase === "teaching" ? "Learning" : lessonPhase === "quiz" ? "Quiz" : lessonPhase === "feedback" ? "Review" : ""}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Chat Component
// ============================================
function ChatPage() {
  // Quiz states
  const [quizStates, setQuizStates] = useState<Map<string, QuizState>>(new Map());
  // Ref kept in sync so handleQuizAnswer always reads current state (avoids stale closure)
  const quizStatesRef = useRef(quizStates);
  useEffect(() => {
    quizStatesRef.current = quizStates;
  }, [quizStates]);

  // Quiz history (local state, not synced with agent to avoid overwrite)
  const [quizHistory, setQuizHistory] = useState<{ question: string; isCorrect: boolean; timestamp: number }[]>([]);

  // Sidebar collapsed state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Local courses cache — survives agent state overwrites from StateSnapshotEvent
  const [localCourses, setLocalCourses] = useState<CourseSummary[] | null>(null);

  // Local active course/subtopic — survives agent state overwrites from StateSnapshotEvent
  const [localActiveCourse, setLocalActiveCourse] = useState<string | null>(null);
  const [localActiveSubtopic, setLocalActiveSubtopic] = useState<string | null>(null);

  // Text vs Voice mode
  const [mode, setMode] = useState<"text" | "voice">("text");

  // Right sidebar (Data Panel) collapsed state
  const [isDataPanelCollapsed, setIsDataPanelCollapsed] = useState(false);

  // App mode: training (KB-only) vs self-study (KB + web research + courses)
  const [appMode, setAppMode] = useState<AppMode>("training");

  // Extract user_id from Cognito JWT for progress tracking
  const { accessToken } = useAuthToken();
  const userId = (() => {
    try {
      if (!accessToken) return "";
      const payload = accessToken.split(".")[1];
      const claims = JSON.parse(atob(payload));
      return claims.sub || "";
    } catch { return ""; }
  })();

  // Voice runtime config (client-side signing)
  const voiceRuntimeArn = process.env.NEXT_PUBLIC_VOICE_RUNTIME_ARN || '';
  const awsRegion = process.env.NEXT_PUBLIC_AWS_REGION || 'us-west-2';

  const startVoiceSession = useCallback(async () => {
    if (!voiceRuntimeArn) return '';
    return getSignedWebSocketUrl(voiceRuntimeArn, awsRegion);
  }, [voiceRuntimeArn, awsRegion]);

  // Training Checklist shared state with agent via useCoAgent
  const { state: trainingState, setState: setTrainingState } = useCoAgent<TrainingState>({
    name: "strands_agent",
    initialState: {
      checklist: [],
      topic: "",
      user_id: "", // user_id derived from JWT server-side, not from client state
      progress_summary: null,
      courses_summary: null,
      active_course: null,
      active_subtopic: null,
      requested_mode: undefined,
    },
  });

  // Mode is persisted server-side via AG-UI shared state (requested_mode).
  // On toggle, we set requested_mode in the state — the agent reads it on
  // the next request, persists to DynamoDB, and uses it for tool filtering.
  const handleToggleMode = useCallback(() => {
    const newMode: AppMode = appMode === "training" ? "self-study" : "training";
    setAppMode(newMode);
    setTrainingState({ ...trainingState, requested_mode: newMode });
  }, [appMode, trainingState, setTrainingState]);

  // Handle checklist item toggle
  const handleChecklistToggle = useCallback(
    (itemId: string) => {
      if (!trainingState?.checklist) return;

      const updatedChecklist = trainingState.checklist.map((item) =>
        item.id === itemId ? { ...item, completed: !item.completed } : item
      );

      setTrainingState({
        ...trainingState,
        checklist: updatedChecklist,
      });
    },
    [trainingState, setTrainingState]
  );

  // Handle course selection
  const handleSelectCourse = useCallback((courseId: string | null) => {
    setLocalActiveCourse(courseId);
    setLocalActiveSubtopic(null);
    setTrainingState({ ...trainingState, active_course: courseId, active_subtopic: null });
  }, [trainingState, setTrainingState]);

  // Handle sending a message from sidebar (e.g. "create a course about X")
  const handleSidebarMessage = useCallback((message: string) => {
    // Programmatically submit a message to the chat
    const textarea = document.querySelector('.copilotKitInput textarea, .copilotKitInput input') as HTMLTextAreaElement | null;
    if (textarea) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textarea, message);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
          const sendBtn = textarea.closest('.copilotKitInput')?.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
          if (sendBtn) sendBtn.click();
        }, 100);
      }
    }
  }, []);

  // Handle subtopic selection
  const handleSelectSubtopic = useCallback((courseId: string, subtopicId: string) => {
    setLocalActiveCourse(courseId);
    setLocalActiveSubtopic(subtopicId);
    setTrainingState({ ...trainingState, active_course: courseId, active_subtopic: subtopicId });
    // Context is now set via active_course/active_subtopic in shared state.
    // The agent will scope subsequent KB queries automatically — no auto-sent message.
  }, [trainingState, setTrainingState]);

  // Sync courses from agent state when it has data (persists locally against overwrites)
  useEffect(() => {
    if (trainingState?.courses_summary && trainingState.courses_summary.length > 0) {
      setLocalCourses(trainingState.courses_summary);
    }
  }, [trainingState?.courses_summary]);

  // Sync mode from agent state (agent persists to DynamoDB and returns current mode)
  useEffect(() => {
    if (trainingState?.requested_mode && trainingState.requested_mode !== appMode) {
      setAppMode(trainingState.requested_mode);
    }
  }, [trainingState?.requested_mode]);

  // Hide CopilotKit branding via CSS injection
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      cpk-web-inspector { display: none !important; }
      p.poweredBy, .poweredBy { display: none !important; }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // ============================================
  // Quiz answer handler
  // ============================================
  const handleQuizAnswer = useCallback((quizId: string, selectedIndex: number) => {
    setQuizStates((prev: Map<string, QuizState>) => {
      const newMap = new Map(prev);
      const quiz = newMap.get(quizId);
      if (quiz && !quiz.answered) {
        const updatedQuiz = { ...quiz, selectedIndex, answered: true };
        newMap.set(quizId, updatedQuiz);

        if (quiz.resolve) {
          const isCorrect = selectedIndex === quiz.correctIndex;
          const questionText = quiz.question;
          quiz.resolve(
            JSON.stringify({
              event: "quiz_answer_submitted",
              question: quiz.question,
              options: quiz.options,
              selectedIndex,
              selectedAnswer: quiz.options[selectedIndex],
              correctIndex: quiz.correctIndex,
              correctAnswer: quiz.options[quiz.correctIndex],
              isCorrect,
              instruction: isCorrect
                ? "The user answered correctly. Briefly congratulate them with a citation from the knowledge base (use <ts> or <pg> tags). Then ask if they want another question."
                : `The user answered incorrectly. Explain why "${quiz.options[quiz.correctIndex]}" is the correct answer, citing the relevant knowledge base source with <ts> or <pg> tags. Then ask if they want another question.`,
            })
          );

          // Track quiz result (deferred to avoid blocking Promise)
          setTimeout(() => {
            setQuizHistory((prev) => {
              // Guard against duplicate tracking (React StrictMode / re-renders)
              if (prev.some((q) => q.question === questionText && Math.abs(q.timestamp - Date.now()) < 2000)) return prev;
              return [...prev, { question: questionText, isCorrect, timestamp: Date.now() }];
            });
          }, 100);
        }
      }
      return newMap;
    });
  }, []);

  // ============================================
  // FRONTEND TOOL - show_quiz_question (Promise-based, waits for user answer)
  // ============================================
  useCopilotAction({
    name: "show_quiz_question",
    description: "Display an interactive quiz question. Returns the user's answer.",
    parameters: [
      { name: "question", type: "string", description: "The quiz question", required: true },
      { name: "options", type: "string", description: "JSON array of 4 answer options", required: true },
      { name: "correctIndex", type: "number", description: "Index of correct answer (0-3)", required: true },
    ],
    handler: async ({ question, options, correctIndex }) => {
      let parsedOptions: string[];
      try {
        parsedOptions = typeof options === "string" ? JSON.parse(options) : options;
      } catch {
        return JSON.stringify({ error: "Invalid options format" });
      }

      const quizId = `quiz_${question.substring(0, 40)}`;

      return new Promise<string>((resolve) => {
        setQuizStates((prev: Map<string, QuizState>) => {
          const newMap = new Map(prev);
          newMap.set(quizId, {
            question,
            options: parsedOptions,
            correctIndex: Number(correctIndex),
            selectedIndex: null,
            answered: false,
            resolve,
          });
          return newMap;
        });
      });
    },
    render: ({ status, args, result }) => {
      const quizId = `quiz_${args?.question?.substring(0, 40)}`;
      const quiz = quizStatesRef.current.get(quizId);

      let displayOptions: string[] = [];
      try {
        displayOptions =
          typeof args?.options === "string" ? JSON.parse(args.options) : args?.options || [];
      } catch {
        displayOptions = [];
      }

      if (status === "inProgress" && !quiz) {
        return (
          <QuizCard
            question=""
            options={[]}
            correctIndex={0}
            selectedIndex={null}
            isAnswered={false}
            onAnswer={() => {}}
            isLoading={true}
          />
        );
      }

      let resultData: { selectedIndex?: number } = {};
      if (result) {
        try {
          resultData = JSON.parse(result);
        } catch {}
      }

      return (
        <QuizCard
          question={args?.question || ""}
          options={displayOptions}
          correctIndex={Number(args?.correctIndex)}
          selectedIndex={quiz?.selectedIndex ?? resultData.selectedIndex ?? null}
          isAnswered={quiz?.answered || resultData.selectedIndex !== undefined}
          onAnswer={(index) => handleQuizAnswer(quizId, index)}
        />
      );
    },
  });

  // ============================================
  // FRONTEND TOOL - show_flashcards (display only, resolves immediately)
  // ============================================
  useCopilotAction({
    name: "show_flashcards",
    description: "Display flashcards. Returns immediately.",
    parameters: [
      { name: "topic", type: "string", description: "The topic", required: true },
      { name: "cards_json", type: "string", description: "JSON array of {front, back} cards", required: true },
    ],
    handler: async ({ topic, cards_json }) => {
      return JSON.stringify({ displayed: true, topic });
    },
    render: ({ status, args }) => {
      if (status === "inProgress") {
        return <FlashcardDeck cards={[]} topic="" isLoading={true} />;
      }
      try {
        const cards = typeof args?.cards_json === "string" ? JSON.parse(args.cards_json) : args?.cards_json;
        if (cards && cards.length > 0) {
          return <FlashcardDeck cards={cards} topic={args?.topic || "Study Cards"} />;
        }
      } catch {}
      return <></>;
    },
  });

  // Markdown tag renderers for inline citations
  const customMarkdownTagRenderers = {
    src: ({
      children,
      num,
      url,
    }: {
      children?: React.ReactNode;
      num?: string;
      url?: string;
    }) => {
      const displayNum = num || (typeof children === "string" ? children : "");
      const hasUrl = url && url !== "#" && url.startsWith("http");
      if (hasUrl) {
        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-full transition-colors mx-0.5 border border-indigo-200 dark:border-indigo-800 no-underline cursor-pointer"
            title={url}
          >
            {displayNum}
          </a>
        );
      }
      return (
        <span
          className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full mx-0.5 border border-slate-200 dark:border-slate-700"
          title="Source reference"
        >
          {displayNum}
        </span>
      );
    },
    ts: ({
      children,
      time,
      file,
    }: {
      children?: React.ReactNode;
      time?: string;
      file?: string;
    }) => {
      const displayTime = time || (typeof children === "string" ? children : "");
      return (
        <button
          onClick={() => {
            if (typeof window !== "undefined" && (window as any).seekVideo && file) {
              (window as any).seekVideo(displayTime, file);
            }
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 rounded-md transition-colors mx-0.5 border border-rose-200 dark:border-rose-800"
          title={file ? `Jump to ${displayTime} in ${file}` : `Jump to ${displayTime}`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
          </svg>
          {displayTime}
        </button>
      );
    },
    pg: ({
      children,
      num,
      file,
    }: {
      children?: React.ReactNode;
      num?: string;
      file?: string;
    }) => {
      const displayNum = num || (typeof children === "string" ? children.replace(/[^0-9]/g, "") : "");
      return (
        <button
          onClick={() => {
            if (typeof window !== "undefined" && (window as any).openPDF && file) {
              (window as any).openPDF(displayNum, file);
            }
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-md transition-colors mx-0.5 border border-blue-200 dark:border-blue-800"
          title={file ? `Go to page ${displayNum} in ${file}` : `Go to page ${displayNum}`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Page {displayNum}
        </button>
      );
    },
  };

  // Always show sidebar — it has Courses tab for course creation even when empty
  const hasSidebar = true;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Title Bar - AWS branding */}
      <header className="flex-shrink-0 h-12 bg-[#232f3e] flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </div>
          <span className="text-sm font-semibold text-white">AnyCompany Assistant</span>
        </div>
        {/* Mode Toggle */}
        <button
          onClick={handleToggleMode}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-white/10 hover:bg-white/20 text-white/80 hover:text-white"
          title={appMode === "training" ? "Switch to Self-Study mode (enables web research & course creation)" : "Switch to Training mode (KB-only)"}
        >
          {appMode === "training" ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Training
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              Self-Study
            </>
          )}
        </button>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Checklist Sidebar */}
        {hasSidebar && (
          <ChecklistPanel
            checklist={trainingState.checklist || []}
            topic={trainingState.topic || "Learning Plan"}
            onToggle={handleChecklistToggle}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            quizHistory={quizHistory}
            progressSummary={trainingState?.progress_summary || null}
            coursesSummary={localCourses || trainingState?.courses_summary || null}
            activeCourse={localActiveCourse || trainingState.active_course || null}
            activeSubtopic={localActiveSubtopic || trainingState.active_subtopic || null}
            onSelectCourse={handleSelectCourse}
            onSelectSubtopic={handleSelectSubtopic}
            onSendMessage={handleSidebarMessage}
            appMode={appMode}
            lessonState={trainingState.lesson_state}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mode Tabs */}
          <div className="flex-shrink-0 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4">
            <div className="flex gap-1 pt-2">
              <button
                onClick={() => setMode("text")}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  mode === "text"
                    ? "bg-slate-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-b-0 border-slate-200 dark:border-slate-700"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Text
                </span>
              </button>
              <button
                onClick={() => setMode("voice")}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  mode === "voice"
                    ? "bg-slate-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-b-0 border-slate-200 dark:border-slate-700"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  Voice
                </span>
              </button>
            </div>
          </div>

          {/* Chat Interface (Text mode) */}
          <div className={`flex-1 overflow-hidden pb-4 ${mode !== "text" ? "hidden" : ""}`}>
            <CopilotChat
              labels={{
                title: "AnyCompany Assistant",
                initial:
                  "Hi! I'm your AI learning tutor. I can create courses from any topic by researching the web, teach you with interactive quizzes and flashcards, track your progress, and adapt to how you learn. Try: \"Create a course about Amazon Bedrock\" or \"Quiz me on fire tablets\" or ask me anything.",
              }}
              icons={{
                activityIcon: <ThinkingIndicator />,
              }}
              instructions="You are a helpful assistant with access to a multimodal knowledge base."
              markdownTagRenderers={customMarkdownTagRenderers as any}
              className="h-full"
            />
          </div>

          {/* Voice Interface (Voice mode) */}
          <div className={`flex-1 overflow-hidden ${mode !== "voice" ? "hidden" : ""}`}>
            <VoicePanel
              getSignedUrl={startVoiceSession}
            />
          </div>
        </div>

        {/* Right Sidebar — Data Panel */}
        <DataPanel
          isCollapsed={isDataPanelCollapsed}
          onToggleCollapse={() => setIsDataPanelCollapsed(!isDataPanelCollapsed)}
          onSendMessage={handleSidebarMessage}
        />
      </div>

      {/* Global drop overlay */}
      <DropOverlay onFilesDropped={(files) => {
        setIsDataPanelCollapsed(false);
        // Trigger upload via a custom event that DataPanel listens to
        window.dispatchEvent(new CustomEvent("datapanel:upload", { detail: files }));
      }} />

      {/* Media Viewer */}
      <MediaViewer />
    </div>
  );
}

// ============================================
// Root Component with CopilotKit Provider + Auth
// ============================================
export default function CopilotKitPage() {
  const { accessToken, isLoading } = useAuthToken();

  // Use API Gateway URL if set, otherwise fall back to local proxy
  const runtimeUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL
    ? process.env.NEXT_PUBLIC_API_GATEWAY_URL.replace(/\/$/, '')
    : '/api/copilotkit';

  if (isLoading || !accessToken) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
        <div className="text-lg text-slate-600 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <CopilotKit
      runtimeUrl={runtimeUrl}
      headers={{ Authorization: `Bearer ${accessToken}` }}
      agent="strands_agent"
    >
      <ChatPage />
    </CopilotKit>
  );
}
