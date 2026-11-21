// Transport limits also apply to the Android account proxy.
export const AI_CHAT_MAX_BODY_BYTES=8*1024*1024;
export const AI_CHAT_MAX_MESSAGES=2048;
export const AI_CHAT_MAX_TEXT_CHARS=4200000;
export const WEB_SEARCH_RESULT_LIMIT=10;
export const MIN_CONTEXT_WINDOW=16000;
export const MAX_CONTEXT_WINDOW=1050000;

const knownWindows={
 // https://developers.openai.com/api/docs/models
 openai:{
  'gpt-4o':128000,'gpt-4o-mini':128000,
  'gpt-4.1':1047576,'gpt-4.1-mini':1047576,'gpt-4.1-nano':1047576,
  'gpt-5':400000,'gpt-5-mini':400000,'gpt-5-nano':400000,'gpt-5.2':400000,
  'gpt-5.4':1050000,'gpt-5.6-terra':1050000,'gpt-5.6-luna':1050000
 },
 // https://platform.claude.com/docs/en/build-with-claude/context-windows
 anthropic:{
  'claude-haiku-4-5':200000,'claude-sonnet-4-5':200000,'claude-opus-4-5':200000,
  'claude-sonnet-4-6':1000000,'claude-opus-4-6':1000000
 }
};

export function contextWindowOverride(value){
 return Number.isInteger(value)&&value>=MIN_CONTEXT_WINDOW&&value<=MAX_CONTEXT_WINDOW?value:0;
}

export function modelContextWindow(provider,model=''){
 if(provider!=='openai'&&provider!=='anthropic')return 0;
 const id=model.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8}|latest)$/,'');
 return Object.hasOwn(knownWindows[provider],id)?knownWindows[provider][id]:0;
}

// Approximate different tokenizers without downloading a tokenizer per model.
// Charge non-ASCII and escaped controls more than ordinary Latin prose.
export function estimateContextTokens(text){
 let cost=0;
 for(let i=0;i<text.length;i++){
  const code=text.charCodeAt(i);
  if(code>=32&&code<=126){
   cost+=code===32||(code>=65&&code<=90)||(code>=97&&code<=122)?1:2;
  }else{
   cost+=code>=0x3000&&code<=0x9fff?5:6;
  }
 }
 return Math.ceil(cost/4);
}
