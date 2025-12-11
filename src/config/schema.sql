CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    device_id VARCHAR(255),
    device_Country VARCHAR(100),
    device_ipAddress VARCHAR(100),
    device_fingerprint VARCHAR(255),
    device_systemVersion VARCHAR(100),
    device_model VARCHAR(100),
    device_IDFV VARCHAR(100),
    device_serialNumber VARCHAR(100),
    device_UUID VARCHAR(100),
    device_macAddress VARCHAR(100),
    activated_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_code ON licenses(code);
CREATE INDEX idx_device_id ON licenses(device_id);
CREATE INDEX idx_status ON licenses(status);

-- Função para gerar códigos aleatórios
CREATE OR REPLACE FUNCTION generate_license_code() 
RETURNS VARCHAR(50) AS $$
DECLARE
    code VARCHAR(50);
BEGIN
    code := UPPER(substring(md5(random()::text) from 1 for 4) || '-' ||
                  substring(md5(random()::text) from 1 for 4) || '-' ||
                  substring(md5(random()::text) from 1 for 4) || '-' ||
                  substring(md5(random()::text) from 1 for 4));
    RETURN code;
END;
$$ LANGUAGE plpgsql;
