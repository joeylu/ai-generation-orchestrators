import test from 'node:test';
import assert from 'node:assert/strict';
import {startHarness} from './harness.mjs';

test('node font/color reach every own caption, all states and native Input without descendant inheritance',async()=>{
  const harness=await startHarness();
  try{
    const result=await harness.page.evaluate(()=>{
      const h=window.harness,before=JSON.stringify(h.skin.profile),reports=[];
      const types=['Text','Panel','Dialog','Button','Switch','CheckBox','RadioGroup','Select','Tabs','List','Input','Slider','ProgressBar'];
      function ownText(handle){
        const childRoots=new Set([...h.runtime.handles.values()].filter(child=>child.parent===handle).map(child=>child.root)),seen=new Set(),labels=[];
        const visit=view=>{
          if(!view||seen.has(view)||childRoots.has(view))return;seen.add(view);
          if(typeof view.text==='string'&&view.style?.fontSize)labels.push(view);
          for(const child of view.children??[])visit(child);
        };
        visit(handle.adapter.view);if(handle.recipe.type==='Select')visit(handle.adapter.view.view);
        return labels;
      }
      for(const type of types){
        h.clear();
        const node=h.make(type,{props:{fontSize:24,textColor:'#fF3366',...(['Slider','ProgressBar'].includes(type)?{showValue:true}:{})},size:{width:800,height:500}});
        const check=phase=>{
          const labels=ownText(node);
          if(!labels.length)throw Error(type+': no owned captions');
          if(labels.some(label=>label.style.fontSize!==24||label.style.fill!=='#fF3366'))throw Error(type+': inconsistent '+phase);
        };
        check('initial');
        const children=[...h.runtime.handles.values()].filter(child=>child.parent===node);
        for(const child of children)for(const label of ownText(child))if(label.style.fontSize!==h.skin.profile.fontSize||label.style.fill==='#fF3366')throw Error(type+': descendant inherited typography');
        if(type==='Switch'||type==='CheckBox')node.setState({checked:!node.readState().checked});
        if(type==='RadioGroup'||type==='Select'||type==='List'){
          const collection=node.props.options??node.props.items;if(collection.length)node.setState({selectedId:collection.at(-1).id});
        }
        if(type==='Tabs')node.setState({activeId:node.props.tabs.at(-1).id});
        if(type==='Slider'||type==='ProgressBar')for(const value of [node.props.min,node.props.max]){node.setState({value});h.runtime.flush();check('percentage endpoint');}
        if(type==='Input'){
          const state=node.readState();h.runtime.focus(node);
          const input=node.adapter.view.input;
          if(!input||input.style.fontSize!=='24px'||getComputedStyle(input).color!=='rgb(255, 51, 102)')throw Error('Input: native typography');
          if(JSON.stringify(node.readState())!==JSON.stringify(state))throw Error('Input: typography changed state');
          node.adapter.view.stopEditing();
        }
        node.resize(820,520);h.runtime.setMode('edit');h.runtime.setMode('play');h.runtime.flush();check('resize/mode/state');
        if(['Switch','CheckBox','RadioGroup'].includes(type)){
          const top=node.root.toGlobal({x:0,y:0}).y;
          for(const label of ownText(node))if(label.getBounds().y<top-.1)throw Error(type+': caption escaped above own box');
        }
        reports.push(type);
      }
      if(JSON.stringify(h.skin.profile)!==before)throw Error('shared skin profile was mutated');
      return reports;
    });
    assert.equal(result.length,13);assert.deepEqual(harness.errors,[]);
  }finally{await harness.close();}
});
