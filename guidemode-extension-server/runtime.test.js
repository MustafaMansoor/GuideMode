const assert = require('node:assert/strict');
const { ExtensionV2Adapter, validateAction, consequential, sensitive, compactModelContent } = require('./v2-adapter');
const { plannerObservation } = require('./focus-adapter');
const { searchRoutes } = require('./route-scout');
const { createRequestSnapshot, invalidRef, staleRef } = require('./ref-lifecycle');

const controls = [
  { ref: 'e1', role: 'combobox', name: 'Search', type: 'search', disabled: false, group_context: 'Services', capabilities: { editable_combobox: true, actions: ['fill','click'] } },
  { ref: 'e2', role: 'combobox', name: 'Sort', type: null, disabled: false, group_context: 'Results', capabilities: { editable_combobox: false, actions: ['select','click'] }, options: [{ value: 'price', label: 'Price' }] },
  { ref: 'e3', role: 'button', name: 'Submit application', disabled: false, group_context: 'Application', capabilities: { actions: ['click'] } },
  { ref: 'e4', role: 'textbox', name: 'Password', type: 'password', disabled: false, group_context: 'Sign in', capabilities: { actions: ['fill'] } }
];
const observation = { page: { url: 'https://example.test', title: 'Services', heading: 'Services' }, controls,
  routes: [{ ref:'r1', text:'Replace a lost, stolen or damaged licence', href:'https://example.test/replace-lost-licence', pathname:'/replace-lost-licence', search:'', hash:'', same_origin:true, context:'Driving licences' }],
  forms: [{ ref:'f1', method:'GET', action:'https://example.test/search', same_origin:true, auto_submittable:true, purpose:'Search', controls:['e1'] }],
  content: [{ ref: 'c1', type: 'fee_or_price', text: 'Online fee is £14', context: 'Renewal' }], summary: { control_count: 4, content_count: 1 }, route_summary:{raw_link_count:20,unique_route_count:1}, progress_signature: 'A' };

assert.equal(validateAction({ action: 'fill', ref: 'e1', value: 'lost', reason: '', evidence_refs: [] }, controls).ref, 'e1');
assert.equal(validateAction({ action: 'fill', ref: 'e2', value: 'x', reason: '', evidence_refs: [] }, controls).code, 'INCOMPATIBLE_ACTION');
assert(consequential(controls[2])); assert(sensitive(controls[3], 'fill'));
assert.equal(validateAction({ action:'navigate_route',ref:'r1',value:null,reason:'',evidence_refs:[] },controls,observation.routes,observation.forms).href,'https://example.test/replace-lost-licence');
assert.equal(validateAction({ action:'navigate_route',ref:null,value:'https://invented.test',reason:'',evidence_refs:[] },controls,observation.routes,observation.forms).code,'INVALID_REF');
assert.equal(validateAction({ action:'submit_form',ref:'f1',value:null,reason:'',evidence_refs:[] },controls,observation.routes,observation.forms).method,'GET');
const ranked=searchRoutes('replace lost driving licence',[...observation.routes,{ref:'r2',text:'Replacement',href:'https://external.test/replace',pathname:'/replace',search:'',hash:'',same_origin:false,context:''}]);
assert.equal(ranked[0].ref,'r1'); assert(ranked[0].score>ranked[1].score);
assert.equal(searchRoutes('purple XXL shirt under five',[{ref:'r9',text:'New arrivals',href:'https://example.test/new',pathname:'/new',search:'',hash:'',same_origin:true,context:'Home'}]).length,0);
const planner = plannerObservation(observation); assert(planner.some(item => item.ref === 'c1' && item.visible_text.includes('£14')));
const compacted=compactModelContent({...observation,content:[...observation.content,{ref:'c2',type:'paragraph',text:'Search',context:''},{ref:'c3',type:'alert',text:'Search',context:''}]},[]);
assert(!compacted.some(item=>item.ref==='c2'));assert(compacted.some(item=>item.ref==='c3'));

const fakeAi = { models: { generateContent: async ({ contents }) => ({
  text: JSON.stringify(contents.includes('Replanner') ? { diagnosis: 'Use another route', next_subgoal: 'Search', avoid_actions: [], evidence_refs: ['c1'], status: 'continue' } :
    { action: 'fill', ref: 'e1', value: 'lost licence', reason: 'Search public guidance', evidence_refs: [] }),
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 }
}) } };
(async () => {
  const snapshot = createRequestSnapshot({ sessionId: 'snap', generation: 1, observation: { ...observation, observation_id: 'obs-A' } });
  assert.equal(validateAction({ action:'navigate_route',ref:'r1' },snapshot.controls,snapshot.routes,snapshot.forms).ref,'r1');
  assert.equal(invalidRef({ action:'navigate_route',ref:'r999' }, snapshot).code,'INVALID_REF');
  assert.deepEqual(staleRef({ action:'navigate_route',ref:'r1' }, snapshot, 'obs-B').code,'STALE_REF');
  const adapter = new ExtensionV2Adapter({ ai: fakeAi, requestsPerMinute: 100000 });
  const result = await adapter.step({ sessionId: 'test', tabId: 1, goal: 'Find replacement guidance', observation, maxSteps: 5 });
  assert.equal(result.status, 'action'); assert.equal(result.action.action, 'fill'); assert.equal(result.action.ref, 'e1');
  assert.equal(adapter.sessions.get('test').trajectory.navigator_calls, 1);
  const impossibleAi = { models: { generateContent: async ({ contents }) => ({ text: JSON.stringify(contents.includes('Replanner') ?
    { diagnosis: 'Visible evidence shows no matching result.', next_subgoal: '', avoid_actions: [], evidence_refs: ['c1'], status: 'goal_impossible' } :
    { action: 'impossible', ref: null, value: null, reason: 'No matching result is available.', evidence_refs: ['c1'] }) }) } };
  const impossibleAdapter = new ExtensionV2Adapter({ ai: impossibleAi, requestsPerMinute: 100000 });
  const impossible = await impossibleAdapter.step({ sessionId: 'impossible-test', tabId: 2, goal: 'Find an unavailable combination', observation, maxSteps: 5 });
  assert.equal(impossible.status, 'impossible'); assert.equal(impossibleAdapter.sessions.get('impossible-test').trajectory.replanner_calls, 1);
  let release; const delayed = new Promise(resolve => { release = resolve; }); let calls = 0;
  const delayedAi = { models: { generateContent: async () => { calls++; await delayed; return { text: JSON.stringify({ action:'fill',ref:'e1',value:'late',reason:'',evidence_refs:[] }) }; } } };
  const lateAdapter = new ExtensionV2Adapter({ ai: delayedAi, requestsPerMinute: 100000 });
  const pending = lateAdapter.step({ sessionId:'late',tabId:3,goal:'Search',observation:{...observation,observation_id:'obs-A'},generation:1,maxSteps:5 });
  await new Promise(resolve => setImmediate(resolve)); lateAdapter.stop('late', 2); release();
  const late = await pending; assert.equal(late.code,'LATE_RESPONSE'); assert.equal(late.late_response_discarded,true); assert.equal(calls,1);
  const afterStop = await lateAdapter.step({ sessionId:'late',tabId:3,goal:'Search',observation,generation:2,maxSteps:5 });
  assert.equal(afterStop.status,'stopped'); assert.equal(calls,1);
  for (const terminalStatus of ['completed','impossible']) {
    const terminalAdapter = new ExtensionV2Adapter({ ai: fakeAi, requestsPerMinute: 100000 });
    terminalAdapter.createSession({sessionId:`terminal-${terminalStatus}`,goal:'Done',tabId:8,maxSteps:5});
    terminalAdapter.markTerminal(`terminal-${terminalStatus}`,terminalStatus,2);
    const beforeCalls=terminalAdapter.sessions.get(`terminal-${terminalStatus}`).trajectory.navigator_calls;
    await new Promise(resolve=>setTimeout(resolve,50));
    const terminalResult=await terminalAdapter.step({sessionId:`terminal-${terminalStatus}`,goal:'Done',tabId:8,observation,generation:2,maxSteps:5});
    assert.equal(terminalResult.status,terminalStatus);assert.equal(terminalAdapter.sessions.get(`terminal-${terminalStatus}`).trajectory.navigator_calls,beforeCalls);
  }
  let releaseSingle; const singleGate = new Promise(resolve => { releaseSingle = resolve; });
  const singleAdapter = new ExtensionV2Adapter({ ai:{models:{generateContent:async()=>{await singleGate;return {text:JSON.stringify({action:'fill',ref:'e1',value:'x',reason:'',evidence_refs:[]})}}}},requestsPerMinute:100000 });
  const first = singleAdapter.step({sessionId:'single',tabId:4,goal:'Search',observation,generation:1,maxSteps:5});
  await new Promise(resolve=>setImmediate(resolve)); const second=await singleAdapter.step({sessionId:'single',tabId:4,goal:'Search',observation,generation:1,maxSteps:5});
  assert.equal(second.code,'SINGLE_FLIGHT'); releaseSingle(); await first;
  console.log('GuideMode v2 adapter checks PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
