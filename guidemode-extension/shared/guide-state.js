(function(root){
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const terminal=new Set(['completed','impossible','stopped']);
  function semanticIdentity(target){return target?[target.role||target.type,clean(target.name||target.text||target.purpose).toLowerCase(),clean(target.group_context||target.context).toLowerCase()].join('|'):null}
  function targetFor(action,observation){
    if(!action?.ref)return null;const all=[...(observation.controls||[]),...(observation.routes||[]),...(observation.forms||[]),...(observation.content||[])];
    const item=all.find(entry=>entry.ref===action.ref);if(!item)return null;
    return {ref:item.ref,type:action.action,role:item.role||item.type||item.source||'element',name:item.name||item.text||item.purpose||action.reason||'Next step',
      group_context:item.group_context||item.context||'',identity:semanticIdentity(item)};
  }
  function expectedFor(action,target,observation){
    const base={action:action.action,targetIdentity:target?.identity,targetRole:target?.role,targetName:target?.name,targetGroup:target?.group_context,previousSignature:observation.progress_signature,previousUrl:observation.page.url,previousHeading:observation.page.heading};
    if(action.action==='check')return{...base,checked:true};if(action.action==='uncheck')return{...base,checked:false};
    if(['fill','select'].includes(action.action))return{...base,value:String(action.value??'')};
    if(action.action==='navigate_route'){const route=(observation.routes||[]).find(item=>item.ref===action.ref);return{...base,href:route?.href||null}}
    return base;
  }
  function create({goal,mode,stepNumber,decision,observation,focusPlan,completedSteps=[]}){
    const target=targetFor(decision.action,observation),items=focusPlan?.elements||[];
    const classifications=kind=>items.filter(item=>(item.final_classification||item.classification)===kind).map(item=>item.ref);
    const supporting=[...new Set([...classifications('relevant').filter(ref=>ref!==target?.ref),target?.group_context?findGroupRefs(observation,target.group_context,target?.ref):[]].flat())].slice(0,5);
    return {goal,status:'guiding',mode,stepNumber,instruction:instructionFor(decision.action,target),target,supportingRefs:supporting,
      criticalRefs:classifications('critical'),consequentialRefs:classifications('consequential'),uncertainRefs:focusPlan?.uncertain_refs||[],
      completedSteps:[...completedSteps],awaitingUser:mode==='guide',explanation:clean(decision.action?.reason||decision.message),
      expected:expectedFor(decision.action,target,observation),observationId:observation.observation_id};
  }
  function findGroupRefs(observation,group,exclude){return(observation.controls||[]).filter(item=>item.ref!==exclude&&clean(item.group_context)===clean(group)).map(item=>item.ref).slice(0,3)}
  function instructionFor(action,target){const name=clean(target?.name||action?.reason||'the highlighted item');return({check:`Choose ${name}`,uncheck:`Clear ${name}`,fill:`Enter the requested value in ${name}`,select:`Choose an option in ${name}`,click:`Open ${name}`,navigate_route:`Open ${name}`,submit_form:`Apply ${name}`,scroll:`Review ${name}`,focus:`Go to ${name}`})[action?.action]||clean(action?.reason||'Continue on the page')}
  function findCurrentTarget(expected,observation){const all=[...(observation.controls||[]),...(observation.routes||[]),...(observation.forms||[]),...(observation.content||[])],exact=all.find(item=>semanticIdentity(item)===expected.targetIdentity);if(exact)return exact;if(['fill','select'].includes(expected.action))return all.find(item=>(item.role||item.type)===expected.targetRole&&clean(item.group_context||item.context)===clean(expected.targetGroup));return null}
  function verify(guideState,observation){const expected=guideState?.expected;if(!expected)return{verified:false,semanticProgress:false};const current=findCurrentTarget(expected,observation);
    const signatureChanged=observation.progress_signature!==expected.previousSignature,urlChanged=observation.page.url!==expected.previousUrl,headingChanged=observation.page.heading!==expected.previousHeading;
    let verified=false;if(expected.action==='check')verified=current?.checked===true;else if(expected.action==='uncheck')verified=current?.checked===false;
    else if(['fill','select'].includes(expected.action))verified=clean(current?.value).toLowerCase()===clean(expected.value).toLowerCase();
    else if(expected.action==='navigate_route')verified=urlChanged&&(expected.href?observation.page.url===expected.href||observation.page.url.startsWith(expected.href):true);
    else if(expected.action==='click'||expected.action==='submit_form')verified=signatureChanged&&(urlChanged||headingChanged||!current);
    return{verified,semanticProgress:signatureChanged,currentTarget:current||null,urlChanged,headingChanged};}
  function idle(){return{goal:null,status:'idle',stepNumber:0,instruction:'',target:null,supportingRefs:[],criticalRefs:[],consequentialRefs:[],completedSteps:[],awaitingUser:false,explanation:''}}
  root.GuideModeGuideState={create,verify,idle,targetFor,semanticIdentity,terminal};
})(globalThis);
