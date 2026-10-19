import { randomUUID } from 'crypto';
import { ChatMessage, ToolCall } from './aiClient';

export type PermissionMode='confirm'|'full';
export interface ChatEntry {role:'user'|'assistant'|'error';content:string;}
export interface ChatSession {
    id:string;provider:string;title:string;updatedAt:number;messages:ChatEntry[];history:ChatMessage[];
    permissionMode:PermissionMode;draft:string;
    scope?:{server:string;uuid?:string;pid?:string};
    continuation?:{conversation:ChatMessage[];pending:ToolCall[];context:string};
}
export function newChatSession(provider:string):ChatSession {
    return {id:randomUUID(),provider,title:'',updatedAt:Date.now(),messages:[],history:[],permissionMode:'confirm',draft:''};
}
export async function clearSavedChatSessions(storage:{keys():readonly string[];update(key:string,value:unknown):PromiseLike<void>}):Promise<void>{
    await Promise.all(storage.keys().filter(key=>key.startsWith('gpu-fleet-viewer.chatSessions.')).map(key=>storage.update(key,[])));
}
export function restoreChatSessions(value:unknown):ChatSession[]{
    if(!Array.isArray(value))return [];
    const seen=new Set<string>();
    return value.flatMap(item=>{
        if(!item||typeof item.id!=='string'||!/^[\w-]{1,80}$/.test(item.id)||seen.has(item.id)||typeof item.provider!=='string'||item.provider.length>256||typeof item.title!=='string'||!Number.isFinite(item.updatedAt)||!Array.isArray(item.messages))return [];
        seen.add(item.id);
        const messages:ChatEntry[]=item.messages.filter((m:any)=>m&&['user','assistant','error'].includes(m.role)&&typeof m.content==='string').slice(-32).map((m:ChatEntry)=>({role:m.role,content:m.content}));
        return [{...newChatSession(item.provider),id:item.id,title:item.title.slice(0,80),updatedAt:item.updatedAt,messages,
            history:messages.filter(m=>m.role!=='error').map(m=>({role:m.role as 'user'|'assistant',content:m.content}))}];
    });
}
