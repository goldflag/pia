#!/usr/bin/env node

import chalk from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import { validateConfig } from "./config";
import {
  createProxy,
  reconcileContainers,
  removeProxy,
  rotateProxy,
} from "./docker";
import { checkProxyHealth, healProxies, bulkHealthCheck } from "./health";
import { registry } from "./registry";

const program = new Command();

program.name("pf").description("PIA WireGuard Proxy Farm CLI").version("1.0.0");

program
  .command("add [count]")
  .description("Create proxies (defaults to US servers)")
  .option("--country <country>", "Country code (default: US)")
  .option("--city <city>", "City name")
  .action(async (countArg, options) => {
    try {
      validateConfig();

      const count = countArg ? parseInt(countArg, 10) : 1;
      console.log(chalk.yellow(`Creating ${count} proxies...`));

      const proxies = [];
      const failedPorts = new Set<number>(); // Track ports that failed to avoid reuse
      const BATCH_SIZE = 50;

      // Process in batches
      for (let batchStart = 0; batchStart < count; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, count);
        const batchCount = batchEnd - batchStart;

        console.log(
          chalk.yellow(
            `Creating batch of ${batchCount} proxies (${
              batchStart + 1
            }-${batchEnd} of ${count})...`
          )
        );

        // Pre-allocate ports for the batch - refresh used ports for each batch
        const batchPorts: number[] = [];

        for (let j = 0; j < batchCount; j++) {
          try {
            // Get fresh list of used ports for each allocation
            const usedPorts = await registry.getUsedPorts();
            const allReservedPorts = new Set([
              ...usedPorts,
              ...failedPorts,
              ...batchPorts,
            ]);
            const port = await registry.allocatePort(allReservedPorts);
            batchPorts.push(port);
          } catch (err: any) {
            console.log(
              chalk.red(
                `Failed to allocate port for proxy ${batchStart + j + 1}: ${
                  err.message
                }`
              )
            );
          }
        }

        // Create proxies in parallel for this batch
        const batchPromises = batchPorts.map(async (port, index) => {
          try {
            const proxy = await createProxy({
              country: options.country,
              city: options.city,
              port, // Pass the pre-allocated port
            });
            console.log(
              chalk.green(
                `✓ Created proxy ${batchStart + index + 1}/${count}: port ${
                  proxy.port
                }`
              )
            );
            return proxy;
          } catch (err: any) {
            // If creation failed, remember this port to not reuse it
            failedPorts.add(port);
            console.log(
              chalk.red(
                `✗ Failed to create proxy ${batchStart + index + 1}: ${
                  err.message
                }`
              )
            );
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        proxies.push(...batchResults.filter((p) => p !== null));

        console.log(
          chalk.green(
            `Batch complete: ${
              batchResults.filter((p) => p !== null).length
            } proxies created successfully`
          )
        );
      }

      console.log(
        chalk.green(`\nCreated ${proxies.length} proxies successfully`)
      );

      if (proxies.length > 0) {
        console.log(
          chalk.yellow("\nWaiting for VPN connections to establish...")
        );
        await new Promise((resolve) => setTimeout(resolve, 15000)); // Wait 15 seconds

        console.log(
          chalk.yellow("Checking health of all proxies...")
        );

        // Check all proxies in parallel using bulk health check
        const healthResults = await bulkHealthCheck(proxies.map(p => p.id));
        
        // Map results back to proxies
        const healthChecks = proxies.map(proxy => ({
          proxy,
          health: healthResults.get(proxy.id) || { proxyId: proxy.id, healthy: false, error: 'Check failed' }
        }));

        // Display results
        for (const { proxy, health } of healthChecks) {
          if (health.healthy) {
            console.log(chalk.green(`✓ Proxy ${proxy.port}: ${health.exitIp}`));
          } else {
            console.log(chalk.red(`✗ Proxy ${proxy.port}: ${health.error}`));
          }
        }
      }
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

program
  .command("ls")
  .alias("list")
  .description("List all proxies with current health status")
  .option("--json", "Output as JSON")
  .option("--no-check", "Skip health check")
  .action(async (options) => {
    try {
      await reconcileContainers();
      const proxies = await registry.list();

      if (proxies.length === 0) {
        console.log(chalk.yellow("No proxies found"));
        return;
      }

      // Check health unless skipped
      if (!options.noCheck) {
        console.log(
          chalk.yellow(
            `Checking health of ${proxies.length} proxies...`
          )
        );

        // Always check all proxies in parallel using bulk health check
        await bulkHealthCheck(proxies.map(p => p.id));

        // Refresh list after health check to get updated health status
        const updatedProxies = await registry.list();
        proxies.length = 0;
        proxies.push(...updatedProxies);
      }

      if (options.json) {
        console.log(JSON.stringify(proxies, null, 2));
        return;
      }

      const table = new Table({
        head: [
          "ID",
          "Port",
          "Region",
          "Exit IP",
          "Status",
          "Restarts",
          "Created",
        ],
        style: { head: ["cyan"] },
      });

      let healthyCount = 0;
      for (const proxy of proxies) {
        if (proxy.healthy) healthyCount++;
        const status = proxy.healthy ? chalk.green("✓") : chalk.red("✗");
        const region = `${proxy.country || "Auto"}/${proxy.city || "Auto"}`;
        const created = new Date(proxy.createdAt).toLocaleString();

        table.push([
          proxy.id.substring(0, 8),
          proxy.port,
          region,
          proxy.exitIp || "-",
          status,
          proxy.restarts,
          created,
        ]);
      }

      console.log(table.toString());
      console.log(
        chalk.gray(
          `\nTotal: ${proxies.length} proxies (${chalk.green(
            healthyCount
          )} healthy, ${chalk.red(proxies.length - healthyCount)} unhealthy)`
        )
      );
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

program
  .command("rm <id>")
  .alias("remove")
  .description("Remove a proxy")
  .action(async (id) => {
    try {
      console.log(chalk.yellow(`Removing proxy ${id}...`));
      await removeProxy(id);
      console.log(chalk.green("Proxy removed successfully"));
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

program
  .command("rotate <id>")
  .description("Restart a proxy (may change exit IP)")
  .action(async (id) => {
    try {
      console.log(chalk.yellow(`Rotating proxy ${id}...`));
      await rotateProxy(id);
      console.log(chalk.green("Proxy rotated successfully"));

      console.log(chalk.yellow("Waiting for proxy to reconnect..."));
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const health = await checkProxyHealth(id);
      if (health.healthy) {
        console.log(chalk.green("✓ Healthy"));
        console.log(chalk.gray("New Exit IP:"), health.exitIp);
      } else {
        console.log(chalk.red("✗ Unhealthy:"), health.error);
      }
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

program
  .command("heal")
  .description("Clean up registry and heal unhealthy proxies")
  .action(async () => {
    try {
      console.log(chalk.cyan("Starting proxy maintenance..."));
      console.log(chalk.gray("─".repeat(40)));
      await healProxies();
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show system status")
  .action(async () => {
    try {
      const proxies = await registry.list();
      const healthy = proxies.filter((p) => p.healthy).length;
      const unhealthy = proxies.filter((p) => !p.healthy).length;

      console.log(chalk.cyan("Proxy Farm Status"));
      console.log(chalk.gray("─".repeat(40)));
      console.log(`Total Proxies: ${proxies.length}`);
      console.log(`Healthy: ${chalk.green(healthy)}`);
      console.log(`Unhealthy: ${chalk.red(unhealthy)}`);

      const countries = new Set(proxies.map((p) => p.country).filter(Boolean));
      if (countries.size > 0) {
        console.log(`Countries: ${Array.from(countries).join(", ")}`);
      }
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

// Alias cleanup to heal for backwards compatibility
program
  .command("cleanup")
  .description("Alias for heal - clean up registry and heal unhealthy proxies")
  .action(async () => {
    try {
      console.log(chalk.cyan("Starting proxy maintenance..."));
      console.log(chalk.gray("─".repeat(40)));
      await healProxies();
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

program.parse();
