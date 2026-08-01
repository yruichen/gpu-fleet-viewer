const { GpuMonitor } = require('../out/gpuMonitor');

async function main() {
    const host = process.argv[2];
    if (!host) {
        throw new Error('Usage: node scripts/checkRemote.js <ssh-host>');
    }

    const startedAt = Date.now();
    const gpus = await new GpuMonitor().getGpuStatus(host, {
        timeoutSeconds: 8,
        includeProcessOwners: true
    });
    const processCount = gpus.reduce((total, gpu) => total + gpu.processes.length, 0);
    console.log(JSON.stringify({
        host,
        elapsedMs: Date.now() - startedAt,
        gpuCount: gpus.length,
        processCount,
        firstGpu: gpus[0] && {
            name: gpus[0].name,
            power: gpus[0].power,
            fanSpeed: gpus[0].fanSpeed
        }
    }, null, 2));
}

void main();
