import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { TeacherRoute } from "@/components/TeacherRoute";
import { AppLayout } from "@/components/AppLayout";
import { SignInPage } from "@/pages/SignInPage";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/authStore";

// Route-level code splitting: everything past the sign-in gate is its own
// chunk, fetched on demand, instead of one bundle containing every teacher
// and student page (control board, quiz editor + QR/session history,
// admin, courses...) whether or not this visitor ever uses them.
// SignInPage stays a normal import — it's the very first thing an
// unauthenticated visitor needs, so splitting it out would only add a
// round-trip before anything renders, for a component that's tiny anyway.
const MyQuizzesPage = lazy(() => import("@/pages/MyQuizzesPage").then((m) => ({ default: m.MyQuizzesPage })));
const QuizEditorPage = lazy(() =>
  import("@/pages/teacher/QuizEditorPage").then((m) => ({ default: m.QuizEditorPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/teacher/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const JoinPage = lazy(() => import("@/pages/student/JoinPage").then((m) => ({ default: m.JoinPage })));
const QuizRuntimePage = lazy(() =>
  import("@/pages/student/QuizRuntimePage").then((m) => ({ default: m.QuizRuntimePage })),
);
const ControlBoardPage = lazy(() =>
  import("@/pages/teacher/ControlBoardPage").then((m) => ({ default: m.ControlBoardPage })),
);
const TopicsPage = lazy(() => import("@/pages/TopicsPage").then((m) => ({ default: m.TopicsPage })));
const AdminPage = lazy(() => import("@/pages/admin/AdminPage").then((m) => ({ default: m.AdminPage })));
const CoursesPage = lazy(() =>
  import("@/pages/teacher/CoursesPage").then((m) => ({ default: m.CoursesPage })),
);
const CourseEditorPage = lazy(() =>
  import("@/pages/teacher/CourseEditorPage").then((m) => ({ default: m.CourseEditorPage })),
);

export function App() {
  const status = useAuthStore((s) => s.status);
  const navigate = useNavigate();

  // After Google OAuth redirect, Supabase sends the user back to the app root.
  // If we saved a returnTo path (set by ProtectedRoute), navigate there.
  useEffect(() => {
    if (status === "authenticated") {
      const returnTo = sessionStorage.getItem("returnTo");
      if (returnTo) {
        sessionStorage.removeItem("returnTo");
        navigate(returnTo, { replace: true });
      }
    }
  }, [status, navigate]);

  return (
    <Suspense fallback={<p style={{ padding: "var(--space-6)" }}>{t.common.loading}</p>}>
      <Routes>
        <Route
          path="/sign-in"
          element={status === "authenticated" ? <Navigate to="/my-quizzes" replace /> : <SignInPage />}
        />
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/my-quizzes" element={<MyQuizzesPage />} />
          <Route path="/teacher/quizzes/:quizId" element={<QuizEditorPage />} />
          <Route path="/teacher/courses" element={<CoursesPage />} />
          <Route path="/teacher/courses/:courseId" element={<CourseEditorPage />} />
          <Route path="/topics" element={<TeacherRoute><TopicsPage /></TeacherRoute>} />
          <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          <Route path="/settings" element={<TeacherRoute><SettingsPage /></TeacherRoute>} />
        </Route>
        <Route path="/join/:token" element={<ProtectedRoute><JoinPage /></ProtectedRoute>} />
        <Route path="/session/:sessionId" element={<ProtectedRoute><QuizRuntimePage /></ProtectedRoute>} />
        <Route path="/session/:sessionId/board" element={<ProtectedRoute><ControlBoardPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/my-quizzes" replace />} />
      </Routes>
    </Suspense>
  );
}
