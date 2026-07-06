import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import http from "http";
import dotenv from "dotenv";
import { setupRoutes } from "./src/api-routes";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3001", 10);

  const server = http.createServer(app);

  // Set up API routes and WebSockets
  setupRoutes(app, server);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: { port: 24679 } // Avoid conflict with port 24678
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
