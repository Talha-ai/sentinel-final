import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import Test from "./Test.tsx";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import DeviceAndBrowserGate from "./components/DeviceAndBrowserGate.tsx";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <DeviceAndBrowserGate>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<App />} />
                    <Route path="/:id" element={<App />} />
                    <Route path="/testing" element={<Test />} />
                </Routes>
            </BrowserRouter>
        </DeviceAndBrowserGate>
        {/* <BrowserRouter>
            <Routes>
                <Route path="/" element={<App />} />
                <Route path="/:id" element={<App />} />
                <Route path="/testing" element={<Test />} />
            </Routes>
        </BrowserRouter> */}
    </StrictMode>
);
