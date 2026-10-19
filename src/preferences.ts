export interface PreferenceField {
    key: string;
    group: string;
    label: [string, string];
    type: 'boolean' | 'number' | 'string' | 'hosts' | 'enum' | 'events' | 'gpus';
    default: unknown;
    min?: number;
    max?: number;
    options?: string[];
}

export const preferenceFields: PreferenceField[] = [
    { key: 'sshConfigPath', group: 'servers', label: ['SSH config file', 'SSH 配置文件'], type: 'string', default: '~/.ssh/config' },
    { key: 'additionalHosts', group: 'servers', label: ['Additional SSH hosts (one per line)', '额外 SSH 主机（每行一个）'], type: 'hosts', default: [] },
    { key: 'targets', group: 'servers', label: ['Monitored SSH aliases (empty = all)', '监控的 SSH 别名（留空表示全部）'], type: 'hosts', default: [] },
    { key: 'ignoredHosts', group: 'servers', label: ['Excluded SSH aliases', '排除的 SSH 别名'], type: 'hosts', default: [] },
    { key: 'visibleGpus', group: 'servers', label: ['Visible GPUs per server', '各服务器显示的 GPU'], type: 'gpus', default: {} },
    { key: 'researchUser', group: 'servers', label: ['My remote username', '我的远程用户名'], type: 'string', default: '' },
    { key: 'language', group: 'display', label: ['Language', '语言'], type: 'enum', options: ['auto', 'en', 'zh-CN'], default: 'auto' },
    { key: 'autoRefresh', group: 'refresh', label: ['Automatic refresh', '自动刷新'], type: 'boolean', default: true },
    { key: 'refreshInterval', group: 'refresh', label: ['Refresh interval (seconds)', '刷新间隔（秒）'], type: 'number', min: 2, max: 300, default: 5 },
    { key: 'sshTimeout', group: 'refresh', label: ['SSH timeout (seconds)', 'SSH 超时（秒）'], type: 'number', min: 2, max: 60, default: 8 },
    { key: 'maxConcurrentHosts', group: 'refresh', label: ['Concurrent servers', '并发查询服务器数'], type: 'number', min: 1, max: 32, default: 8 },
    { key: 'pauseWhenHidden', group: 'refresh', label: ['Pause automatic refresh while hidden', '面板隐藏时暂停自动刷新'], type: 'boolean', default: true },
    ...([
        ['compactLayout', 'Compact GPU matrix', '紧凑 GPU 矩阵'],
        ['showUtilization', 'GPU utilization', 'GPU 利用率'],
        ['showTemperature', 'Temperature', '温度'],
        ['showPower', 'Power draw', '功耗'],
        ['showFanSpeed', 'Fan speed', '风扇转速'],
        ['showProcesses', 'Process details', '进程详情'],
        ['showHostHealth', 'Server health', '服务器健康信息'],
        ['showStatusBar', 'VS Code status bar summary', 'VS Code 状态栏摘要']
    ] as const).map(([key, en, zh]) => ({ key, group: 'display', label: [en, zh] as [string, string], type: 'boolean' as const, default: true })),
    { key: 'availabilityRequireNoProcesses', group: 'availability', label: ['Require no compute processes', '要求无计算进程'], type: 'boolean', default: true },
    { key: 'availabilityMaxMemoryMiB', group: 'availability', label: ['Maximum used memory (MiB)', '最大已用显存（MiB）'], type: 'number', min: 0, max: 1048576, default: 512 },
    { key: 'availabilityMaxUtilization', group: 'availability', label: ['Maximum utilization (%)', '最大利用率（%）'], type: 'number', min: 0, max: 100, default: 10 },
    { key: 'enableSlurmIntegration', group: 'display', label: ['Detect Slurm jobs', '识别 Slurm 作业'], type: 'boolean', default: true },
    { key: 'slurmRefreshInterval', group: 'refresh', label: ['Slurm refresh interval (seconds)', 'Slurm 刷新间隔（秒）'], type: 'number', min: 5, max: 300, default: 30 },
    { key: 'enableNotifications', group: 'notifications', label: ['Notify on availability, offline servers, and warnings', '通知 GPU 释放、服务器上下线和阈值告警'], type: 'boolean', default: false },
    { key: 'notificationEvents', group: 'notifications', label: ['Notification events', '通知事件'], type: 'events', options: ['serverState','gpuAvailable','threshold'], default: ['serverState','gpuAvailable','threshold'] },
    { key: 'notificationCooldownSeconds', group: 'notifications', label: ['Notification cooldown (seconds)', '通知冷却时间（秒）'], type: 'number', min: 0, max: 3600, default: 60 },
    { key: 'memoryWarningThreshold', group: 'notifications', label: ['Memory warning (%)', '显存警告阈值（%）'], type: 'number', min: 1, max: 100, default: 85 },
    { key: 'temperatureWarningThreshold', group: 'notifications', label: ['Temperature warning (°C)', '温度警告阈值（°C）'], type: 'number', min: 1, max: 120, default: 80 },
    { key: 'powerWarningThreshold', group: 'notifications', label: ['Power warning (% of limit)', '功耗警告阈值（上限百分比）'], type: 'number', min: 1, max: 100, default: 90 },
    { key: 'ai.protocol', group: 'ai', label: ['API protocol', 'API 协议'], type: 'enum', options: ['openai', 'anthropic'], default: 'openai' },
    { key: 'ai.baseUrl', group: 'ai', label: ['API base URL or full endpoint', 'API 基础地址或完整接口地址'], type: 'string', default: 'https://api.openai.com/v1' },
    { key: 'ai.model', group: 'ai', label: ['Model ID (from your provider)', '模型 ID（由 API 服务商提供）'], type: 'string', default: '' },
    { key: 'ai.saveChatHistory', group: 'ai', label: ['Save conversation text locally (turning off clears saved copies)', '保存聊天正文到本机（关闭会清除保存副本）'], type: 'boolean', default: false },
    { key: 'ai.maxToolCalls', group: 'ai', label: ['Tool calls per turn (0 = unlimited)', '每轮工具调用次数（0 = 不限）'], type: 'number', min: 0, max: 10000, default: 0 },
    { key: 'ai.logTailLines', group: 'ai', label: ['Task log tail (lines)', '任务日志末尾行数'], type: 'number', min: 20, max: 10000, default: 500 },
    { key: 'ai.logTailKiB', group: 'ai', label: ['Task log read limit (KiB)', '单次日志读取上限（KiB）'], type: 'number', min: 16, max: 2048, default: 256 },
    { key: 'ai.timeoutSeconds', group: 'ai', label: ['Response timeout (seconds)', '响应超时（秒）'], type: 'number', min: 5, max: 900, default: 120 }
];

export function validatePreferenceChanges(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings.');
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        const field = preferenceFields.find(item => item.key === key);
        if (!field) throw new Error(`Unknown setting: ${key}`);
        let valid = false;
        if (field.type === 'boolean') valid = typeof value === 'boolean';
        if (field.type === 'number') valid = typeof value === 'number' && Number.isFinite(value) && value >= (field.min ?? -Infinity) && value <= (field.max ?? Infinity);
        if (field.type === 'enum') valid = typeof value === 'string' && Boolean(field.options?.includes(value));
        if (field.type === 'string') valid = typeof value === 'string' && value.length <= 2048 && !/[\r\n\0]/.test(value);
        if (field.type === 'hosts') valid = Array.isArray(value) && value.length <= 500 &&
            value.every(host => typeof host === 'string' && !host.startsWith('-') && /^[A-Za-z0-9_.:@-]+$/.test(host));
        if (field.type === 'events') valid = Array.isArray(value) && value.every(event => field.options?.includes(event));
        if (field.type === 'gpus') valid = Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).length <= 500 &&
            Object.entries(value).every(([host, ids]) => !['__proto__','constructor','prototype'].includes(host) && !host.startsWith('-') && /^[A-Za-z0-9_.:@-]+$/.test(host) && Array.isArray(ids) && ids.length <= 128 && ids.every(id => typeof id === 'string' && /^(?:\d{1,4}|GPU-[\w-]+)$/.test(id)));
        if (['ai.maxToolCalls','ai.logTailLines','ai.logTailKiB'].includes(key) && !Number.isInteger(value)) valid=false;
        if (!valid) throw new Error(`Invalid setting: ${key}`);
        if (key === 'ai.baseUrl') {
            try {
                const url = new URL(String(value));
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
            } catch { throw new Error('Invalid setting: ai.baseUrl'); }
        }
        result[key] = typeof value === 'string' ? value.trim() : value;
    }
    return result;
}
