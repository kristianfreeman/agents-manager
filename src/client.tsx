import "./styles.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Providers } from "@/providers";
import Home from "@/pages/Home";
import Chat from "@/pages/Chat";
import Setup from "@/pages/Setup";
import Task from "@/pages/Task";

const root = createRoot(document.getElementById("app")!);

root.render(
  <BrowserRouter>
    <Providers>
      <div className="bg-neutral-50 text-base text-neutral-900 antialiased transition-colors selection:bg-blue-700 selection:text-white dark:bg-neutral-950 dark:text-neutral-100">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/:id" element={<Task />} />
        </Routes>
      </div>
    </Providers>
  </BrowserRouter>
);
