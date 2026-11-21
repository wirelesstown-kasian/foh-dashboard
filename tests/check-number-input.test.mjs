import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require=createRequire(import.meta.url), React=require('react')
function compile(file,dependencies={}){
 const exports={}
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 new Function('exports','require',code)(exports,name=>dependencies[name]??require(name))
 return exports
}
const writer=compile('src/lib/checkWriter.ts')
function fixture(reprint=false){
 const state=[],pending=[];let cursor=0
 const react={...React,useEffect(){},useState(initial){const index=cursor++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>pending.push(()=>{state[index]=typeof value==='function'?value(state[index]):value})]}}
 const {PrintForm}=compile('src/app/payroll/check-writer/check-dialogs.tsx',{
  react,'@/lib/checkWriter':writer,'@/components/ui/button':{Button:'button'},'./check-form':{CategoryField:'CategoryField',Field:'Field',PinForm:'PinForm',checkInput:''}
 })
 const entries=[{id:'a',revision:1,amount:10,payee_name:'Vendor A',bank_account:'Checking',category:'Supplies',check_number:reprint?'00123':null},{id:'b',revision:1,amount:20,payee_name:'Vendor B',bank_account:'Checking',category:'Supplies',check_number:reprint?'00124':null}]
 const calls=[]
 const render=()=>{while(pending.length)pending.shift()();cursor=0;return PrintForm({entries,reprint,data:{entries:[]},submit:async(...args)=>{calls.push(args);return []}})}
 function all(node,predicate){if(!node||typeof node!=='object')return [];return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props?.children).flatMap(child=>all(child,predicate))]}
 const inputs=tree=>all(tree,node=>node.type==='input')
 const edit=(tree,index,value)=>{const event={target:{value}};inputs(tree)[index].props.onChange(event);event.target.value='DOM value changed after handler';return render()}
 return {render,inputs,edit,calls}
}
test('first number accepts clearing and leading zeroes, sequences bulk checks and submits exact numbers',async()=>{
 const f=fixture();let tree=f.render()
 for(const value of ['', '0', '00', '002', '0024']){
  tree=f.edit(tree,0,value)
  assert.equal(f.inputs(tree)[0].props.value,value)
 }
 assert.equal(f.inputs(tree)[1].props.value,'0025')
 await tree.props.submit('1234')
 assert.equal(f.calls[0][1].items[0].check_number,'0024')
 assert.equal(f.calls[0][1].items[1].check_number,'0025')
 tree=f.edit(tree,0,'000')
 assert.equal(f.inputs(tree)[0].props.value,'000');assert.equal(f.inputs(tree)[1].props.value,'')
})
test('subsequent check numbers can be corrected without overwriting the first',()=>{
 const f=fixture();let tree=f.render()
 tree=f.edit(tree,0,'2411');tree=f.edit(tree,1,'2500')
 assert.equal(f.inputs(tree)[0].props.value,'2411');assert.equal(f.inputs(tree)[1].props.value,'2500')
})
test('reprint numbers remain original and cannot be edited',()=>{
 const f=fixture(true),tree=f.render()
 assert.equal(f.inputs(tree)[0].props.value,'00123');assert.equal(f.inputs(tree)[1].props.value,'00124')
 assert.equal(f.inputs(tree)[0].props.disabled,true)
})
