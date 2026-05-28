export class BudgetService {
  canQuery(agentId: string): boolean { return true; }
  postQueryCheck(agentId: string, result: any): void {}
}
export type IBudgetService = any;
