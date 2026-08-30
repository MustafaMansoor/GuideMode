const STOP = new Set(['a','an','and','the','to','for','of','on','in','me','my','i','help','how','this','that','with','from','please']);
const tokens = value => [...new Set(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(token => token.length > 1 && !STOP.has(token)))];

function scoreRoute(goal, route, visited = new Set()) {
  const goalTokens = tokens(goal); const textTokens = tokens(route.text); const pathTokens = tokens(`${route.pathname} ${route.search}`); const contextTokens = tokens(route.context);
  const overlap = (left, right) => left.filter(token => right.includes(token)).length;
  const textOverlap = overlap(goalTokens, textTokens); const pathOverlap = overlap(goalTokens, pathTokens); const contextOverlap = overlap(goalTokens, contextTokens);
  const goalPhrase = goalTokens.join(' '); const combined = [...textTokens, ...pathTokens].join(' ');
  let score = textOverlap * 7 + pathOverlap * 5 + contextOverlap * 2 + (route.same_origin ? 4 : -3);
  if (goalPhrase.length > 5 && combined.includes(goalPhrase)) score += 12;
  if (visited.has(route.href)) score -= 30;
  const reasons = [];
  if (textOverlap) reasons.push(`${textOverlap} goal token${textOverlap === 1 ? '' : 's'} matched link text`);
  if (pathOverlap) reasons.push(`${pathOverlap} goal token${pathOverlap === 1 ? '' : 's'} matched route path`);
  if (contextOverlap) reasons.push('surrounding context matched');
  if (route.same_origin) reasons.push('same-origin route'); else reasons.push('external route');
  if (visited.has(route.href)) reasons.push('already visited');
  return { score, reasons, match_count: textOverlap + pathOverlap + contextOverlap };
}

function searchRoutes(query, routes = [], { limit = 10, visited = new Set() } = {}) {
  const queryTokens=tokens(query),frequency=new Map();
  for(const route of routes){const routeTokens=new Set(tokens(`${route.text} ${route.pathname} ${route.search} ${route.context}`));for(const token of queryTokens)if(routeTokens.has(token))frequency.set(token,(frequency.get(token)||0)+1)}
  const rarityThreshold=Math.max(2,Math.ceil(routes.length*.12));
  return routes.map(route => {const scored={ ...route, ...scoreRoute(query, route, visited) };const routeTokens=new Set(tokens(`${route.text} ${route.pathname} ${route.search} ${route.context}`));scored.specific_match=queryTokens.some(token=>routeTokens.has(token)&&(frequency.get(token)||0)<=rarityThreshold);return scored})
    .filter(route => route.score > 0 && route.match_count > 0 && (routes.length<8 || route.specific_match))
    .sort((a, b) => b.score - a.score || Number(b.same_origin) - Number(a.same_origin) || a.href.localeCompare(b.href))
    .slice(0, Math.min(12,limit))
    .map(route => ({ ref: route.ref, text: route.text, path: `${route.pathname}${route.search}${route.hash}`, same_origin: route.same_origin,
      context: route.context, score: route.score, reason: route.reasons.join('; ') }));
}

module.exports = { tokens, scoreRoute, searchRoutes };
