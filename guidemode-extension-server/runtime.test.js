const assert = require('node:assert/strict');
const { ExtensionV2Adapter, validateAction, consequential, sensitive } = require('./v2-adapter');
const { plannerObservation } = require('./focus-adapter');
const { searchRoutes } = require('./route-scout');

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
assert.throws(() => validateAction({ action: 'fill', ref: 'e2', value: 'x', reason: '', evidence_refs: [] }, controls), /incompatible/);
assert(consequential(controls[2])); assert(sensitive(controls[3], 'fill'));
assert.equal(validateAction({ action:'navigate_route',ref:'r1',value:null,reason:'',evidence_refs:[] },controls,observation.routes,observation.forms).href,'https://example.test/replace-lost-licence');
assert.throws(()=>validateAction({ action:'navigate_route',ref:null,value:'https://invented.test',reason:'',evidence_refs:[] },controls,observation.routes,observation.forms),/unknown route ref/);
assert.equal(validateAction({ action:'submit_form',ref:'f1',value:null,reason:'',evidence_refs:[] },controls,observation.routes,observation.forms).method,'GET');
const ranked=searchRoutes('replace lost driving licence',[...observation.routes,{ref:'r2',text:'Replacement',href:'https://external.test/replace',pathname:'/replace',search:'',hash:'',same_origin:false,context:''}]);
assert.equal(ranked[0].ref,'r1'); assert(ranked[0].score>ranked[1].score);
assert.equal(searchRoutes('purple XXL shirt under five',[{ref:'r9',text:'New arrivals',href:'https://example.test/new',pathname:'/new',search:'',hash:'',same_origin:true,context:'Home'}]).length,0);
const planner = plannerObservation(observation); assert(planner.some(item => item.ref === 'c1' && item.visible_text.includes('£14')));

const fakeAi = { models: { generateContent: async ({ contents }) => ({
  text: JSON.stringify(contents.includes('Replanner') ? { diagnosis: 'Use another route', next_subgoal: 'Search', avoid_actions: [], evidence_refs: ['c1'], status: 'continue' } :
    { action: 'fill', ref: 'e1', value: 'lost licence', reason: 'Search public guidance', evidence_refs: [] }),
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 }
}) } };
(async () => {
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
  console.log('GuideMode v2 adapter checks PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
