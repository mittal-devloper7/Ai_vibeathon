import { app } from './app.js';

const PORT = Number(process.env.SIMULATOR_PORT || process.env.PORT) || 4000;

export const server = app.listen(PORT, () => {
  console.log(`Merchant Simulator listening on port ${PORT}`);
});

let isShuttingDown = false;

function handleShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down Merchant Simulator...`);
  server.close(() => {
    console.log('Merchant Simulator closed cleanly.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
