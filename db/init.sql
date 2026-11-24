-- Inicializacion de base de datos PostgreSQL 16 para Caso 18: Libros Impresos S.A.
-- Esquemas aislados por dominio: auth, clients, inventory, orders, payments

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS clients;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS orders;
CREATE SCHEMA IF NOT EXISTS payments;

-- ============================================================================
-- ESQUEMA AUTH
-- ============================================================================
CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_funcionario VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('FUNCIONARIO', 'CAJERO', 'ADMINISTRADOR')),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    user_agent VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth.sessions(user_id);

-- ============================================================================
-- ESQUEMA CLIENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS clients.sucursales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(32) UNIQUE NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    direccion VARCHAR(200) NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS clients.casinos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(32) UNIQUE NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    tipo VARCHAR(32) NOT NULL CHECK (tipo IN ('CAFETERIA', 'COMEDOR')),
    sucursal_id UUID NOT NULL REFERENCES clients.sucursales(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS clients.perfiles_comensal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(40) UNIQUE NOT NULL,
    nombre VARCHAR(80) NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    permite_multi_vale BOOLEAN NOT NULL DEFAULT FALSE,
    max_vales_por_horario INT NOT NULL DEFAULT 1 CHECK (max_vales_por_horario >= 1),
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS clients.funcionarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_funcionario VARCHAR(32) UNIQUE NOT NULL,
    rut VARCHAR(20) UNIQUE NOT NULL,
    nombre_completo VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('FUNCIONARIO', 'CAJERO', 'ADMINISTRADOR')),
    perfil_id UUID NOT NULL REFERENCES clients.perfiles_comensal(id),
    sucursal_base_id UUID NOT NULL REFERENCES clients.sucursales(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients.turnos_mensuales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funcionario_id UUID NOT NULL REFERENCES clients.funcionarios(id) ON DELETE CASCADE,
    anio INT NOT NULL CHECK (anio >= 2024),
    mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    numero_turno INT NOT NULL CHECK (numero_turno IN (1, 2, 3)),
    sucursal_asignada_id UUID NOT NULL REFERENCES clients.sucursales(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (funcionario_id, anio, mes)
);

-- ============================================================================
-- ESQUEMA INVENTORY
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory.servicios_alimentacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(40) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    es_base BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory.turno_servicios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    servicio_id UUID NOT NULL REFERENCES inventory.servicios_alimentacion(id) ON DELETE CASCADE,
    numero_turno INT NOT NULL CHECK (numero_turno IN (1, 2, 3)),
    hora_inicio VARCHAR(5) NOT NULL,
    hora_fin VARCHAR(5) NOT NULL,
    UNIQUE (servicio_id, numero_turno)
);

CREATE TABLE IF NOT EXISTS inventory.valorizaciones_perfil (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    servicio_id UUID NOT NULL REFERENCES inventory.servicios_alimentacion(id) ON DELETE CASCADE,
    perfil_codigo VARCHAR(40) NOT NULL,
    valor_clp INT NOT NULL CHECK (valor_clp > 0),
    vigente BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (servicio_id, perfil_codigo)
);

CREATE TABLE IF NOT EXISTS inventory.productos_casino (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(40) UNIQUE NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    categoria VARCHAR(60) NOT NULL,
    precio_clp INT NOT NULL CHECK (precio_clp > 0),
    disponible BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ESQUEMA ORDERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS orders.vales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_vale VARCHAR(40) UNIQUE NOT NULL,
    clave_unicidad VARCHAR(140) UNIQUE NOT NULL,
    funcionario_id UUID,
    codigo_funcionario VARCHAR(32),
    nombre_beneficiario VARCHAR(150) NOT NULL,
    perfil_codigo VARCHAR(40) NOT NULL,
    servicio_id UUID NOT NULL,
    servicio_codigo VARCHAR(40) NOT NULL,
    servicio_nombre VARCHAR(100) NOT NULL,
    tipo_vale VARCHAR(32) NOT NULL CHECK (tipo_vale IN ('NORMAL_TURNO', 'ADICIONAL_REUNION', 'VISITA_NO_PERSONALIZADO')),
    numero_turno INT NOT NULL CHECK (numero_turno IN (1, 2, 3)),
    fecha_vigencia DATE NOT NULL,
    hora_inicio_permitida VARCHAR(5) NOT NULL,
    hora_fin_permitida VARCHAR(5) NOT NULL,
    valor_clp INT NOT NULL CHECK (valor_clp > 0),
    sucursal_emision_codigo VARCHAR(32) NOT NULL,
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('EMITIDO', 'IMPRESO', 'CANJEADO', 'ANULADO')),
    motivo_adicional VARCHAR(255),
    emitido_por_id UUID NOT NULL,
    emitido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    impreso_en TIMESTAMPTZ,
    canjeado_en TIMESTAMPTZ,
    anulado_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_vales_func_fecha ON orders.vales(funcionario_id, fecha_vigencia);
CREATE INDEX IF NOT EXISTS idx_orders_vales_estado ON orders.vales(estado);

CREATE TABLE IF NOT EXISTS orders.canjes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vale_id UUID UNIQUE NOT NULL REFERENCES orders.vales(id),
    numero_vale VARCHAR(40) NOT NULL,
    cajero_id UUID NOT NULL,
    cajero_codigo VARCHAR(32) NOT NULL,
    casino_codigo VARCHAR(32) NOT NULL,
    total_consumo_clp INT NOT NULL CHECK (total_consumo_clp > 0),
    valor_vale_clp INT NOT NULL CHECK (valor_vale_clp > 0),
    saldo_a_favor_clp INT NOT NULL CHECK (saldo_a_favor_clp >= 0),
    diferencia_pagada_clp INT NOT NULL CHECK (diferencia_pagada_clp >= 0),
    transaccion_pago_id UUID NOT NULL,
    canjeado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders.canje_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canje_id UUID NOT NULL REFERENCES orders.canjes(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL,
    producto_codigo VARCHAR(40) NOT NULL,
    producto_nombre VARCHAR(120) NOT NULL,
    cantidad INT NOT NULL CHECK (cantidad > 0),
    precio_unitario_clp INT NOT NULL CHECK (precio_unitario_clp > 0),
    subtotal_clp INT NOT NULL CHECK (subtotal_clp > 0)
);

-- ============================================================================
-- ESQUEMA PAYMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments.transacciones_canje (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(120) UNIQUE NOT NULL,
    vale_id UUID UNIQUE NOT NULL,
    numero_vale VARCHAR(40) NOT NULL,
    cajero_id UUID NOT NULL,
    casino_codigo VARCHAR(32) NOT NULL,
    valor_vale_clp INT NOT NULL CHECK (valor_vale_clp > 0),
    total_consumo_clp INT NOT NULL CHECK (total_consumo_clp > 0),
    monto_cubierto_vale_clp INT NOT NULL CHECK (monto_cubierto_vale_clp >= 0),
    saldo_a_favor_clp INT NOT NULL CHECK (saldo_a_favor_clp >= 0),
    diferencia_pagada_clp INT NOT NULL CHECK (diferencia_pagada_clp >= 0),
    metodo_pago_diferencia VARCHAR(32) NOT NULL CHECK (metodo_pago_diferencia IN ('NO_APLICA', 'EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO')),
    estado VARCHAR(24) NOT NULL CHECK (estado IN ('LIQUIDADO', 'REVERTIDO')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments.rendiciones_casino (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    casino_codigo VARCHAR(32) NOT NULL,
    anio INT NOT NULL,
    mes INT NOT NULL,
    total_vales_canjeados INT NOT NULL,
    total_valor_vales_clp INT NOT NULL,
    total_consumo_clp INT NOT NULL,
    total_diferencias_clp INT NOT NULL,
    total_saldos_no_usados_clp INT NOT NULL,
    estado VARCHAR(24) NOT NULL CHECK (estado IN ('ABIERTA', 'CERRADA')),
    generada_por_id UUID NOT NULL,
    generada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (casino_codigo, anio, mes)
);

CREATE TABLE IF NOT EXISTS payments.avisos_semanales_correo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funcionario_id UUID NOT NULL,
    codigo_funcionario VARCHAR(32) NOT NULL,
    email_destino VARCHAR(150) NOT NULL,
    semana_inicio DATE NOT NULL,
    semana_fin DATE NOT NULL,
    vales_disponibles INT NOT NULL DEFAULT 0,
    vales_usados INT NOT NULL DEFAULT 0,
    vales_no_usados INT NOT NULL DEFAULT 0,
    estado_envio VARCHAR(24) NOT NULL CHECK (estado_envio IN ('PENDIENTE', 'ENVIADO_SANDBOX', 'ERROR')),
    proveedor_respuesta VARCHAR(255),
    generado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enviado_en TIMESTAMPTZ,
    CONSTRAINT uq_avisos_func_semana UNIQUE (funcionario_id, semana_inicio, semana_fin)
);

-- ============================================================================
-- PROCEDIMIENTO ALMACENADO RNF4 / CU9: Avisos semanales de vales
-- ============================================================================
CREATE OR REPLACE FUNCTION payments.sp_generar_avisos_semanales(
    p_inicio DATE,
    p_fin DATE
)
RETURNS TABLE (
    aviso_id UUID,
    funcionario_id UUID,
    codigo_funcionario VARCHAR,
    email_destino VARCHAR,
    vales_disponibles INT,
    vales_usados INT,
    vales_no_usados INT,
    estado_envio VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO payments.avisos_semanales_correo (
        funcionario_id,
        codigo_funcionario,
        email_destino,
        semana_inicio,
        semana_fin,
        vales_disponibles,
        vales_usados,
        vales_no_usados,
        estado_envio
    )
    SELECT
        f.id AS funcionario_id,
        f.codigo_funcionario,
        f.email AS email_destino,
        p_inicio AS semana_inicio,
        p_fin AS semana_fin,
        COALESCE(COUNT(v.id) FILTER (WHERE v.estado = 'EMITIDO'), 0)::INT AS vales_disponibles,
        COALESCE(COUNT(v.id) FILTER (WHERE v.estado = 'CANJEADO'), 0)::INT AS vales_usados,
        COALESCE(COUNT(v.id) FILTER (WHERE v.estado = 'IMPRESO'), 0)::INT AS vales_no_usados,
        'PENDIENTE' AS estado_envio
    FROM clients.funcionarios f
    LEFT JOIN orders.vales v
        ON v.funcionario_id = f.id
        AND v.fecha_vigencia BETWEEN p_inicio AND p_fin
        AND v.estado <> 'ANULADO'
    WHERE f.activo = TRUE
    GROUP BY f.id, f.codigo_funcionario, f.email
    ON CONFLICT ON CONSTRAINT uq_avisos_func_semana
    DO UPDATE SET
        email_destino = EXCLUDED.email_destino,
        vales_disponibles = EXCLUDED.vales_disponibles,
        vales_usados = EXCLUDED.vales_usados,
        vales_no_usados = EXCLUDED.vales_no_usados,
        estado_envio = CASE
            WHEN payments.avisos_semanales_correo.estado_envio = 'ENVIADO_SANDBOX' THEN 'ENVIADO_SANDBOX'
            ELSE 'PENDIENTE'
        END,
        generado_en = NOW();

    RETURN QUERY
    SELECT
        a.id AS aviso_id,
        a.funcionario_id,
        a.codigo_funcionario,
        a.email_destino,
        a.vales_disponibles,
        a.vales_usados,
        a.vales_no_usados,
        a.estado_envio
    FROM payments.avisos_semanales_correo a
    WHERE a.semana_inicio = p_inicio AND a.semana_fin = p_fin
    ORDER BY a.codigo_funcionario;
END;
$$;
