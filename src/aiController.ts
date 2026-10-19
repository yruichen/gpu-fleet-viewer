import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { AiProtocol, aiEndpoint, aiSecretKey, askAi, buildFleetContext, ChatMessage } from './aiClient';
import { ServerStatus } from './fleetModel';

export class AiController implements vscode.Disposable {
    private history: ChatMessage[] = [];
    private prepared?: { id: string; text: string };
    private active?: AbortController;
    private disposed = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly webview: vscode.Webview,
        private readonly getData: () => ServerStatus[],
        private readonly onKeyChange: () => Promise<void>
    ) {}

    private configuration() {
        const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        return {
            protocol: config.get<AiProtocol>('ai.protocol', 'openai'),
            baseUrl: config.get<string>('ai.baseUrl', 'https://api.openai.com/v1'),
            model: config.get<string>('ai.model', ''),
            timeoutSeconds: config.get<number>('ai.timeoutSeconds', 60)
        };
    }

    public async isConfigured(): Promise<boolean> {
        try {
            const { protocol, baseUrl } = this.configuration();
            return Boolean(await this.context.secrets.get(aiSecretKey(protocol, baseUrl)));
        } catch { return false; }
    }

    public reset(): void {
        this.active?.abort();
        this.active = undefined;
        this.history = [];
        this.prepared = undefined;
        if (!this.disposed) void this.webview.postMessage({ type: 'aiReset' });
    }

    public dispose(): void {
        this.disposed = true;
        this.reset();
    }

    public async handle(payload: Record<string, unknown>): Promise<boolean> {
        switch (payload.command) {
            case 'setAiKey':
            case 'deleteAiKey': {
                try {
                    const { protocol, baseUrl } = this.configuration();
                    const keyName = aiSecretKey(protocol, baseUrl);
                    if (payload.command === 'deleteAiKey') {
                        await this.context.secrets.delete(keyName);
                        this.reset();
                    } else {
                        const value = await vscode.window.showInputBox({
                            title: `API key · ${aiEndpoint(protocol, baseUrl).host}`,
                            prompt: 'Stored in VS Code SecretStorage for this API endpoint. Never saved in settings.json.',
                            password: true,
                            ignoreFocusOut: true,
                            validateInput: input => !input.trim() || /[\r\n]/.test(input) ? 'Enter a single API key.' : undefined
                        });
                        if (value === undefined) return true;
                        await this.context.secrets.store(keyName, value.trim());
                    }
                    await this.onKeyChange();
                } catch {
                    await vscode.window.showErrorMessage('Unable to update the API key. Check the API URL and VS Code secret storage.');
                }
                return true;
            }
            case 'prepareAiContext': {
                try {
                    const text = buildFleetContext(this.getData(), payload.includeCommands === true);
                    this.prepared = { id: randomBytes(16).toString('hex'), text };
                    await this.webview.postMessage({ type: 'aiContext', id: this.prepared.id, context: text, requestId: payload.requestId });
                } catch (error) {
                    await this.webview.postMessage({ type: 'aiContext', error: (error as Error).message, requestId: payload.requestId });
                }
                return true;
            }
            case 'clearAi': this.reset(); return true;
            case 'cancelAi': this.active?.abort(); return true;
            case 'askAi':
                await this.ask(payload);
                return true;
            default: return false;
        }
    }

    private async ask(payload: Record<string, unknown>): Promise<void> {
        if (this.active || this.disposed) return;
        const active = new AbortController();
        this.active = active;
        try {
            if (typeof payload.question !== 'string' || !payload.question.trim() || payload.question.length > 8000) {
                throw new Error('Enter a question of at most 8000 characters.');
            }
            let fleetContext = '';
            if (payload.contextId !== undefined) {
                if (!this.prepared || payload.contextId !== this.prepared.id) throw new Error('Preview the fleet context again before sending.');
                fleetContext = this.prepared.text;
            }
            const options = this.configuration();
            const apiKey = await this.context.secrets.get(aiSecretKey(options.protocol, options.baseUrl)) || '';
            const user: ChatMessage = { role: 'user', content: payload.question.trim() };
            const conversation = [...this.history.slice(-14), user];
            const answer = await askAi({ ...options, apiKey }, conversation, fleetContext, active.signal);
            if (active.signal.aborted || this.disposed) return;
            this.history = [...conversation, { role: 'assistant' as const, content: answer }].slice(-16);
            await this.webview.postMessage({ type: 'aiResult', answer });
        } catch (error) {
            if (!this.disposed && this.active === active) await this.webview.postMessage({ type: 'aiResult', error: (error as Error).message });
        } finally {
            if (this.active === active) this.active = undefined;
        }
    }
}
