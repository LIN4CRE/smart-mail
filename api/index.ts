import express from "express";
import { setupRoutes } from "../src/api-routes";

const app = express();
setupRoutes(app);

export default app;
