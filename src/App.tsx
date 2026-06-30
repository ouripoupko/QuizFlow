import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { HomePage } from "@/pages/HomePage";
import { SignInPage } from "@/pages/SignInPage";
import { QuizzesPage } from "@/pages/teacher/QuizzesPage";
import { QuizEditorPage } from "@/pages/teacher/QuizEditorPage";
import { SettingsPage } from "@/pages/teacher/SettingsPage";
import { JoinPage } from "@/pages/student/JoinPage";
import { QuizRuntimePage } from "@/pages/student/QuizRuntimePage";
import { ControlBoardPage } from "@/pages/teacher/ControlBoardPage";
import { TopicsPage } from "@/pages/TopicsPage";
import { AdminTopicsPage } from "@/pages/admin/AdminTopicsPage";
import { CoursesPage } from "@/pages/teacher/CoursesPage";
import { CourseEditorPage } from "@/pages/teacher/CourseEditorPage";
import { useAuthStore } from "@/store/authStore";

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
    <Routes>
      <Route
        path="/sign-in"
        element={status === "authenticated" ? <Navigate to="/" replace /> : <SignInPage />}
      />
      <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/teacher/quizzes" element={<ProtectedRoute><QuizzesPage /></ProtectedRoute>} />
      <Route path="/teacher/quizzes/:quizId" element={<ProtectedRoute><QuizEditorPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/join/:token" element={<ProtectedRoute><JoinPage /></ProtectedRoute>} />
      <Route path="/session/:sessionId" element={<ProtectedRoute><QuizRuntimePage /></ProtectedRoute>} />
      <Route path="/session/:sessionId/board" element={<ProtectedRoute><ControlBoardPage /></ProtectedRoute>} />
      <Route path="/teacher/courses" element={<ProtectedRoute><CoursesPage /></ProtectedRoute>} />
      <Route path="/teacher/courses/:courseId" element={<ProtectedRoute><CourseEditorPage /></ProtectedRoute>} />
      <Route path="/topics" element={<ProtectedRoute><TopicsPage /></ProtectedRoute>} />
      <Route path="/admin/topics" element={<ProtectedRoute><AdminTopicsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
