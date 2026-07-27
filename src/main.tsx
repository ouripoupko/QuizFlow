import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "@/App";
import { initAuth } from "@/auth/auth";
import { activeLocale, dir } from "@/i18n";
import { queryClient } from "@/lib/queryClient";
import "@/styles/global.scss";

// Keep <html> in sync with the active locale (spec §11: Hebrew + RTL baseline).
document.documentElement.lang = activeLocale;
document.documentElement.dir = dir;

// Start listening to Supabase auth before the app renders.
initAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
