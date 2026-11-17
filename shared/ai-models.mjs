export const modelIdPattern=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
export function modelIds(values){return [...new Set((Array.isArray(values)?values:[]).filter(value=>typeof value==='string'&&modelIdPattern.test(value)))].slice(0,500)}
export function profileModels(profile){let saved=[];try{saved=JSON.parse(profile.models_json||'[]')}catch{}return modelIds([profile.model,...(Array.isArray(profile.models)?profile.models:Array.isArray(saved)?saved:[])])}
export function modelChoices(profiles,localModels=[]){
 return [...profiles.flatMap(profile=>profileModels(profile).map(model=>({profileId:profile.id,model,label:profile.label}))),...localModels.filter(model=>model.state==='installed').map(model=>({profileId:'__local__',model:model.id,label:'设备端离线',title:model.title}))];
}
