import express from "express";
import { setupRoutes } from "../src/routes";

const app = express();
setupRoutes(app);

export default app;
