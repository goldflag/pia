import { validateConfig } from './config';
import { reconcileContainers } from './docker';
import { startHealthCheck } from './health';
import { startApi } from './api';

async function main() {
  try {
    validateConfig();
    
    console.log('Starting Proxy Farm...');
    
    console.log('Reconciling existing containers...');
    await reconcileContainers();
    
    console.log('Starting health check service...');
    startHealthCheck();
    
    startApi();
    
    console.log('Proxy Farm is running');
    
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\nShutting down...');
      process.exit(0);
    });
  } catch (err: any) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}