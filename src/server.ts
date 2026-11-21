import "dotenv/config";
import express from "express";
import { checkoutHandler } from "./patch/checkout_handler";
import { pool } from "./config/database";

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "degraded", database: "disconnected" });
  }
});

app.post("/api/checkout", checkoutHandler);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Assessment API listening on http://localhost:${port}`));
