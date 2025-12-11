const express = require("express");
const cors = require("cors");
require("dotenv").config();

const licenseRoutes = require("./routes/license");

const app = express();

// Confiar em proxies (Vercel/Cloudflare/Nginx) para usar x-forwarded-for corretamente
app.set("trust proxy", true);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rotas
app.use("/api/license", licenseRoutes);

// Health check
app.get("/health", (_req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
	res.status(404).json({ error: "Rota não encontrada" });
});

// Error handler
app.use((err, _req, res) => {
	console.error(err.stack);
	res.status(500).json({ error: "Erro interno do servidor" });
});

module.exports = app;
