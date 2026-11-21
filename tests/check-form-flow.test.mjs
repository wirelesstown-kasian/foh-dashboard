import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require=createRequire(import.meta.url), React=require('react')
const writerSource=ts.transpileModule(readFileSync('src/lib/checkWriter.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const writer={};new Function('exports',writerSource)(writer)
function fixture(){
 const state=[];let cursor=0
 const react={...React,useId:()=> 'payee-id',useState(initial){const index=cursor++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value}]} }
 const exports={}
 const mocks={react,'@base-ui/react/combobox':{Combobox:Object.fromEntries(['Root','Input','Portal','Positioner','Popup','Empty','List','Item'].map(key=>[key,`Combo${key}`]))},'@/components/ui/button':{Button:'button'},'@/components/layout/PinModal':{PinModal:'PinModal'},'@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogHeader','DialogTitle'].map(key=>[key,key])),'@/lib/clockUtils':{BUSINESS_TIMEZONE:'America/Chicago'},'@/lib/checkWriter':writer}
 const source=ts.transpileModule(readFileSync('src/app/payroll/check-writer/check-form.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('exports','require',source)(exports,name=>mocks[name]??require(name))
 const data={employees:[],vendors:[],entries:[],runs:[],categories:[]}, calls=[]
 const submit=async(action,values,pin)=>{calls.push({action,values,pin});if(action==='save_vendor'){const vendor={id:'new-vendor',name:values.name,category:null,address:null,phone:null};data.vendors.push(vendor);return [vendor]}return []}
 const render=()=>{cursor=0;return exports.CheckForm({data,source:'app',submit})}
 function all(node,predicate){if(!node||typeof node!=='object')return [];return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props?.children).flatMap(child=>all(child,predicate))]}
 const field=(tree,label)=>all(tree,node=>node.type===exports.Field&&node.props.label===label)[0].props.children
 const forms=tree=>all(tree,node=>node.type===exports.PinForm)
 return {render,all,field,forms,calls}
}
test('Quick Add needs only a name, selects the saved vendor, and retains check fields',async()=>{
 const f=fixture();let tree=f.render()
 f.field(tree,'Amount').props.onChange({target:{value:'42.50'}})
 f.all(tree,node=>node.type==='button'&&node.props.children==='Quick Add Payee')[0].props.onClick()
 tree=f.render();assert.equal(f.all(tree,node=>node.type==='Dialog')[0].props.open,true)
 f.field(tree,'Payee name').props.onChange({target:{value:'New vendor'}})
 tree=f.render();await f.forms(tree)[1].props.submit('1234')
 tree=f.render();assert.equal(f.field(tree,'Amount').props.value,'42.50')
 assert.equal(f.all(tree,node=>node.type==='Dialog')[0].props.open,false)
 await f.forms(tree)[0].props.submit('1234')
 assert.deepEqual(f.calls[0].values,{name:'New vendor',quick_add:true})
 assert.equal(f.calls[1].values.vendor_id,'new-vendor');assert.equal(f.calls[1].values.amount,'42.50')
})
test('blank payee relaxes payee selection and requires a memo before submitting',async()=>{
 const f=fixture();let tree=f.render()
 const checkbox=f.all(tree,node=>node.type==='input'&&node.props.type==='checkbox')[0]
 checkbox.props.onChange({target:{checked:true}})
 tree=f.render()
 assert.equal(f.all(tree,node=>node.type==='ComboRoot')[0].props.required,false)
 assert.equal(f.field(tree,'Memo (required for blank payee)').props.required,true)
 await assert.rejects(f.forms(tree)[0].props.submit('1234'),/memo is required/)
 f.field(tree,'Memo (required for blank payee)').props.onChange({target:{value:'Walk-in refund'}})
 tree=f.render();await f.forms(tree)[0].props.submit('1234')
 assert.equal(f.calls[0].values.omit_payee_on_print,true)
 assert.equal(f.calls[0].values.vendor_id,undefined)
 assert.equal(f.calls[0].values.memo,'Walk-in refund')
})
