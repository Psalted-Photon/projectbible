// Types for search.js, which stays plain JavaScript so atlas-lab.js can
// import it as-is.

export class ScriptureSearch {
  constructor(places?: any[], ancient?: any[]);
  search(query: string, limit?: number): any[];
}
