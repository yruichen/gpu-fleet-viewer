import MarkdownIt = require('markdown-it');
const markdown = new MarkdownIt({html:false,linkify:false,breaks:true});
markdown.disable('image');
const linkOpen=markdown.renderer.rules.link_open || ((tokens,index,options,_env,self)=>self.renderToken(tokens,index,options));
markdown.renderer.rules.link_open=(tokens,index,options,env,self)=>{
    const token=tokens[index]; const href=String(token.attrGet('href')||'');
    if(!/^https?:\/\//i.test(href)) { token.attrs=token.attrs?.filter(([name])=>name!=='href')||null; }
    else { token.attrSet('rel','noreferrer noopener'); }
    return linkOpen(tokens,index,options,env,self);
};
export function renderMarkdown(text:string):string { return markdown.render(text); }
