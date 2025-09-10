#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import Docker from "dockerode";
import {
  createProxy,
  removeProxy,
  rotateProxy,
  reconcileContainers,
} from "./docker";
import { registry } from "./registry";
import { checkProxyHealth, healProxies } from "./health";
import { validateConfig } from "./config";
import { ProxyRecord } from "./types";

const docker = new Docker();

const program = new Command();

program.name("pf").description("PIA WireGuard Proxy Farm CLI").version("1.0.0");

program
  .command("add")
  .description("Create a new proxy")
  .option("--country <country>", "Country code (e.g., US)")
  .option("--city <city>", "City name")
  .option("--notes <notes>", "Additional notes")
  .action(async (options) => {
    try {
      validateConfig();

      console.log(chalk.yellow("Creating proxy..."));
      const proxy = await createProxy(options);

      console.log(chalk.green("Proxy created successfully!"));
      console.log(chalk.gray("ID:"), proxy.id);
      console.log(chalk.gray("Port:"), proxy.port);
      console.log(
        chalk.gray("Region:"),
        `${proxy.country || "Auto"}/${proxy.city || "Auto"}`
      );

      console.log(chalk.yellow("\nWaiting for VPN connection..."));
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

      console.log(chalk.yellow("Checking health..."));
      const health = await checkProxyHealth(proxy.id);

      if (health.healthy) {
        console.log(chalk.green("✓ Healthy"));
        console.log(chalk.gray("Exit IP:"), health.exitIp);
      } else {
        console.log(chalk.red("✗ Unhealthy:"), health.error);
      }
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

program
  .command("up")
  .description("Bulk create proxies")
  .option("--count <count>", "Number of proxies to create", "1")
  .option("--country <country>", "Country code")
  .option("--city <city>", "City name")
  .action(async (options) => {
    try {
      validateConfig();

      const count = parseInt(options.count, 10);
      console.log(chalk.yellow(`Creating ${count} proxies...`));

      const proxies = [];
      const failedPorts = new Set<number>(); // Track ports that failed to avoid reuse

      for (let i = 0; i < count; i++) {
        try {
          // Get a port that's not already used or failed
          const usedPorts = await registry.getUsedPorts();
          const allReservedPorts = new Set([...usedPorts, ...failedPorts]);
          const port = await registry.allocatePort(allReservedPorts);

          try {
            const proxy = await createProxy({
              country: options.country,
              city: options.city,
              port, // Pass the pre-allocated port
            });
            proxies.push(proxy);
            console.log(
              chalk.green(
                `✓ Created proxy ${i + 1}/${count}: port ${proxy.port}`
              )
            );
          } catch (err: any) {
            // If creation failed, remember this port to not reuse it
            failedPorts.add(port);
            throw err;
          }
        } catch (err: any) {
          console.log(
            chalk.red(`✗ Failed to create proxy ${i + 1}: ${err.message}`)
          );
        }
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
          chalk.yellow("Checking health of all proxies in parallel...")
        );

        // Check all proxies in parallel
        const healthChecks = await Promise.all(
          proxies.map(async (proxy) => {
            const health = await checkProxyHealth(proxy.id);
            return { proxy, health };
          })
        );

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
  .option(
    "--batch-size <size>",
    "Number of health checks to run simultaneously",
    "50"
  )
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
        const batchSize = parseInt(options.batchSize, 10) || 50;

        if (batchSize >= proxies.length) {
          // Run all at once if batch size is large enough
          console.log(
            chalk.yellow(
              `Checking health of ${proxies.length} proxies in parallel...`
            )
          );

          const healthPromises = proxies.map((proxy) =>
            checkProxyHealth(proxy.id).catch((err) => ({
              proxyId: proxy.id,
              healthy: false,
              error: err.message,
            }))
          );

          await Promise.all(healthPromises);
        } else {
          // Run in batches
          console.log(
            chalk.yellow(
              `Checking health of ${proxies.length} proxies in batches of ${batchSize}...`
            )
          );

          for (let i = 0; i < proxies.length; i += batchSize) {
            const batch = proxies.slice(i, i + batchSize);
            const healthPromises = batch.map((proxy) =>
              checkProxyHealth(proxy.id).catch((err) => ({
                proxyId: proxy.id,
                healthy: false,
                error: err.message,
              }))
            );

            await Promise.all(healthPromises);
            console.log(
              chalk.gray(
                `  Checked ${Math.min(i + batchSize, proxies.length)}/${
                  proxies.length
                }`
              )
            );
          }
        }

        // Refresh list after health check
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
  .description("Restart all unhealthy proxies")
  .action(async () => {
    try {
      console.log(chalk.yellow("Healing unhealthy proxies..."));
      await healProxies();
      console.log(chalk.green("Healing complete"));
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

program
  .command("cleanup")
  .description("Clean up orphaned proxy entries and fix port conflicts")
  .action(async () => {
    try {
      console.log(chalk.yellow("Cleaning up proxy registry..."));

      // First reconcile with actual containers
      await reconcileContainers();

      // Get all proxies
      const proxies = await registry.list();
      const portMap = new Map<number, ProxyRecord[]>();

      // Group by port to find duplicates
      for (const proxy of proxies) {
        if (!portMap.has(proxy.port)) {
          portMap.set(proxy.port, []);
        }
        portMap.get(proxy.port)!.push(proxy);
      }

      // Find and remove duplicates
      let removed = 0;
      for (const [port, proxyList] of portMap) {
        if (proxyList.length > 1) {
          console.log(
            chalk.yellow(
              `Port ${port} has ${proxyList.length} entries. Cleaning up...`
            )
          );

          // Sort by creation date, keep the oldest healthy one or just the oldest
          proxyList.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
          const keep = proxyList.find((p) => p.healthy) || proxyList[0];

          for (const proxy of proxyList) {
            if (proxy.id !== keep.id) {
              console.log(chalk.red(`  Removing duplicate: ${proxy.id}`));
              await registry.remove(proxy.id);
              removed++;
            }
          }
        }
      }

      if (removed > 0) {
        console.log(chalk.green(`✓ Removed ${removed} duplicate entries`));
      } else {
        console.log(chalk.green("✓ No duplicates found"));
      }

      // Now check for orphaned containers
      const containerList = await docker.listContainers({
        all: true,
        filters: { label: ["proxyfarm=true"] },
      });

      const registeredIds = new Set(
        (await registry.list()).map((p) => p.containerId)
      );
      let orphaned = 0;

      for (const containerInfo of containerList) {
        if (!registeredIds.has(containerInfo.Id)) {
          console.log(
            chalk.yellow(`Found orphaned container: ${containerInfo.Names[0]}`)
          );
          try {
            const container = docker.getContainer(containerInfo.Id);
            await container.stop();
            await container.remove();
            orphaned++;
            console.log(chalk.green(`  ✓ Removed`));
          } catch (err: any) {
            console.log(chalk.red(`  ✗ Failed to remove: ${err.message}`));
          }
        }
      }

      if (orphaned > 0) {
        console.log(chalk.green(`✓ Removed ${orphaned} orphaned containers`));
      } else {
        console.log(chalk.green("✓ No orphaned containers found"));
      }
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
  });

program.parse();
