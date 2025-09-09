#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { createProxy, removeProxy, rotateProxy, reconcileContainers } from './docker';
import { registry } from './registry';
import { checkProxyHealth, healProxies } from './health';
import { validateConfig } from './config';

const program = new Command();

program
  .name('pf')
  .description('PIA WireGuard Proxy Farm CLI')
  .version('1.0.0');

program
  .command('add')
  .description('Create a new proxy')
  .option('--country <country>', 'Country code (e.g., US)')
  .option('--city <city>', 'City name')
  .option('--notes <notes>', 'Additional notes')
  .action(async (options) => {
    try {
      validateConfig();
      
      console.log(chalk.yellow('Creating proxy...'));
      const proxy = await createProxy(options);
      
      console.log(chalk.green('Proxy created successfully!'));
      console.log(chalk.gray('ID:'), proxy.id);
      console.log(chalk.gray('Port:'), proxy.port);
      console.log(chalk.gray('Region:'), `${proxy.country || 'Any'}/${proxy.city || 'Any'}`);
      
      console.log(chalk.yellow('\nChecking health...'));
      const health = await checkProxyHealth(proxy.id);
      
      if (health.healthy) {
        console.log(chalk.green('✓ Healthy'));
        console.log(chalk.gray('Exit IP:'), health.exitIp);
      } else {
        console.log(chalk.red('✗ Unhealthy:'), health.error);
      }
    } catch (err: any) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program
  .command('up')
  .description('Bulk create proxies')
  .option('--count <count>', 'Number of proxies to create', '1')
  .option('--country <country>', 'Country code')
  .option('--city <city>', 'City name')
  .action(async (options) => {
    try {
      validateConfig();
      
      const count = parseInt(options.count, 10);
      console.log(chalk.yellow(`Creating ${count} proxies...`));
      
      const proxies = [];
      for (let i = 0; i < count; i++) {
        try {
          const proxy = await createProxy({
            country: options.country,
            city: options.city
          });
          proxies.push(proxy);
          console.log(chalk.green(`✓ Created proxy ${i + 1}/${count}: port ${proxy.port}`));
        } catch (err: any) {
          console.log(chalk.red(`✗ Failed to create proxy ${i + 1}: ${err.message}`));
        }
      }
      
      console.log(chalk.green(`\nCreated ${proxies.length} proxies successfully`));
    } catch (err: any) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program
  .command('ls')
  .alias('list')
  .description('List all proxies')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      await reconcileContainers();
      const proxies = await registry.list();
      
      if (options.json) {
        console.log(JSON.stringify(proxies, null, 2));
        return;
      }
      
      if (proxies.length === 0) {
        console.log(chalk.yellow('No proxies found'));
        return;
      }
      
      const table = new Table({
        head: ['ID', 'Port', 'Region', 'Exit IP', 'Status', 'Restarts', 'Created'],
        style: { head: ['cyan'] }
      });
      
      for (const proxy of proxies) {
        const status = proxy.healthy ? chalk.green('✓') : chalk.red('✗');
        const region = `${proxy.country || 'Any'}/${proxy.city || 'Any'}`;
        const created = new Date(proxy.createdAt).toLocaleString();
        
        table.push([
          proxy.id.substring(0, 8),
          proxy.port,
          region,
          proxy.exitIp || '-',
          status,
          proxy.restarts,
          created
        ]);
      }
      
      console.log(table.toString());
      console.log(chalk.gray(`\nTotal: ${proxies.length} proxies`));
    } catch (err: any) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program
  .command('rm <id>')
  .alias('remove')
  .description('Remove a proxy')
  .action(async (id) => {
    try {
      console.log(chalk.yellow(`Removing proxy ${id}...`));
      await removeProxy(id);
      console.log(chalk.green('Proxy removed successfully'));
    } catch (err: any) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program
  .command('rotate <id>')
  .description('Restart a proxy (may change exit IP)')
  .action(async (id) => {
    try {
      console.log(chalk.yellow(`Rotating proxy ${id}...`));
      await rotateProxy(id);
      console.log(chalk.green('Proxy rotated successfully'));
      
      console.log(chalk.yellow('Waiting for proxy to reconnect...'));
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const health = await checkProxyHealth(id);
      if (health.healthy) {
        console.log(chalk.green('✓ Healthy'));
        console.log(chalk.gray('New Exit IP:'), health.exitIp);
      } else {
        console.log(chalk.red('✗ Unhealthy:'), health.error);
      }
    } catch (err: any) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program
  .command('heal')
  .description('Restart all unhealthy proxies')
  .action(async () => {
    try {
      console.log(chalk.yellow('Healing unhealthy proxies...'));
      await healProxies();
      console.log(chalk.green('Healing complete'));
    } catch (err: any) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show system status')
  .action(async () => {
    try {
      const proxies = await registry.list();
      const healthy = proxies.filter(p => p.healthy).length;
      const unhealthy = proxies.filter(p => !p.healthy).length;
      
      console.log(chalk.cyan('Proxy Farm Status'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`Total Proxies: ${proxies.length}`);
      console.log(`Healthy: ${chalk.green(healthy)}`);
      console.log(`Unhealthy: ${chalk.red(unhealthy)}`);
      
      const countries = new Set(proxies.map(p => p.country).filter(Boolean));
      if (countries.size > 0) {
        console.log(`Countries: ${Array.from(countries).join(', ')}`);
      }
    } catch (err: any) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program.parse();