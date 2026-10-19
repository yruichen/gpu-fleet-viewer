import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SshHost {
    host: string;
    hostname?: string;
    user?: string;
    identityFile?: string;
}

export class SshConfigParser {
    constructor() {}

    public parse(configPath: string): SshHost[] {
        const resolvedPath = this.resolveHome(configPath);
        if (!fs.existsSync(resolvedPath)) {
            return [];
        }

        const content = fs.readFileSync(resolvedPath, 'utf8');
        const lines = content.split('\n');
        const hosts: SshHost[] = [];
        let currentHosts: SshHost[] = [];

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#')) {
                continue;
            }

            // Keep quoted paths intact and discard comments outside quotes.
            const parts = line.match(/"[^"\n]*"|'[^'\n]*'|[^\s=#]+|#[^\n]*/g) || [];
            const tokens = parts.filter(part => !part.startsWith('#'))
                .map(part => part.replace(/^(["'])(.*)\1$/, '$2'));
            const key = tokens[0]?.toLowerCase();
            const value = tokens.slice(1).join(' ');

            if (key === 'host') {
                currentHosts = tokens.slice(1)
                    .filter(pattern => !/[*!?]/.test(pattern))
                    .map(host => ({ host }));
                hosts.push(...currentHosts);
            } else if (key === 'match') {
                currentHosts = [];
            } else {
                for (const currentHost of currentHosts) {
                    if (key === 'hostname' && currentHost.hostname === undefined) {
                        currentHost.hostname = value;
                    } else if (key === 'user' && currentHost.user === undefined) {
                        currentHost.user = value;
                    } else if (key === 'identityfile' && currentHost.identityFile === undefined) {
                        currentHost.identityFile = value;
                    }
                }
            }
        }

        return hosts;
    }

    private resolveHome(filepath: string): string {
        if (filepath.startsWith('~')) {
            return path.join(os.homedir(), filepath.slice(1));
        }
        return filepath;
    }
}
