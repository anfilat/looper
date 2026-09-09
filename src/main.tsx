import { createRoot } from "react-dom/client";
import "./style.css";
import { App } from "./App";

const container = document.getElementById("app")!;
createRoot(container).render(<App />);
