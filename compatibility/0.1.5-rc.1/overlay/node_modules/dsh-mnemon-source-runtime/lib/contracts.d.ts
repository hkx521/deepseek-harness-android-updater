//#region src/contracts.d.ts
type RuntimeMemoryTarget = 'memory' | 'user';
type RuntimeMemoryImportance = 'critical' | 'normal' | 'low';
type RuntimeMemoryAction = 'add' | 'replace' | 'remove';
interface RuntimeMemoryEntry {
  content: string;
  created_at: string;
  updated_at: string;
  target: RuntimeMemoryTarget;
  importance: RuntimeMemoryImportance;
  /** Optional git branch names that limit where this entry is projected. Absent means every branch. */
  branches?: string[];
}
interface RuntimeMemoryUsage {
  used: number;
  limit: number;
}
interface RuntimeMemoryTargetView extends RuntimeMemoryUsage {
  target: RuntimeMemoryTarget;
  entryCount: number;
  markdownPath: string;
}
interface RuntimeMemorySnapshot {
  directory: string;
  sourcePath: string;
  revision: string;
  generatedAt: string;
  entries: RuntimeMemoryEntry[];
  targets: Record<RuntimeMemoryTarget, RuntimeMemoryTargetView>;
}
interface RuntimeMemoryCompactedEntry {
  content: string;
  importance: RuntimeMemoryImportance;
  /** Branch scope carried through compaction; absent means the entry is visible on every branch. */
  branches?: string[];
}
interface RuntimeMemoryMutation {
  action: RuntimeMemoryAction;
  target: RuntimeMemoryTarget;
  content?: string;
  oldText?: string;
  importance?: RuntimeMemoryImportance;
  /** Git branch names limiting where a target=memory entry is projected. Absent keeps the current scope on replace; an empty list clears it. */
  branches?: string[];
}
type RuntimeMemoryMutationResult = {
  success: true;
  message: string;
  target: RuntimeMemoryTarget;
  entryCount: number;
  usage: RuntimeMemoryUsage;
  added?: string;
  replaced?: {
    from: string;
    to: string;
  };
  removed?: string;
  maintenance?: {
    kind: 'local-compaction' | 'mnemon-archive';
    runId: string;
    provider: string;
    summary: string;
    memoryBodyIds: string[];
  };
};
interface RuntimeMemoryMaintenancePlan {
  revision: string;
  action: RuntimeMemoryAction;
  target: RuntimeMemoryTarget;
  entries: RuntimeMemoryEntry[];
  pending?: RuntimeMemoryCompactedEntry;
  excluded?: RuntimeMemoryEntry;
  used: number;
  projected: number;
  limit: number;
  requiresMaintenance: boolean;
}
declare const RUNTIME_MEMORY_VERSION = 1;
declare const RUNTIME_ENTRY_DELIMITER = "\n§\n";
interface RuntimeMemoryLimits {
  readonly memory: number;
  readonly user: number;
}
declare const RUNTIME_MEMORY_LIMITS: RuntimeMemoryLimits;
//#endregion
export { RUNTIME_ENTRY_DELIMITER, RUNTIME_MEMORY_LIMITS, RUNTIME_MEMORY_VERSION, RuntimeMemoryAction, RuntimeMemoryCompactedEntry, RuntimeMemoryEntry, RuntimeMemoryImportance, RuntimeMemoryLimits, RuntimeMemoryMaintenancePlan, RuntimeMemoryMutation, RuntimeMemoryMutationResult, RuntimeMemorySnapshot, RuntimeMemoryTarget, RuntimeMemoryTargetView, RuntimeMemoryUsage };