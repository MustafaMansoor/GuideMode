const assert=require('node:assert/strict');require('../shared/guide-state.js');const G=globalThis.GuideModeGuideState;
const observation={observation_id:'obs1',page:{url:'https://example.test/shop',heading:'Shop'},progress_signature:'A',controls:[
  {ref:'e1',role:'checkbox',name:'Small',group_context:'Size',checked:false},{ref:'e2',role:'checkbox',name:'Men',group_context:'Department',checked:true},
  {ref:'e3',role:'button',name:'Continue',group_context:'Form'}],routes:[{ref:'r1',text:'Replace a lost licence',href:'https://example.test/replace',context:'Driving licences'}],forms:[],content:[]};
const decision={action:{action:'check',ref:'e1',value:null,reason:'Select size Small'},message:'Selecting Small'};
const state=G.create({goal:'Find a men’s shirt in Small',mode:'guide',stepNumber:2,decision,observation,focusPlan:{elements:[{ref:'e1',final_classification:'relevant'},{ref:'e2',final_classification:'relevant'},{ref:'e3',final_classification:'deemphasize'}]},completedSteps:[]});
assert.equal(state.goal,'Find a men’s shirt in Small');assert.equal(state.target.ref,'e1');assert.equal(state.instruction,'Choose Small');assert(state.supportingRefs.length<=5);assert.equal(state.awaitingUser,true);
assert.equal(G.verify(state,{...observation,controls:observation.controls.map(item=>item.ref==='e1'?{...item,checked:true}:item),progress_signature:'B'}).verified,true);
assert.equal(G.verify(state,{...observation,progress_signature:'B'}).verified,false);
const click=G.create({goal:'Open guidance',mode:'guide',stepNumber:1,decision:{action:{action:'click',ref:'e3',reason:'Open guidance'}},observation,focusPlan:{elements:[]}});
assert.equal(G.verify(click,{...observation,progress_signature:'A'}).verified,false);assert.equal(G.verify(click,{...observation,progress_signature:'B',page:{url:'https://example.test/next',heading:'Next'}}).verified,true);
assert.equal(G.idle().goal,null);assert.equal(G.idle().status,'idle');
const changed=G.create({goal:'Replace my licence',mode:'guide',stepNumber:1,decision:{action:{action:'navigate_route',ref:'r1',reason:'Open replacement'}},observation,focusPlan:{elements:[]}});assert.equal(changed.goal,'Replace my licence');assert.notEqual(changed.target.identity,state.target.identity);
console.log('GuideState goal-conditioning and verification checks PASS');
