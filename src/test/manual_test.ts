import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GpuMonitor } from '../gpuMonitor';
import { SshConfigParser } from '../sshConfig';

const dummyXml = `<?xml version="1.0" ?>
<nvidia_smi_log>
    <gpu id="00000000:01:00.0">
        <product_name>NVIDIA GeForce RTX 4090</product_name>
        <uuid>GPU-test-uuid</uuid>
        <fan_speed>34 %</fan_speed>
        <temperature><gpu_temp>45 C</gpu_temp></temperature>
        <fb_memory_usage>
            <total>24564 MiB</total><used>1234 MiB</used><free>23330 MiB</free>
        </fb_memory_usage>
        <utilization><gpu_util>15 %</gpu_util><memory_util>5 %</memory_util></utilization>
        <power_readings><power_draw>120.50 W</power_draw><power_limit>450.00 W</power_limit></power_readings>
        <processes>
            <process_info>
                <pid>1234</pid><process_name>/usr/bin/python3</process_name><used_memory>1024 MiB</used_memory>
            </process_info>
        </processes>
    </gpu>
</nvidia_smi_log>`;

async function runTest(): Promise<void> {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-viewer-test-'));
    const configPath = path.join(temporaryDirectory, 'ssh_config');
    fs.writeFileSync(
        configPath,
        'Host test-server\n  HostName 192.168.1.100\n  User testuser\n\nHost another-server\n  HostName 10.0.0.1\n'
    );

    try {
        const hosts = new SshConfigParser().parse(configPath);
        assert.strictEqual(hosts.length, 2);
        assert.strictEqual(hosts[0].host, 'test-server');
        assert.strictEqual(hosts[0].user, 'testuser');

        const owners = new Map([['1234', 'alice']]);
        const gpus = await new GpuMonitor().parseNvidiaSmiXml(dummyXml, owners);
        assert.strictEqual(gpus.length, 1);
        assert.strictEqual(gpus[0].name, 'NVIDIA GeForce RTX 4090');
        assert.strictEqual(gpus[0].fanSpeed, '34 %');
        assert.strictEqual(gpus[0].power.draw, '120.50 W');
        assert.strictEqual(gpus[0].processes[0].user, 'alice');
        assert.strictEqual(gpus[0].processes[0].usedMemory, '1024 MiB');

        const queryOutput = '0, GPU-test-uuid, NVIDIA GeForce RTX 4090, 15, 5, 24564, 23330, 1234, 45, 120.50, 450.00, 34';
        const processOutput = 'GPU-test-uuid, 1234, "/usr/bin/python,worker", 1024';
        const queriedGpus = new GpuMonitor().parseNvidiaSmiQuery(queryOutput, processOutput, owners);
        assert.strictEqual(queriedGpus.length, 1);
        assert.strictEqual(queriedGpus[0].utilization.gpu, '15 %');
        assert.strictEqual(queriedGpus[0].memory.total, '24564 MiB');
        assert.strictEqual(queriedGpus[0].power.draw, '120.50 W');
        assert.strictEqual(queriedGpus[0].fanSpeed, '34 %');
        assert.strictEqual(queriedGpus[0].processes[0].name, '/usr/bin/python,worker');
        assert.strictEqual(queriedGpus[0].processes[0].user, 'alice');

        console.log('GPU monitor and SSH config tests passed.');
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

void runTest();
