// Test-only hooks appended inside the app script; never part of shipped assets.
export const hooks=`
window.aiHarness={
 setup(){aiConfigured=true;aiProfiles=[{id:'test',active:true,model:'DeepSeek V3',label:'Test'}];activateAiHubModel=async()=>{};refreshAiConfig=async()=>{};aiHubSessions=[];aiHubCurrent='';newAiHubSession();currentAiHubSession().titleSource='manual';switchTab('ai-hub');return currentAiHubSession().id},
 session:()=>currentAiHubSession(),sessions:()=>aiHubSessions,busy:()=>aiHubBusy,
 title:generateAiHubTitle,titleLocal(fn){aiLocalRaw=fn},newSession:newAiHubSession,render:renderAiHub,send:sendAiHubMessage,approve:confirmAiHubAction,stop:stopAiHubRun,
 cloud(fn){aiStreamRequest=fn},execute(fn){aiRequest=fn},theme:setTheme,
 files(value){aiHubFiles=value;renderAiHubFiles();saveAiHubDraft();updateAiHubComposer()},
 seed(messages,pending){const s=currentAiHubSession();s.messages=messages;s.pendingApproval=pending;renderAiHub()},
 select(id){saveAiHubDraft();aiHubCurrent=id;restoreAiHubDraft();renderAiHub();renderAiHubSessions()}
};`;
