#!/usr/bin/env tsx

import axios, { AxiosProxyConfig } from 'axios';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';

interface ProxyTestResult {
  proxyPort: number;
  success: boolean;
  responseTime: number;
  error?: string;
  ip?: string;
  statusCode?: number;
  contentSize?: number;
  url?: string;
}

interface LoadTestConfig {
  serverIp: string;
  startPort: number;
  endPort: number;
  testUrl: string;
  testScenario: 'light' | 'medium' | 'heavy' | 'stress' | 'custom';
  concurrency: number;
  requestsPerProxy: number;
  timeout: number;
}

interface TestScenario {
  name: string;
  urls: string[];
  description: string;
  expectedSize?: string;
}

class ProxyLoadTester {
  private config: LoadTestConfig;
  private results: ProxyTestResult[] = [];
  private testScenarios: Record<string, TestScenario> = {
    light: {
      name: 'Light Load',
      description: 'Simple API and small webpage tests',
      urls: [
        'https://api.ipify.org?format=json',
        'https://httpbin.org/ip',
        'https://jsonplaceholder.typicode.com/posts',
        'https://api.github.com/users/github',
        'https://www.example.com'
      ]
    },
    medium: {
      name: 'Medium Load',
      description: 'Regular webpage loading with assets',
      urls: [
        'https://www.wikipedia.org',
        'https://news.ycombinator.com',
        'https://www.reddit.com',
        'https://stackoverflow.com',
        'https://github.com/explore'
      ]
    },
    heavy: {
      name: 'Heavy Load',
      description: 'Resource-intensive websites with media',
      urls: [
        'https://www.youtube.com',
        'https://www.amazon.com',
        'https://www.cnn.com',
        'https://www.bbc.com',
        'https://www.nytimes.com',
        'https://www.linkedin.com',
        'https://www.twitch.tv'
      ]
    },
    stress: {
      name: 'Stress Test',
      description: 'Large downloads and streaming tests',
      urls: [
        'https://www.speedtest.net',
        'https://speed.cloudflare.com',
        'https://fast.com',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://sample-videos.com/download-sample-video.php',
        'https://ash-speed.hetzner.com/100MB.bin',
        'https://proof.ovh.net/files/10Mb.dat'
      ]
    }
  };

  constructor(config: Partial<LoadTestConfig> = {}) {
    this.config = {
      serverIp: config.serverIp || '51.222.86.70',
      startPort: config.startPort || 12000,
      endPort: config.endPort || 12099, // 100 proxies: 12000-12099
      testUrl: config.testUrl || '',
      testScenario: config.testScenario || 'medium',
      concurrency: config.concurrency || 50, // Test 50 proxies at a time
      requestsPerProxy: config.requestsPerProxy || 5,
      timeout: config.timeout || 30000, // 30 seconds timeout for heavy pages
    };
  }

  private getTestUrls(): string[] {
    if (this.config.testUrl) {
      // Custom URL provided
      return [this.config.testUrl];
    }

    const scenario = this.testScenarios[this.config.testScenario];
    return scenario ? scenario.urls : this.testScenarios.medium.urls;
  }

  private async testProxy(port: number, requestNum: number = 1): Promise<ProxyTestResult> {
    const proxyConfig: AxiosProxyConfig = {
      host: this.config.serverIp,
      port: port,
      protocol: 'http',
    };

    const urls = this.getTestUrls();
    const testUrl = urls[requestNum % urls.length]; // Rotate through URLs

    const startTime = performance.now();

    try {
      const response = await axios.get(testUrl, {
        proxy: proxyConfig,
        timeout: this.config.timeout,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        responseType: 'arraybuffer', // Get full content including binary
        validateStatus: (status) => status < 500 // Accept redirects
      });

      const endTime = performance.now();
      const responseTime = endTime - startTime;
      const contentSize = response.data.length;

      return {
        proxyPort: port,
        success: true,
        responseTime,
        ip: testUrl.includes('ipify') ? JSON.parse(response.data.toString()).ip : 'N/A',
        statusCode: response.status,
        contentSize,
        url: testUrl
      };
    } catch (error: any) {
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      return {
        proxyPort: port,
        success: false,
        responseTime,
        error: error.message || 'Unknown error',
        statusCode: error.response?.status,
        url: testUrl
      };
    }
  }

  private async testProxyMultiple(port: number): Promise<ProxyTestResult[]> {
    const results: ProxyTestResult[] = [];

    for (let i = 1; i <= this.config.requestsPerProxy; i++) {
      const result = await this.testProxy(port, i);
      results.push(result);

      // Small delay between requests to the same proxy
      if (i < this.config.requestsPerProxy) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  private async runBatch(ports: number[]): Promise<ProxyTestResult[]> {
    const batchPromises = ports.map(port => this.testProxyMultiple(port));
    const batchResults = await Promise.all(batchPromises);
    return batchResults.flat();
  }

  public async runLoadTest(): Promise<void> {
    const scenario = this.testScenarios[this.config.testScenario];
    const testUrls = this.getTestUrls();

    console.log('🚀 Starting Load Test');
    console.log(`📍 Server: ${this.config.serverIp}`);
    console.log(`🔌 Testing ports: ${this.config.startPort}-${this.config.endPort}`);
    console.log(`📊 Requests per proxy: ${this.config.requestsPerProxy}`);
    console.log(`⚡ Concurrency: ${this.config.concurrency} proxies at once`);
    console.log(`⏱️  Timeout: ${this.config.timeout / 1000} seconds`);

    if (this.config.testUrl) {
      console.log(`🌐 Test URL: ${this.config.testUrl}`);
    } else {
      console.log(`📋 Test Scenario: ${scenario.name} - ${scenario.description}`);
      console.log(`🌐 Testing ${testUrls.length} different URLs per rotation`);
    }
    console.log('─'.repeat(60));

    const ports: number[] = [];
    for (let port = this.config.startPort; port <= this.config.endPort; port++) {
      ports.push(port);
    }

    const totalRequests = ports.length * this.config.requestsPerProxy;
    const startTime = performance.now();

    // Process in batches
    for (let i = 0; i < ports.length; i += this.config.concurrency) {
      const batch = ports.slice(i, i + this.config.concurrency);
      const batchNum = Math.floor(i / this.config.concurrency) + 1;
      const totalBatches = Math.ceil(ports.length / this.config.concurrency);

      console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} proxies)`);

      const batchResults = await this.runBatch(batch);
      this.results.push(...batchResults);

      // Show progress
      const progress = Math.min(100, ((i + batch.length) / ports.length) * 100);
      console.log(`Progress: ${progress.toFixed(1)}%`);
    }

    const endTime = performance.now();
    const totalTime = (endTime - startTime) / 1000; // Convert to seconds

    this.printResults(totalTime, totalRequests);
    this.saveResults();
  }

  private printResults(totalTime: number, totalRequests: number): void {
    console.log('\n' + '═'.repeat(60));
    console.log('📈 LOAD TEST RESULTS');
    console.log('═'.repeat(60));

    const successfulRequests = this.results.filter(r => r.success).length;
    const failedRequests = this.results.filter(r => !r.success).length;
    const successRate = (successfulRequests / this.results.length * 100).toFixed(2);

    // Group by proxy port
    const proxyStats = new Map<number, { success: number; failed: number; avgTime: number; ips: Set<string> }>();

    for (const result of this.results) {
      if (!proxyStats.has(result.proxyPort)) {
        proxyStats.set(result.proxyPort, { success: 0, failed: 0, avgTime: 0, ips: new Set() });
      }

      const stats = proxyStats.get(result.proxyPort)!;
      if (result.success) {
        stats.success++;
        if (result.ip) stats.ips.add(result.ip);
      } else {
        stats.failed++;
      }
      stats.avgTime += result.responseTime;
    }

    // Calculate averages
    proxyStats.forEach((stats, port) => {
      const total = stats.success + stats.failed;
      stats.avgTime = stats.avgTime / total;
    });

    // Overall statistics
    console.log('\n📊 Overall Statistics:');
    console.log(`  • Total Requests: ${totalRequests}`);
    console.log(`  • Successful: ${successfulRequests} (${successRate}%)`);
    console.log(`  • Failed: ${failedRequests}`);
    console.log(`  • Total Time: ${totalTime.toFixed(2)} seconds`);
    console.log(`  • Requests/sec: ${(totalRequests / totalTime).toFixed(2)}`);

    // Response time statistics
    const responseTimes = this.results.map(r => r.responseTime);
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const sortedTimes = responseTimes.sort((a, b) => a - b);
    const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
    const p90 = sortedTimes[Math.floor(sortedTimes.length * 0.9)];
    const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];

    console.log('\n⏱️  Response Times:');
    console.log(`  • Average: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`  • P50: ${p50.toFixed(2)}ms`);
    console.log(`  • P90: ${p90.toFixed(2)}ms`);
    console.log(`  • P99: ${p99.toFixed(2)}ms`);
    console.log(`  • Min: ${Math.min(...responseTimes).toFixed(2)}ms`);
    console.log(`  • Max: ${Math.max(...responseTimes).toFixed(2)}ms`);

    // Data transfer statistics
    const successfulResults = this.results.filter(r => r.success && r.contentSize);
    if (successfulResults.length > 0) {
      const totalBytes = successfulResults.reduce((sum, r) => sum + (r.contentSize || 0), 0);
      const avgBytes = totalBytes / successfulResults.length;
      const totalMB = totalBytes / (1024 * 1024);
      const throughput = (totalBytes / totalTime) / (1024 * 1024); // MB/s

      console.log('\n📦 Data Transfer:');
      console.log(`  • Total Downloaded: ${totalMB.toFixed(2)} MB`);
      console.log(`  • Average per Request: ${(avgBytes / 1024).toFixed(2)} KB`);
      console.log(`  • Throughput: ${throughput.toFixed(2)} MB/s`);
    }

    // Show problematic proxies
    const problematicProxies = Array.from(proxyStats.entries())
      .filter(([_, stats]) => stats.failed > 0)
      .sort((a, b) => b[1].failed - a[1].failed)
      .slice(0, 10);

    if (problematicProxies.length > 0) {
      console.log('\n⚠️  Problematic Proxies (Top 10):');
      problematicProxies.forEach(([port, stats]) => {
        const failRate = (stats.failed / (stats.success + stats.failed) * 100).toFixed(1);
        console.log(`  • Port ${port}: ${stats.failed} failures (${failRate}% fail rate)`);
      });
    }

    // Show unique IPs
    const uniqueIps = new Set<string>();
    this.results.forEach(r => {
      if (r.ip) uniqueIps.add(r.ip);
    });

    console.log('\n🌍 Unique Exit IPs:', uniqueIps.size);
    if (uniqueIps.size <= 10) {
      console.log('  IPs:', Array.from(uniqueIps).join(', '));
    }

    // Error analysis
    const errorCounts = new Map<string, number>();
    this.results
      .filter(r => !r.success)
      .forEach(r => {
        const error = r.error || 'Unknown error';
        errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
      });

    if (errorCounts.size > 0) {
      console.log('\n❌ Error Analysis:');
      Array.from(errorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([error, count]) => {
          console.log(`  • ${error}: ${count} occurrences`);
        });
    }
  }

  private saveResults(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `load-test-results-${timestamp}.json`;

    const summary = {
      config: this.config,
      timestamp: new Date().toISOString(),
      summary: {
        totalRequests: this.results.length,
        successful: this.results.filter(r => r.success).length,
        failed: this.results.filter(r => !r.success).length,
        successRate: `${(this.results.filter(r => r.success).length / this.results.length * 100).toFixed(2)}%`,
        avgResponseTime: `${(this.results.reduce((a, b) => a + b.responseTime, 0) / this.results.length).toFixed(2)}ms`,
      },
      results: this.results,
    };

    fs.writeFileSync(filename, JSON.stringify(summary, null, 2));
    console.log(`\n💾 Detailed results saved to: ${filename}`);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  const config: Partial<LoadTestConfig> = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];

    switch (key) {
      case 'server':
      case 'ip':
        config.serverIp = value;
        break;
      case 'start':
        config.startPort = parseInt(value);
        break;
      case 'end':
        config.endPort = parseInt(value);
        break;
      case 'url':
        config.testUrl = value;
        break;
      case 'scenario':
        config.testScenario = value as any;
        break;
      case 'concurrency':
        config.concurrency = parseInt(value);
        break;
      case 'requests':
        config.requestsPerProxy = parseInt(value);
        break;
      case 'timeout':
        config.timeout = parseInt(value);
        break;
      case 'help':
        printHelp();
        process.exit(0);
    }
  }

  if (args.length === 0 || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const tester = new ProxyLoadTester(config);

  try {
    await tester.runLoadTest();
  } catch (error) {
    console.error('❌ Load test failed:', error);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
📊 Proxy Load Tester

Usage: tsx load-test.ts [options]

Options:
  --server <ip>         Server IP address (default: 51.222.86.70)
  --start <port>        Starting port number (default: 12000)
  --end <port>          Ending port number (default: 12099)
  --scenario <type>     Test scenario: light, medium, heavy, stress (default: medium)
  --url <url>           Custom test URL (overrides scenario)
  --concurrency <n>     Number of proxies to test simultaneously (default: 50)
  --requests <n>        Number of requests per proxy (default: 5)
  --timeout <ms>        Request timeout in milliseconds (default: 30000)
  --help                Show this help message

Test Scenarios:
  • light   - Simple APIs and small pages (fast)
  • medium  - Regular websites with assets (default)
  • heavy   - Resource-intensive sites with media
  • stress  - Large downloads and streaming tests

Examples:
  # Test with default medium scenario
  tsx load-test.ts --server 51.222.86.70

  # Run heavy load test
  tsx load-test.ts --server 51.222.86.70 --scenario heavy

  # Stress test with high concurrency
  tsx load-test.ts --server 51.222.86.70 --scenario stress --concurrency 100

  # Test with custom URL
  tsx load-test.ts --server 51.222.86.70 --url https://www.netflix.com
`);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { ProxyLoadTester, LoadTestConfig, ProxyTestResult };