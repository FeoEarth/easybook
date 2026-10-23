import {Editor,Extension,Node,Mark,mergeAttributes} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import DOMPurify from 'dompurify';
import {Plugin} from '@tiptap/pm/state';
import {validateDocument,emptyDocument,serializeDocument,deserializeDocument,plainText,assetRefs} from '../shared/document.mjs';
const colorMark=(name,css)=>Mark.create({name,addAttributes(){return {color:{default:'#ffff00'}}},parseHTML(){return [{tag:`span[data-mark="${name}"]`}]},renderHTML({HTMLAttributes}){return ['span',{'data-mark':name,style:`${css}:${HTMLAttributes.color}`},0]}});
const media=name=>Node.create({name,group:'block',atom:true,addAttributes(){return name==='image'?{assetId:{default:null},alt:{default:''},width:{default:null},height:{default:null}}:{assetId:{default:null},name:{default:''},mime:{default:'application/octet-stream'},size:{default:0}}},renderHTML({node}){return ['div',{'data-asset-id':node.attrs.assetId,'data-type':name},node.attrs.name||node.attrs.alt||'图片']}});
const sanitize=html=>DOMPurify.sanitize(html,{ALLOWED_TAGS:['p','br','strong','em','s','u','h1','h2','h3','blockquote','pre','code','ul','ol','li','a','label','input','span'],ALLOWED_ATTR:['href','data-type','data-checked','type','checked','start'],ALLOW_DATA_ATTR:false,ADD_ATTR:['data-type','data-checked'],ALLOWED_URI_REGEXP:/^(?:https?|mailto):/i});
window.RichNotes={empty:emptyDocument,validate:validateDocument,serialize:serializeDocument,deserialize:deserializeDocument,plain:plainText,assetRefs,sanitize,create(element,onChange,onLimit){
 let loading=false;
 const limit=Extension.create({name:'documentValidation',addProseMirrorPlugins(){return [new Plugin({filterTransaction(tr){if(!tr.docChanged)return true;try{validateDocument({schemaVersion:1,doc:tr.doc.toJSON()});return true}catch{if(!loading)onLimit();return false}}})]}});
 const editor=new Editor({element,extensions:[StarterKit.configure({trailingNode:false,heading:{levels:[1,2,3]},link:{openOnClick:false,HTMLAttributes:{target:'_blank',rel:'noopener noreferrer nofollow',class:null}}}),TaskList,TaskItem.configure({nested:true,onReadOnlyChecked:()=>true}),colorMark('highlight','background-color'),colorMark('textColor','color'),media('image'),media('attachment'),limit],content:emptyDocument().doc,editorProps:{attributes:{class:'rich-content',role:'textbox','aria-label':'笔记正文','aria-multiline':'true'},handlePaste(view,event){const rich=event.clipboardData?.getData('text/html');if(rich){event.preventDefault();editor.commands.insertContent(sanitize(rich));return true}return false}},onUpdate(){if(!loading)onChange(validateDocument({schemaVersion:1,doc:editor.getJSON()}))}});
 const api={editor,load(value){validateDocument(value);loading=true;try{editor.commands.setContent(value.doc,{emitUpdate:false})}finally{loading=false}},value(){return validateDocument({schemaVersion:1,doc:editor.getJSON()})},plain(){return plainText(api.value())},command(name){editor.chain().focus()[name]().run()},readonly(value){editor.setEditable(!value)},attachment(id,name,mime='application/octet-stream',size=0){editor.chain().focus().insertContent({type:'attachment',attrs:{assetId:'sha256:'+id,name,mime,size}}).run()},tasks(){let total=0,done=0;editor.state.doc.descendants(n=>{if(n.type.name==='taskItem'){total++;if(n.attrs.checked)done++}});return {total,done}}};return api;
}};
import {WebStore} from '../shared/web-store.mjs';
window.EasybookWebStore=WebStore;
