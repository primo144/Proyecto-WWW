import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

export const SEED_IDS = {
  SUCURSAL_CENTRAL: '10000000-0000-4000-8000-000000000001',
  SUCURSAL_NORTE: '10000000-0000-4000-8000-000000000002',
  CASINO_CENTRAL_COMEDOR: '11000000-0000-4000-8000-000000000001',
  CASINO_CENTRAL_CAFE: '11000000-0000-4000-8000-000000000002',
  CASINO_NORTE_COMEDOR: '11000000-0000-4000-8000-000000000003',
  PERFIL_OBRERO: '20000000-0000-4000-8000-000000000001',
  PERFIL_ADMINISTRATIVO: '20000000-0000-4000-8000-000000000002',
  PERFIL_JEFE: '20000000-0000-4000-8000-000000000003',
  PERFIL_GERENTE: '20000000-0000-4000-8000-000000000004',
  PERFIL_SECRETARIA: '20000000-0000-4000-8000-000000000005',
  PERFIL_VISITA: '20000000-0000-4000-8000-000000000006',
  USER_ADM001: '30000000-0000-4000-8000-000000000001',
  USER_EMP001: '30000000-0000-4000-8000-000000000002',
  USER_EMP002: '30000000-0000-4000-8000-000000000003',
  USER_EMP003: '30000000-0000-4000-8000-000000000004',
  USER_SEC001: '30000000-0000-4000-8000-000000000005',
  USER_CAJ001: '30000000-0000-4000-8000-000000000006',
  USER_CAJ002: '30000000-0000-4000-8000-000000000007',
  SERV_DESAYUNO: '40000000-0000-4000-8000-000000000001',
  SERV_ALMUERZO: '40000000-0000-4000-8000-000000000002',
  SERV_ONCE: '40000000-0000-4000-8000-000000000003',
  SERV_CENA1: '40000000-0000-4000-8000-000000000004',
  SERV_CENA2: '40000000-0000-4000-8000-000000000005',
  SERV_REUNION: '40000000-0000-4000-8000-000000000006',
  PROD_MENU_EJEC: '50000000-0000-4000-8000-000000000001',
  PROD_MENU_HIPO: '50000000-0000-4000-8000-000000000002',
  PROD_DESAYUNO_COMP: '50000000-0000-4000-8000-000000000003',
  PROD_CAFE_GRANO: '50000000-0000-4000-8000-000000000004',
  PROD_TE_GOURMET: '50000000-0000-4000-8000-000000000005',
  PROD_SANDWICH_AVE: '50000000-0000-4000-8000-000000000006',
  PROD_JUGO_NATURAL: '50000000-0000-4000-8000-000000000007',
  PROD_BEBIDA_LATA: '50000000-0000-4000-8000-000000000008',
  PROD_GALLETAS_REU: '50000000-0000-4000-8000-000000000009',
  PROD_FRUTA_FRESCA: '50000000-0000-4000-8000-000000000010',
  VALE_HIST_CANJEADO: '60000000-0000-4000-8000-000000000001',
  VALE_HIST_NO_USADO: '60000000-0000-4000-8000-000000000002',
  VALE_ADICIONAL_PEND: '60000000-0000-4000-8000-000000000003',
  CANJE_HIST: '70000000-0000-4000-8000-000000000001',
  TRX_HIST: '80000000-0000-4000-8000-000000000001'
};

export function createPoolFromEnv(): Pool {
  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'libros_impresos_db',
    user: process.env.POSTGRES_USER || 'libros_app',
    password: process.env.POSTGRES_PASSWORD || 'postgres'
  });
}

function getSantiagoDateParts(offsetDays = 0): { dateStr: string; year: number; month: number } {
  const tz = process.env.APP_TIMEZONE || 'America/Santiago';
  const target = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(target);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = parts.find((p) => p.type === 'day')?.value;
  return {
    dateStr: `${year}-${String(month).padStart(2, '0')}-${day}`,
    year,
    month
  };
}

export async function seedDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Contrasena ficticia unificada para pruebas funcionales en entorno controlado
    const testPasswordHash = await bcrypt.hash('Libros2026!', 10);

    // 0. Asegurar funcion PL/pgSQL sp_generar_avisos_semanales actualizada (sin ambiguedad en ON CONFLICT)
    await client.query(`
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
      AS $fn$
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
      $fn$;
    `);

    // 1. Sucursales
    await client.query(
      `INSERT INTO clients.sucursales (id, codigo, nombre, direccion, activa)
       VALUES
         ($1, 'CENTRAL', 'Casa Central Editorial', 'Av. Camino Industrial 1450, Santiago', TRUE),
         ($2, 'NORTE', 'Sucursal Imprenta Norte', 'Ruta 5 Norte Km 22, Lampa', TRUE)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, direccion = EXCLUDED.direccion`,
      [SEED_IDS.SUCURSAL_CENTRAL, SEED_IDS.SUCURSAL_NORTE]
    );

    // 2. Casinos (cafeteria y comedor)
    await client.query(
      `INSERT INTO clients.casinos (id, codigo, nombre, tipo, sucursal_id, activo)
       VALUES
         ($1, 'CASINO_CENTRAL_COMEDOR', 'Comedor Principal Casa Central', 'COMEDOR', $4, TRUE),
         ($2, 'CASINO_CENTRAL_CAFE', 'Cafeteria Casa Central', 'CAFETERIA', $4, TRUE),
         ($3, 'CASINO_NORTE_COMEDOR', 'Comedor Sucursal Imprenta Norte', 'COMEDOR', $5, TRUE)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
      [
        SEED_IDS.CASINO_CENTRAL_COMEDOR,
        SEED_IDS.CASINO_CENTRAL_CAFE,
        SEED_IDS.CASINO_NORTE_COMEDOR,
        SEED_IDS.SUCURSAL_CENTRAL,
        SEED_IDS.SUCURSAL_NORTE
      ]
    );

    // 3. Perfiles de comensal
    const perfiles = [
      [SEED_IDS.PERFIL_OBRERO, 'OBRERO', 'Operador / Obrero de Planta', 'Operadores de maquinas, dobladores y maestros de imprenta', false, 1],
      [SEED_IDS.PERFIL_ADMINISTRATIVO, 'ADMINISTRATIVO', 'Administrativo', 'Personal administrativo y de soporte operativo', false, 1],
      [SEED_IDS.PERFIL_JEFE, 'JEFE', 'Jefe de Turno / Area', 'Jefaturas de planta, prensa y distribucion', false, 1],
      [SEED_IDS.PERFIL_GERENTE, 'GERENTE', 'Gerencia', 'Ejecutivos y gerencia general', false, 1],
      [SEED_IDS.PERFIL_SECRETARIA, 'SECRETARIA_GERENCIA', 'Secretaria de Gerencia (Multi-vale)', 'Habilitada para emitir vales para visitas de gerencia en el mismo horario', true, 10],
      [SEED_IDS.PERFIL_VISITA, 'VISITA', 'Visita / Empleado Nuevo', 'Perfil para vales no personalizados emitidos por administracion', true, 20]
    ];
    for (const p of perfiles) {
      await client.query(
        `INSERT INTO clients.perfiles_comensal (id, codigo, nombre, descripcion, permite_multi_vale, max_vales_por_horario, activo)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (codigo) DO UPDATE SET
           nombre = EXCLUDED.nombre,
           permite_multi_vale = EXCLUDED.permite_multi_vale,
           max_vales_por_horario = EXCLUDED.max_vales_por_horario`,
        p
      );
    }

    // 4. Usuarios (auth.users) y Funcionarios (clients.funcionarios)
    const users = [
      {
        id: SEED_IDS.USER_ADM001,
        codigo: 'ADM001',
        rut: '11.111.111-1',
        nombre: 'Elena Rojas Valdes',
        email: 'elena.rojas@librosimpresos.local',
        rol: 'ADMINISTRADOR',
        perfilId: SEED_IDS.PERFIL_GERENTE,
        sucursalId: SEED_IDS.SUCURSAL_CENTRAL,
        turno: 1
      },
      {
        id: SEED_IDS.USER_EMP001,
        codigo: 'EMP001',
        rut: '12.345.678-9',
        nombre: 'Carlos Munoz Perez',
        email: 'carlos.munoz@librosimpresos.local',
        rol: 'FUNCIONARIO',
        perfilId: SEED_IDS.PERFIL_OBRERO,
        sucursalId: SEED_IDS.SUCURSAL_CENTRAL,
        turno: 1
      },
      {
        id: SEED_IDS.USER_EMP002,
        codigo: 'EMP002',
        rut: '13.456.789-0',
        nombre: 'Marcela Diaz Soto',
        email: 'marcela.diaz@librosimpresos.local',
        rol: 'FUNCIONARIO',
        perfilId: SEED_IDS.PERFIL_ADMINISTRATIVO,
        sucursalId: SEED_IDS.SUCURSAL_CENTRAL,
        turno: 2
      },
      {
        id: SEED_IDS.USER_EMP003,
        codigo: 'EMP003',
        rut: '14.567.890-1',
        nombre: 'Jorge Paredes Silva',
        email: 'jorge.paredes@librosimpresos.local',
        rol: 'FUNCIONARIO',
        perfilId: SEED_IDS.PERFIL_JEFE,
        sucursalId: SEED_IDS.SUCURSAL_NORTE,
        turno: 3
      },
      {
        id: SEED_IDS.USER_SEC001,
        codigo: 'SEC001',
        rut: '15.678.901-2',
        nombre: 'Patricia Vega Morales',
        email: 'patricia.vega@librosimpresos.local',
        rol: 'FUNCIONARIO',
        perfilId: SEED_IDS.PERFIL_SECRETARIA,
        sucursalId: SEED_IDS.SUCURSAL_CENTRAL,
        turno: 1
      },
      {
        id: SEED_IDS.USER_CAJ001,
        codigo: 'CAJ001',
        rut: '16.789.012-3',
        nombre: 'Rodrigo Fuentes Castro',
        email: 'cajero.central@casinoexterno.local',
        rol: 'CAJERO',
        perfilId: SEED_IDS.PERFIL_ADMINISTRATIVO,
        sucursalId: SEED_IDS.SUCURSAL_CENTRAL,
        turno: 1
      },
      {
        id: SEED_IDS.USER_CAJ002,
        codigo: 'CAJ002',
        rut: '17.890.123-4',
        nombre: 'Lucia Herrera Nunez',
        email: 'cajero.norte@casinoexterno.local',
        rol: 'CAJERO',
        perfilId: SEED_IDS.PERFIL_ADMINISTRATIVO,
        sucursalId: SEED_IDS.SUCURSAL_NORTE,
        turno: 2
      }
    ];

    const today = getSantiagoDateParts(0);
    const monthsToSeed = [
      { anio: today.year, mes: today.month },
      { anio: today.month === 12 ? today.year + 1 : today.year, mes: (today.month % 12) + 1 },
      { anio: today.month === 1 ? today.year - 1 : today.year, mes: today.month === 1 ? 12 : today.month - 1 }
    ];

    for (const u of users) {
      await client.query(
        `INSERT INTO auth.users (id, codigo_funcionario, password_hash, rol, activo)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (codigo_funcionario) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           rol = EXCLUDED.rol,
           activo = TRUE`,
        [u.id, u.codigo, testPasswordHash, u.rol]
      );

      await client.query(
        `INSERT INTO clients.funcionarios (id, codigo_funcionario, rut, nombre_completo, email, rol, perfil_id, sucursal_base_id, activo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
         ON CONFLICT (codigo_funcionario) DO UPDATE SET
           nombre_completo = EXCLUDED.nombre_completo,
           perfil_id = EXCLUDED.perfil_id,
           sucursal_base_id = EXCLUDED.sucursal_base_id`,
        [u.id, u.codigo, u.rut, u.nombre, u.email, u.rol, u.perfilId, u.sucursalId]
      );

      for (const m of monthsToSeed) {
        await client.query(
          `INSERT INTO clients.turnos_mensuales (funcionario_id, anio, mes, numero_turno, sucursal_asignada_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (funcionario_id, anio, mes) DO UPDATE SET
             numero_turno = EXCLUDED.numero_turno,
             sucursal_asignada_id = EXCLUDED.sucursal_asignada_id`,
          [u.id, m.anio, m.mes, u.turno, u.sucursalId]
        );
      }
    }

    // 5. Servicios de alimentacion y horarios por turno
    const servicios = [
      [SEED_IDS.SERV_DESAYUNO, 'DESAYUNO', 'Desayuno', 'Servicio matinal de cafe, te, pan y acompanamientos', true],
      [SEED_IDS.SERV_ALMUERZO, 'ALMUERZO', 'Almuerzo', 'Menu completo de almuerzo con entrada, plato de fondo y postre', true],
      [SEED_IDS.SERV_ONCE, 'ONCE', 'Once', 'Servicio vespertino de te/cafe y colacion liviana', true],
      [SEED_IDS.SERV_CENA1, 'CENA1', 'Cena Turno 2', 'Cena completa correspondiente al segundo turno', true],
      [SEED_IDS.SERV_CENA2, 'CENA2', 'Cena Turno 3', 'Cena nocturna correspondiente al tercer turno', true],
      [SEED_IDS.SERV_REUNION, 'REUNION_COFFEE', 'Coffee de Reunion / Adicional', 'Galletas, bebidas y cafe para reuniones autorizadas por administracion', false]
    ];
    for (const s of servicios) {
      await client.query(
        `INSERT INTO inventory.servicios_alimentacion (id, codigo, nombre, descripcion, es_base, activo)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion, activo = TRUE`,
        s
      );
    }

    const turnoServicios: Array<[string, number, string, string]> = [
      // Turno 1 (08:00 - 16:00): Desayuno + Almuerzo (con solapamiento 11:30-12:00 para RF8)
      [SEED_IDS.SERV_DESAYUNO, 1, '08:00', '12:00'],
      [SEED_IDS.SERV_ALMUERZO, 1, '11:30', '16:00'],
      // Turno 2 (16:00 - 24:00): Once + Cena1
      [SEED_IDS.SERV_ONCE, 2, '16:00', '20:00'],
      [SEED_IDS.SERV_CENA1, 2, '20:00', '24:00'],
      // Turno 3 (00:00 - 08:00): Cena2 + Desayuno
      [SEED_IDS.SERV_CENA2, 3, '00:00', '04:00'],
      [SEED_IDS.SERV_DESAYUNO, 3, '04:00', '08:00']
    ];
    for (const ts of turnoServicios) {
      await client.query(
        `INSERT INTO inventory.turno_servicios (servicio_id, numero_turno, hora_inicio, hora_fin)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (servicio_id, numero_turno) DO UPDATE SET
           hora_inicio = EXCLUDED.hora_inicio,
           hora_fin = EXCLUDED.hora_fin`,
        ts
      );
    }

    // 6. Valorizaciones por perfil
    const valorizaciones: Array<[string, string, number]> = [
      // Desayuno
      [SEED_IDS.SERV_DESAYUNO, 'OBRERO', 3500],
      [SEED_IDS.SERV_DESAYUNO, 'ADMINISTRATIVO', 4000],
      [SEED_IDS.SERV_DESAYUNO, 'JEFE', 4500],
      [SEED_IDS.SERV_DESAYUNO, 'GERENTE', 6000],
      [SEED_IDS.SERV_DESAYUNO, 'SECRETARIA_GERENCIA', 5000],
      [SEED_IDS.SERV_DESAYUNO, 'VISITA', 4500],
      // Almuerzo
      [SEED_IDS.SERV_ALMUERZO, 'OBRERO', 6500],
      [SEED_IDS.SERV_ALMUERZO, 'ADMINISTRATIVO', 7500],
      [SEED_IDS.SERV_ALMUERZO, 'JEFE', 8500],
      [SEED_IDS.SERV_ALMUERZO, 'GERENTE', 12000],
      [SEED_IDS.SERV_ALMUERZO, 'SECRETARIA_GERENCIA', 9000],
      [SEED_IDS.SERV_ALMUERZO, 'VISITA', 8500],
      // Once
      [SEED_IDS.SERV_ONCE, 'OBRERO', 4000],
      [SEED_IDS.SERV_ONCE, 'ADMINISTRATIVO', 4500],
      [SEED_IDS.SERV_ONCE, 'JEFE', 5000],
      [SEED_IDS.SERV_ONCE, 'GERENTE', 7000],
      [SEED_IDS.SERV_ONCE, 'SECRETARIA_GERENCIA', 5500],
      [SEED_IDS.SERV_ONCE, 'VISITA', 5000],
      // Cena 1
      [SEED_IDS.SERV_CENA1, 'OBRERO', 6500],
      [SEED_IDS.SERV_CENA1, 'ADMINISTRATIVO', 7500],
      [SEED_IDS.SERV_CENA1, 'JEFE', 8500],
      [SEED_IDS.SERV_CENA1, 'GERENTE', 12000],
      [SEED_IDS.SERV_CENA1, 'SECRETARIA_GERENCIA', 9000],
      [SEED_IDS.SERV_CENA1, 'VISITA', 8500],
      // Cena 2
      [SEED_IDS.SERV_CENA2, 'OBRERO', 6500],
      [SEED_IDS.SERV_CENA2, 'ADMINISTRATIVO', 7500],
      [SEED_IDS.SERV_CENA2, 'JEFE', 8500],
      [SEED_IDS.SERV_CENA2, 'GERENTE', 12000],
      [SEED_IDS.SERV_CENA2, 'SECRETARIA_GERENCIA', 9000],
      [SEED_IDS.SERV_CENA2, 'VISITA', 8500],
      // Reunion Coffee
      [SEED_IDS.SERV_REUNION, 'OBRERO', 5500],
      [SEED_IDS.SERV_REUNION, 'ADMINISTRATIVO', 5500],
      [SEED_IDS.SERV_REUNION, 'JEFE', 6500],
      [SEED_IDS.SERV_REUNION, 'GERENTE', 9500],
      [SEED_IDS.SERV_REUNION, 'SECRETARIA_GERENCIA', 7500],
      [SEED_IDS.SERV_REUNION, 'VISITA', 6500]
    ];
    for (const v of valorizaciones) {
      await client.query(
        `INSERT INTO inventory.valorizaciones_perfil (servicio_id, perfil_codigo, valor_clp, vigente)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (servicio_id, perfil_codigo) DO UPDATE SET valor_clp = EXCLUDED.valor_clp, vigente = TRUE`,
        v
      );
    }

    // 7. Productos de casino
    const productos = [
      [SEED_IDS.PROD_MENU_EJEC, 'PROD-001', 'Menu Ejecutivo del Dia', 'ALMUERZO_CENA', 6500],
      [SEED_IDS.PROD_MENU_HIPO, 'PROD-002', 'Menu Hipocalorico Especial', 'ALMUERZO_CENA', 7200],
      [SEED_IDS.PROD_DESAYUNO_COMP, 'PROD-003', 'Desayuno Completo Casino', 'DESAYUNO_ONCE', 3500],
      [SEED_IDS.PROD_CAFE_GRANO, 'PROD-004', 'Cafe Grano Americano', 'CAFETERIA', 1800],
      [SEED_IDS.PROD_TE_GOURMET, 'PROD-005', 'Te Negro / Hierbas', 'CAFETERIA', 1400],
      [SEED_IDS.PROD_SANDWICH_AVE, 'PROD-006', 'Sandwich Ave Palta Integral', 'CAFETERIA', 3200],
      [SEED_IDS.PROD_JUGO_NATURAL, 'PROD-007', 'Jugo Natural de Naranja', 'BEBESTIBLE', 2100],
      [SEED_IDS.PROD_BEBIDA_LATA, 'PROD-008', 'Bebida Lata 350ml', 'BEBESTIBLE', 1500],
      [SEED_IDS.PROD_GALLETAS_REU, 'PROD-009', 'Pack Galletas y Snack Reunion', 'REUNION', 2800],
      [SEED_IDS.PROD_FRUTA_FRESCA, 'PROD-010', 'Ensalada de Fruta Fresca', 'POSTRE_SNACK', 1900]
    ];
    for (const prod of productos) {
      await client.query(
        `INSERT INTO inventory.productos_casino (id, codigo, nombre, categoria, precio_clp, disponible)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, precio_clp = EXCLUDED.precio_clp, disponible = TRUE`,
        prod
      );
    }

    // 8. Vales historicos de dias previos (no bloquean emisiones de hoy)
    const yesterday = getSantiagoDateParts(-1).dateStr;
    const twoDaysAgo = getSantiagoDateParts(-2).dateStr;

    // Vale historico CANJEADO (ayer, EMP001, Almuerzo 6500, consumo 5000 -> saldo a favor 1500)
    await client.query(
      `INSERT INTO orders.vales (
         id, numero_vale, clave_unicidad, funcionario_id, codigo_funcionario, nombre_beneficiario,
         perfil_codigo, servicio_id, servicio_codigo, servicio_nombre, tipo_vale, numero_turno,
         fecha_vigencia, hora_inicio_permitida, hora_fin_permitida, valor_clp, sucursal_emision_codigo,
         estado, emitido_por_id, emitido_en, impreso_en, canjeado_en
       )
       VALUES (
         $1, 'VAL-HIST-0001', 'HIST-EMP001-ALMUERZO-01', $2, 'EMP001', 'Carlos Munoz Perez',
         'OBRERO', $3, 'ALMUERZO', 'Almuerzo', 'NORMAL_TURNO', 1,
         $4::date, '11:30', '16:00', 6500, 'CENTRAL',
         'CANJEADO', $2, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NOW() - INTERVAL '23 hours'
       )
       ON CONFLICT (numero_vale) DO NOTHING`,
      [SEED_IDS.VALE_HIST_CANJEADO, SEED_IDS.USER_EMP001, SEED_IDS.SERV_ALMUERZO, yesterday]
    );

    await client.query(
      `INSERT INTO payments.transacciones_canje (
         id, idempotency_key, vale_id, numero_vale, cajero_id, casino_codigo,
         valor_vale_clp, total_consumo_clp, monto_cubierto_vale_clp, saldo_a_favor_clp,
         diferencia_pagada_clp, metodo_pago_diferencia, estado
       )
       VALUES (
         $1, $4, $2, 'VAL-HIST-0001', $3, 'CASINO_CENTRAL_COMEDOR',
         6500, 5000, 5000, 1500, 0, 'NO_APLICA', 'LIQUIDADO'
       )
       ON CONFLICT (vale_id) DO NOTHING`,
      [SEED_IDS.TRX_HIST, SEED_IDS.VALE_HIST_CANJEADO, SEED_IDS.USER_CAJ001, `VALE-${SEED_IDS.VALE_HIST_CANJEADO}`]
    );

    await client.query(
      `INSERT INTO orders.canjes (
         id, vale_id, numero_vale, cajero_id, cajero_codigo, casino_codigo,
         total_consumo_clp, valor_vale_clp, saldo_a_favor_clp, diferencia_pagada_clp, transaccion_pago_id
       )
       VALUES (
         $1, $2, 'VAL-HIST-0001', $3, 'CAJ001', 'CASINO_CENTRAL_COMEDOR',
         5000, 6500, 1500, 0, $4
       )
       ON CONFLICT (vale_id) DO NOTHING`,
      [SEED_IDS.CANJE_HIST, SEED_IDS.VALE_HIST_CANJEADO, SEED_IDS.USER_CAJ001, SEED_IDS.TRX_HIST]
    );

    await client.query(
      `INSERT INTO orders.canje_items (
         canje_id, producto_id, producto_codigo, producto_nombre, cantidad, precio_unitario_clp, subtotal_clp
       )
       SELECT $1::uuid, $2::uuid, 'PROD-006', 'Sandwich Ave Palta Integral', 1, 3200, 3200
       WHERE NOT EXISTS (SELECT 1 FROM orders.canje_items WHERE canje_id = $1::uuid AND producto_codigo = 'PROD-006')`,
      [SEED_IDS.CANJE_HIST, SEED_IDS.PROD_SANDWICH_AVE]
    );
    await client.query(
      `INSERT INTO orders.canje_items (
         canje_id, producto_id, producto_codigo, producto_nombre, cantidad, precio_unitario_clp, subtotal_clp
       )
       SELECT $1::uuid, $2::uuid, 'PROD-004', 'Cafe Grano Americano', 1, 1800, 1800
       WHERE NOT EXISTS (SELECT 1 FROM orders.canje_items WHERE canje_id = $1::uuid AND producto_codigo = 'PROD-004')`,
      [SEED_IDS.CANJE_HIST, SEED_IDS.PROD_CAFE_GRANO]
    );

    // Vale historico IMPRESO no usado (hace 2 dias, EMP002) para auditoria y avisos semanales
    await client.query(
      `INSERT INTO orders.vales (
         id, numero_vale, clave_unicidad, funcionario_id, codigo_funcionario, nombre_beneficiario,
         perfil_codigo, servicio_id, servicio_codigo, servicio_nombre, tipo_vale, numero_turno,
         fecha_vigencia, hora_inicio_permitida, hora_fin_permitida, valor_clp, sucursal_emision_codigo,
         estado, emitido_por_id, emitido_en, impreso_en
       )
       VALUES (
         $1, 'VAL-HIST-0002', 'HIST-EMP002-ONCE-01', $2, 'EMP002', 'Marcela Diaz Soto',
         'ADMINISTRATIVO', $3, 'ONCE', 'Once', 'NORMAL_TURNO', 2,
         $4::date, '16:00', '20:00', 4500, 'CENTRAL',
         'IMPRESO', $2, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'
       )
       ON CONFLICT (numero_vale) DO NOTHING`,
      [SEED_IDS.VALE_HIST_NO_USADO, SEED_IDS.USER_EMP002, SEED_IDS.SERV_ONCE, twoDaysAgo]
    );

    // Vale adicional EMITIDO listo para imprimir o consultar en totem (hoy, EMP001)
    await client.query(
      `INSERT INTO orders.vales (
         id, numero_vale, clave_unicidad, funcionario_id, codigo_funcionario, nombre_beneficiario,
         perfil_codigo, servicio_id, servicio_codigo, servicio_nombre, tipo_vale, numero_turno,
         fecha_vigencia, hora_inicio_permitida, hora_fin_permitida, valor_clp, sucursal_emision_codigo,
         estado, motivo_adicional, emitido_por_id, emitido_en
       )
       VALUES (
         $1, 'VAL-SEED-ADIC-0001', 'SEED-ADIC-EMP001-REUNION', $2, 'EMP001', 'Carlos Munoz Perez',
         'OBRERO', $3, 'REUNION_COFFEE', 'Coffee de Reunion / Adicional', 'ADICIONAL_REUNION', 1,
         $4::date, '00:00', '24:00', 5500, 'CENTRAL',
         'EMITIDO', 'Reunion de seguridad industrial planta', $5, NOW()
       )
       ON CONFLICT (numero_vale) DO NOTHING`,
      [SEED_IDS.VALE_ADICIONAL_PEND, SEED_IDS.USER_EMP001, SEED_IDS.SERV_REUNION, today.dateStr, SEED_IDS.USER_ADM001]
    );

    await client.query('COMMIT');
    console.log('[db-seed] Seed determinista completado exitosamente para Libros Impresos S.A.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const pool = createPoolFromEnv();
  seedDatabase(pool)
    .then(() => pool.end())
    .catch(async (err) => {
      console.error('[db-seed] Error durante seed:', err);
      await pool.end();
      process.exit(1);
    });
}
