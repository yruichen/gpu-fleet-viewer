const { GpuMonitor } = require('../out/gpuMonitor');

async function main() {
    const host = process.argv[2];
    if (!host) {
        throw new Error('Usage: node scripts/checkRemote.js <ssh-host> [timeout-seconds]');
    }
    const timeoutSeconds = Number(process.argv[3] || 8);

    const startedAt = Date.now();
    const snapshot = await new GpuMonitor().getServerSnapshot(host, {
        timeoutSeconds,
        includeProcessOwners: true,
        includeProcesses: true,
        includeHostHealth: true,
        includeSlurm: true
    });
    const gpus = snapshot.gpus;
    const processCount = gpus.reduce((total, gpu) => total + gpu.processes.length, 0);
    console.log(JSON.stringify({
        host,
        elapsedMs: Date.now() - startedAt,
        gpuCount: gpus.length,
        processCount,
        hostHealth: snapshot.health,
        slurmAvailable: snapshot.slurmAvailable,
        firstGpu: gpus[0] && {
            name: gpus[0].name,
            power: gpus[0].power,
            fanSpeed: gpus[0].fanSpeed
        }
    }, null, 2));
}

void main();
