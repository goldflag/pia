#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');

// Test scenarios with different load levels
const testScenarios = {
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

// Configuration
const config = {
  serverIp: process.env.SERVER_IP || '51.222.86.70',
  startPort: parseInt(process.env.START_PORT) || 12000,
  endPort: parseInt(process.env.END_PORT) || 12099, // 100 proxies
  testUrl: process.env.TEST_URL || '',
  testScenario: process.env.TEST_SCENARIO || 'medium',
  concurrency: parseInt(process.env.CONCURRENCY) || 50,
  requestsPerProxy: parseInt(process.env.REQUESTS_PER_PROXY) || 5,
  timeout: parseInt(process.env.TIMEOUT) || 30000, // 30 seconds for heavy pages
};

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace('--', '');
  const value = args[i + 1];

  switch(key) {
    case 'server':
      config.serverIp = value;
      break;
    case 'start':
      config.startPort = parseInt(value);
      break;
    case 'end':
      config.endPort = parseInt(value);
      break;
    case 'scenario':
      config.testScenario = value;
      break;
    case 'url':
      config.testUrl = value;
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

function printHelp() {
  console.log(`
📊 Proxy Load Tester

Usage: node load-test.js [options]

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
  node load-test.js --server 51.222.86.70

  # Run heavy load test
  node load-test.js --server 51.222.86.70 --scenario heavy

  # Stress test with high concurrency
  node load-test.js --server 51.222.86.70 --scenario stress --concurrency 100

  # Test with custom URL
  node load-test.js --server 51.222.86.70 --url https://www.netflix.com
`);
}

if (args.includes('--help') || args.length === 0) {
  // Keep existing behavior
}

// Get test URLs based on scenario or custom URL
function getTestUrls() {
  if (config.testUrl) {
    return [config.testUrl];
  }

  const scenario = testScenarios[config.testScenario];
  return scenario ? scenario.urls : testScenarios.medium.urls;
}

// Test a single proxy
async function testProxy(port, requestNum = 1) {
  const urls = getTestUrls();
  const testUrl = urls[requestNum % urls.length]; // Rotate through URLs
  const startTime = Date.now();

  try {
    const response = await axios.get(testUrl, {
      proxy: {
        host: config.serverIp,
        port: port,
        protocol: 'http'
      },
      timeout: config.timeout,
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
      responseType: 'arraybuffer', // Get full content
      validateStatus: (status) => status < 500
    });

    const responseTime = Date.now() - startTime;
    const contentSize = response.data.length;

    return {
      port,
      success: true,
      responseTime,
      ip: testUrl.includes('ipify') ? JSON.parse(response.data.toString()).ip : 'N/A',
      status: response.status,
      contentSize,
      url: testUrl
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return {
      port,
      success: false,
      responseTime,
      error: error.message,
      status: error.response?.status,
      url: testUrl
    };
  }
}

// Test multiple requests for a single proxy
async function testProxyMultiple(port) {
  const results = [];

  for (let i = 1; i <= config.requestsPerProxy; i++) {
    const result = await testProxy(port, i);
    results.push(result);

    // Small delay between requests
    if (i < config.requestsPerProxy) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

// Process a batch of proxies
async function processBatch(ports) {
  const promises = ports.map(port => testProxyMultiple(port));
  const results = await Promise.all(promises);
  return results.flat();
}

// Main load test function
async function runLoadTest() {
  const scenario = testScenarios[config.testScenario];
  const testUrls = getTestUrls();

  console.log('🚀 Starting Load Test');
  console.log(`📍 Server: ${config.serverIp}`);
  console.log(`🔌 Testing ports: ${config.startPort}-${config.endPort}`);
  console.log(`📊 Requests per proxy: ${config.requestsPerProxy}`);
  console.log(`⚡ Concurrency: ${config.concurrency} proxies at once`);
  console.log(`⏱️  Timeout: ${config.timeout / 1000} seconds`);

  if (config.testUrl) {
    console.log(`🌐 Test URL: ${config.testUrl}`);
  } else {
    console.log(`📋 Test Scenario: ${scenario.name} - ${scenario.description}`);
    console.log(`🌐 Testing ${testUrls.length} different URLs per rotation`);
  }
  console.log('─'.repeat(60));

  // Generate port list
  const ports = [];
  for (let port = config.startPort; port <= config.endPort; port++) {
    ports.push(port);
  }

  const allResults = [];
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < ports.length; i += config.concurrency) {
    const batch = ports.slice(i, i + config.concurrency);
    const batchNum = Math.floor(i / config.concurrency) + 1;
    const totalBatches = Math.ceil(ports.length / config.concurrency);

    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} proxies)`);

    const batchResults = await processBatch(batch);
    allResults.push(...batchResults);

    // Show progress
    const progress = Math.min(100, ((i + batch.length) / ports.length) * 100);
    console.log(`Progress: ${progress.toFixed(1)}%`);
  }

  const totalTime = (Date.now() - startTime) / 1000;

  // Calculate statistics
  const successful = allResults.filter(r => r.success).length;
  const failed = allResults.filter(r => !r.success).length;
  const successRate = (successful / allResults.length * 100).toFixed(2);

  const responseTimes = allResults.map(r => r.responseTime);
  const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

  // Sort for percentiles
  responseTimes.sort((a, b) => a - b);
  const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)];
  const p90 = responseTimes[Math.floor(responseTimes.length * 0.9)];
  const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];

  // Get unique IPs
  const uniqueIps = new Set();
  allResults.forEach(r => {
    if (r.ip) uniqueIps.add(r.ip);
  });

  // Print results
  console.log('\n' + '═'.repeat(60));
  console.log('📈 LOAD TEST RESULTS');
  console.log('═'.repeat(60));

  console.log('\n📊 Overall Statistics:');
  console.log(`  • Total Requests: ${allResults.length}`);
  console.log(`  • Successful: ${successful} (${successRate}%)`);
  console.log(`  • Failed: ${failed}`);
  console.log(`  • Total Time: ${totalTime.toFixed(2)} seconds`);
  console.log(`  • Requests/sec: ${(allResults.length / totalTime).toFixed(2)}`);

  console.log('\n⏱️  Response Times:');
  console.log(`  • Average: ${avgResponseTime.toFixed(2)}ms`);
  console.log(`  • P50: ${p50.toFixed(2)}ms`);
  console.log(`  • P90: ${p90.toFixed(2)}ms`);
  console.log(`  • P99: ${p99.toFixed(2)}ms`);
  console.log(`  • Min: ${Math.min(...responseTimes).toFixed(2)}ms`);
  console.log(`  • Max: ${Math.max(...responseTimes).toFixed(2)}ms`);

  console.log('\n🌍 Unique Exit IPs:', uniqueIps.size);

  // Data transfer statistics
  const successfulWithSize = allResults.filter(r => r.success && r.contentSize);
  if (successfulWithSize.length > 0) {
    const totalBytes = successfulWithSize.reduce((sum, r) => sum + (r.contentSize || 0), 0);
    const avgBytes = totalBytes / successfulWithSize.length;
    const totalMB = totalBytes / (1024 * 1024);
    const throughput = (totalBytes / totalTime) / (1024 * 1024); // MB/s

    console.log('\n📦 Data Transfer:');
    console.log(`  • Total Downloaded: ${totalMB.toFixed(2)} MB`);
    console.log(`  • Average per Request: ${(avgBytes / 1024).toFixed(2)} KB`);
    console.log(`  • Throughput: ${throughput.toFixed(2)} MB/s`);
  }

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `load-test-results-${timestamp}.json`;

  const summary = {
    config,
    timestamp: new Date().toISOString(),
    summary: {
      totalRequests: allResults.length,
      successful,
      failed,
      successRate: `${successRate}%`,
      avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
      p50: `${p50.toFixed(2)}ms`,
      p90: `${p90.toFixed(2)}ms`,
      p99: `${p99.toFixed(2)}ms`,
      uniqueIps: uniqueIps.size
    },
    results: allResults
  };

  fs.writeFileSync(filename, JSON.stringify(summary, null, 2));
  console.log(`\n💾 Detailed results saved to: ${filename}`);
}

// Run the test
runLoadTest().catch(console.error);