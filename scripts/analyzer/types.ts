export type ChangeType = 'add' | 'delete' | 'modify';

export interface FileNode {
  path: string;
  imports: string[];
  exports: string[];
  children: FileNode[];
}

export interface ChangeInput {
  filePath: string;
  changeType: ChangeType;
  modifiedExports?: string[];
}

export interface ImpactResult {
  filePath: string;
  reason: string;
  children: ImpactResult[];
}