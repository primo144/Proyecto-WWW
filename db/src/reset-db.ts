import { createPoolFromEnv, seedDatabase } from './seed';

async function resetDatabase(): Promise<void> {
  const pool = createPoolFromEnv();
  const client = await pool.connect();
  try {
    console.log('[db-reset] Truncando esquemas auth, clients, inventory, orders, payments...');
    await client.query(`
      TRUNCATE TABLE
        payments.avisos_semanales_correo,
        payments.rendiciones_casino,
        payments.transacciones_canje,
        orders.canje_items,
        orders.canjes,
        orders.vales,
        inventory.productos_casino,
        inventory.valorizaciones_perfil,
        inventory.turno_servicios,
        inventory.servicios_alimentacion,
        clients.turnos_mensuales,
        clients.funcionarios,
        clients.perfiles_comensal,
        clients.casinos,
        clients.sucursales,
        auth.sessions,
        auth.users
      RESTART IDENTITY CASCADE;
    `);
  } finally {
    client.release();
  }

  await seedDatabase(pool);
  await pool.end();
  console.log('[db-reset] Base de datos restaurada a estado inicial controlado.');
}

resetDatabase().catch((err) => {
  console.error('[db-reset] Error al restaurar la base de datos:', err);
  process.exit(1);
});
