import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
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
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/" element={<HomePage />} />
        <Route path="/teacher/quizzes" element={<QuizzesPage />} />
        <Route path="/teacher/quizzes/:quizId" element={<QuizEditorPage />} />
        <Route path="/teacher/courses" element={<CoursesPage />} />
        <Route path="/teacher/courses/:courseId" element={<CourseEditorPage />} />
        <Route path="/topics" element={<TopicsPage />} />
        <Route path="/admin/topics" element={<AdminTopicsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/join/:token" element={<ProtectedRoute><JoinPage /></ProtectedRoute>} />
      <Route path="/session/:sessionId" element={<ProtectedRoute><QuizRuntimePage /></ProtectedRoute>} />
      <Route path="/session/:sessionId/board" element={<ProtectedRoute><ControlBoardPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
