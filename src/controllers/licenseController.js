const { getPool } = require("../config/database");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const { LRUCache } = require("lru-cache");

// Hash do device fingerprint
const hashDevice = (deviceId) => {
	return crypto.createHash("sha256").update(deviceId).digest("hex");
};

const getClientIP = (req) => {
	// Ordem de prioridade: Cloudflare/Proxy headers -> X-Forwarded-For -> X-Real-IP -> Express req.ip -> socket
	const ip =
		req.headers["cf-connecting-ip"] ||
		req.headers["true-client-ip"] ||
		req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
		req.headers["x-real-ip"] ||
		req.ip ||
		req.connection?.remoteAddress ||
		req.socket?.remoteAddress ||
		null;

	console.log("[IP] Headers:", {
		"cf-connecting-ip": req.headers["cf-connecting-ip"],
		"true-client-ip": req.headers["true-client-ip"],
		"x-forwarded-for": req.headers["x-forwarded-for"],
		"x-real-ip": req.headers["x-real-ip"],
		remoteAddress: req.connection?.remoteAddress || req.socket?.remoteAddress,
		"req.ip": req.ip,
	});
	console.log("[IP] IP detectado:", ip);

	return ip;
};
// Gerar token JWT
const generateToken = (licenseData) => {
	return jwt.sign(
		{
			code: licenseData.code,
			deviceId: licenseData.device_id,
			expiresAt: licenseData.expires_at,
		},
		process.env.JWT_SECRET,
		{ expiresIn: "31d" },
	);
};

const rateLimitByDevice = new LRUCache({ max: 5000, ttl: 1000 * 60 * 60 }); // 1h cache
// Ajuste generateToken para token curto (ou crie uma versão separada)
const generateShortLivedToken = (licenseData) => {
	return jwt.sign(
		{
			code: licenseData.code,
			deviceHash: hashDevice(licenseData.device_id),
		},
		process.env.JWT_SECRET,
		{ expiresIn: "15m" }, // curto: 15 minutos
	);
};

// POST /api/license/activate
exports.activate = async (req, res) => {
	const {
		code,
		device_id,
		device_systemVersion,
		device_model,
		device_IDFV,
		device_serialNumber,
		device_UUID,
		device_macAddress,
	} = req.body || {};

	if (!code || !device_id) {
		return res
			.status(400)
			.json({ error: "Código e device_id são obrigatórios" });
	}

	let client;
	try {
		const pool = getPool();
		client = await pool.connect();
		await client.query("BEGIN");

		// Bloqueia a licença durante o fluxo para evitar corridas
		const result = await client.query(
			"SELECT * FROM licenses WHERE code = $1 FOR UPDATE",
			[code.toUpperCase()],
		);

		if (result.rows.length === 0) {
			await client.query("ROLLBACK");
			return res.status(404).json({ error: "Código de licença inválido" });
		}

		const license = result.rows[0];
		const deviceHash = hashDevice(device_id);

		// Verificar se já expirou ANTES de qualquer outra verificação
		const now = new Date();
		const expiresAt = new Date(license.expires_at);
		if (now > expiresAt) {
			// Atualizar status para expired
			await client.query(
				"UPDATE licenses SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE code = $1",
				[code.toUpperCase()],
			);
			await client.query("COMMIT");
			return res.status(410).json({
				error: "Esta licença expirou",
				expired_at: license.expires_at,
				server_time: now.toISOString(),
			});
		}

		// Verificar se já está ativada
		if (license.status === "active") {
			if (license.device_fingerprint !== deviceHash) {
				await client.query("ROLLBACK");
				return res.status(403).json({
					error: "Esta licença já está ativada em outro dispositivo",
				});
			}

			const token = generateToken(license);
			await client.query("COMMIT");
			return res.json({
				success: true,
				token,
				expires_at: license.expires_at,
				server_time: new Date().toISOString(),
				message: "Licença já ativada neste dispositivo",
			});
		}
		if (new Date() > new Date(license.expires_at)) {
			await client.query("ROLLBACK");
			return res.status(410).json({ error: "Esta licença expirou" });
		}

		// Capturar IP da requisição
		const clientIP = getClientIP(req);
		console.log(
			`[ACTIVATE] device_localIP from body: ${req.body.device_localIP}`,
		);
		console.log(`[ACTIVATE] Request IP: ${clientIP}`);

		const updateResult = await client.query(
			`UPDATE licenses 
             SET device_id = $1, 
                 device_fingerprint = $2,
                 device_ipAddress = $3,
                 device_systemversion = $4,
                 device_model = $5,
                 device_idfv = $6,
                 device_serialnumber = $7,
                 device_uuid = $8,
                 device_macaddress = $9,
                 status = 'active', 
                 activated_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE code = $10
             RETURNING *`,
			[
				device_id,
				deviceHash,
				clientIP,
				device_systemVersion || null,
				device_model || null,
				device_IDFV || null,
				device_serialNumber || null,
				device_UUID || null,
				device_macAddress || null,
				code.toUpperCase(),
			],
		);

		const activatedLicense = updateResult.rows[0];
		const token = generateToken(activatedLicense);

		await client.query("COMMIT");

		res.json({
			success: true,
			token,
			expires_at: activatedLicense.expires_at,
			server_time: new Date().toISOString(),
			device_ipAddress: clientIP,
			message: "Licença ativada com sucesso",
		});
	} catch (error) {
		if (client) {
			try {
				await client.query("ROLLBACK");
			} catch (_) {}
		}
		console.error("Erro ao ativar licença:", error);
		res.status(500).json({ error: "Erro interno do servidor" });
	} finally {
		if (client) client.release();
	}
};

// GET /api/license/validate
exports.validate = async (req, res) => {
	const {
		device_id,
		device_systemVersion,
		device_model,
		device_IDFV,
		device_serialNumber,
		device_UUID,
		device_macAddress,
	} = req.body || {};
	const licenseData = req.license; // Vem do middleware de auth

	if (!device_id) {
		return res.status(400).json({ error: "device_id é obrigatório" });
	}

	try {
		const pool = getPool();
		const result = await pool.query("SELECT * FROM licenses WHERE code = $1", [
			licenseData.code,
		]);

		if (result.rows.length === 0) {
			return res
				.status(404)
				.json({ valid: false, error: "Licença não encontrada" });
		}

		const license = result.rows[0];
		const deviceHash = hashDevice(device_id);

		// Verificar device
		if (license.device_fingerprint !== deviceHash) {
			return res.status(403).json({
				valid: false,
				error: "Dispositivo não autorizado",
			});
		}

		// Verificar expiração
		if (new Date() > new Date(license.expires_at)) {
			await pool.query(
				"UPDATE licenses SET status = 'expired' WHERE code = $1",
				[license.code],
			);
			return res.status(410).json({
				valid: false,
				error: "Licença expirada",
			});
		}

		// Verificar status
		if (license.status !== "active") {
			return res.status(403).json({
				valid: false,
				error: "Licença não está ativa",
			});
		}

		// Capturar IP da requisição
		const clientIP = getClientIP(req);
		console.log(
			`[VALIDATE] device_localIP from body: ${req.body.device_localIP}`,
		);
		console.log(`[VALIDATE] Request IP: ${clientIP}`);

		// Atualizar informações do dispositivo (caso tenha mudado iOS version, etc)
		await pool.query(
			`UPDATE licenses 
             SET device_systemversion = COALESCE($1, device_systemversion),
                 device_model = COALESCE($2, device_model),
                 device_idfv = COALESCE($3, device_idfv),
                 device_serialnumber = COALESCE($4, device_serialnumber),
                 device_uuid = COALESCE($5, device_uuid),
                 device_macaddress = COALESCE($6, device_macaddress),
                 device_ipAddress = $7,
                 updated_at = CURRENT_TIMESTAMP
             WHERE code = $8`,
			[
				device_systemVersion,
				device_model,
				device_IDFV,
				device_serialNumber,
				device_UUID,
				device_macAddress,
				clientIP,
				license.code,
			],
		);

		res.json({
			valid: true,
			expires_at: license.expires_at,
			server_time: new Date().toISOString(),
			device_ipAddress: clientIP,
			days_remaining: Math.ceil(
				(new Date(license.expires_at) - Date.now()) / (1000 * 60 * 60 * 24),
			),
		});
	} catch (error) {
		console.error("Erro ao validar licença:", error);
		res.status(500).json({ error: "Erro interno do servidor" });
	}
};

// POST /api/license/device
exports.device = async (req, res) => {
	const {
		device_id,
		device_systemVersion,
		device_model,
		device_IDFV,
		device_serialNumber,
		device_UUID,
		device_macAddress,
	} = req.body || {};

	if (!device_id) {
		return res.status(400).json({ error: "device_id é obrigatório" });
	}

	// Rate-limit por device_id simples (em memória). Em produção use Redis.
	try {
		const key = `dev:${hashDevice(device_id)}`;
		const entry = rateLimitByDevice.get(key) || { count: 0, first: Date.now() };
		const now = Date.now();

		// janela de 60s, max 6 reqs
		if (now - entry.first < 60 * 1000) {
			entry.count++;
			if (entry.count > 6) {
				rateLimitByDevice.set(key, entry);
				return res
					.status(429)
					.json({ error: "Muitas requisições. Tente novamente mais tarde." });
			}
		} else {
			// reset janela
			entry.count = 1;
			entry.first = now;
		}
		rateLimitByDevice.set(key, entry);
	} catch (e) {
		// se LRU falhar, continue (não bloquear o fluxo)
		console.warn("rate limit failed", e);
	}

	let client;
	try {
		const pool = getPool();
		client = await pool.connect();
		await client.query("BEGIN");

		// Localiza licença ativa vinculada ao device ou por código do body (se quiser)
		// Aqui assumimos que o device ja foi ativado antes com `activate` OR existe a licença vinculada a este device.
		// Buscamos por device_fingerprint.
		const deviceHash = hashDevice(device_id);
		const result = await client.query(
			`SELECT * FROM licenses WHERE device_fingerprint = $1 FOR UPDATE`,
			[deviceHash],
		);

		if (result.rows.length === 0) {
			// Alternativa: se não encontrar por device, você pode procurar por code enviado (não enviamos code aqui)
			await client.query("COMMIT");
			return res.status(404).json({
				valid: false,
				error: "Licença para este dispositivo não encontrada",
			});
		}

		const license = result.rows[0];

		// Verificar expiração
		if (new Date() > new Date(license.expires_at)) {
			await client.query(
				"UPDATE licenses SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE code = $1",
				[license.code],
			);
			await client.query("COMMIT");
			return res.status(410).json({
				valid: false,
				error: "Licença expirou",
				expired_at: license.expires_at,
				server_time: new Date().toISOString(),
			});
		}

		// Verificar status
		if (license.status !== "active") {
			await client.query("ROLLBACK");
			return res
				.status(403)
				.json({ valid: false, error: "Licença não está ativa" });
		}

		// Atualizar dados do device (sem expor dados sensíveis no retorno)
		await client.query(
			`UPDATE licenses
             SET device_systemversion = COALESCE($1, device_systemversion),
                 device_model = COALESCE($2, device_model),
                 device_idfv = COALESCE($3, device_idfv),
                 device_serialnumber = COALESCE($4, device_serialnumber),
                 device_uuid = COALESCE($5, device_uuid),
                 device_macaddress = COALESCE($6, device_macaddress),
                 updated_at = CURRENT_TIMESTAMP
             WHERE code = $7`,
			[
				device_systemVersion,
				device_model,
				device_IDFV,
				device_serialNumber,
				device_UUID,
				device_macAddress,
				license.code,
			],
		);

		// Gerar short-lived token
		const token = generateShortLivedToken({ code: license.code, device_id });

		await client.query("COMMIT");

		// Retornar apenas o necessário
		return res.json({
			valid: true,
			code: license.code,
			expires_at: license.expires_at,
			server_time: new Date().toISOString(),
			token, // curiquíssimo: 15m
		});
	} catch (error) {
		if (client) {
			try {
				await client.query("ROLLBACK");
			} catch (_) {}
		}
		console.error("Erro em /device:", error);
		return res.status(500).json({ error: "Erro interno do servidor" });
	} finally {
		if (client) client.release();
	}
};

// POST /api/license/generate (admin)
exports.generate = async (req, res) => {
	const { days = 30, quantity = 1, secret } = req.body || {};

	if (!process.env.ADMIN_SECRET) {
		return res
			.status(500)
			.json({ error: "ADMIN_SECRET não configurado no servidor" });
	}

	if (secret !== process.env.ADMIN_SECRET) {
		return res.status(401).json({ error: "Código secreto inválido" });
	}

	const daysInt = Number(days);
	const quantityInt = Number(quantity);

	if (!Number.isInteger(daysInt) || daysInt <= 0 || daysInt > 3650) {
		return res
			.status(400)
			.json({ error: "Parâmetro days precisa ser um inteiro entre 1 e 3650" });
	}

	if (!Number.isInteger(quantityInt) || quantityInt <= 0 || quantityInt > 100) {
		return res.status(400).json({
			error: "Parâmetro quantity precisa ser um inteiro entre 1 e 100",
		});
	}

	try {
		const pool = getPool();
		const codes = [];

		for (let i = 0; i < quantityInt; i++) {
			const result = await pool.query(
				`INSERT INTO licenses (code, expires_at)
                 VALUES (generate_license_code(), CURRENT_TIMESTAMP + make_interval(days => $1))
                 RETURNING code, expires_at`,
				[daysInt],
			);
			codes.push(result.rows[0]);
		}

		res.json({
			success: true,
			licenses: codes,
			count: codes.length,
		});
	} catch (error) {
		console.error("Erro ao gerar licenças:", error);
		res.status(500).json({ error: "Erro interno do servidor" });
	}
};
