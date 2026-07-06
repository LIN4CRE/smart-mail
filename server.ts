import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import http from "http";
import { setupRoutes } from "./src/routes";

const PORT = parseInt(process.env.PORT || "3000", 10);

async function startDevServer() {
  const app = express();
  setupRoutes(app);

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  const server = http.createServer(app);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Dev server running on http://localhost:${PORT}`);
  });
}

startDevServer();
