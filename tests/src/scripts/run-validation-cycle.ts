import { execSync } from 'node:child_process';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '../../..');

function runStep(label: string, cmd: string, extraEnv: Record<string, string> = {}) {
  console.log(`\n========================================\n[CYCLE] ${label}\n========================================`);
  execSync(cmd, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  });
}

function resetDb() {
  if (process.env.RESET_VIA_DOCKER === '1') {
    runStep('Restaurando BD via docker compose db-tools', 'docker compose --profile tools run --rm db-tools npm run reset-db:prod');
  } else {
    runStep('Restaurando BD via @libros/db reset-db', 'npm --workspace=@libros/db run reset-db');
  }
}

function main() {
  resetDb();
  runStep('RUN01 - Suite E2E y Seguridad', 'npm --workspace=@libros/tests run test:all', {
    RUN_ID: 'RUN01'
  });

  resetDb();
  runStep('RUN02 - Repeticion Independiente Suite E2E y Seguridad', 'npm --workspace=@libros/tests run test:all', {
    RUN_ID: 'RUN02'
  });

  resetDb();
  runStep('Prueba de Carga RF2 (< 2s) con autocannon', 'npm --workspace=@libros/tests run test:load');

  if (process.env.DOCKER_RESILIENCE === '1') {
    try {
      runStep('Deteniendo payments para prueba de resiliencia P12', 'docker compose stop payments');
      runStep('RUN_RESILIENCE - Ejecutando P12', 'npm --workspace=@libros/tests run test:resilience', {
        RUN_ID: 'RUN_RESILIENCE',
        RESILIENCE_TEST_ENABLED: '1'
      });
    } finally {
      runStep('Reactivando servicio payments', 'docker compose start payments');
    }
  }

  console.log('\n[CYCLE] Ciclo completo finalizado. Evidencias depuradas disponibles en docs/evidencias/.');
}

main();
