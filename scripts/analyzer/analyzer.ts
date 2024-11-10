import fs from 'fs/promises';
import path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import { File } from '@babel/types';

interface AnalysisOptions {
  entryFile: string;
  changedFile: string;
  changeType: 'add' | 'modify' | 'delete';
  modifiedExports?: string[];
}

interface DependencyNode {
  file: string;
  changeType: string;
  reason?: string;
  children?: DependencyNode[];
}

export async function analyzeFileChanges(options: AnalysisOptions): Promise<DependencyNode> {
  const { entryFile, changedFile, changeType, modifiedExports = [] } = options;
  console.log('\n[analyzeFileChanges] Starting analysis:', {
    entryFile,
    changedFile,
    changeType,
    modifiedExports
  });

  const dependencies = new Map<string, Set<string>>();
  const exports = new Map<string, Set<string>>();
  const processedFiles = new Set<string>();

  console.log('[analyzeFileChanges] Building dependency tree...');
  await buildDependencyTree(entryFile, dependencies, exports, processedFiles);

  console.log('[analyzeFileChanges] Dependencies map:', 
    Array.from(dependencies.entries()).map(([key, value]) => [key, Array.from(value)]));
  console.log('[analyzeFileChanges] Exports map:', 
    Array.from(exports.entries()).map(([key, value]) => [key, Array.from(value)]));

  const impactVisited = new Set<string>();
  console.log('[analyzeFileChanges] Analyzing impact...');
  
  const result = analyzeImpact(changedFile, {
    dependencies,
    exports,
    changeType,
    modifiedExports,
    visited: impactVisited
  });

  console.log('[analyzeFileChanges] Analysis complete');
  return result;
}

async function buildDependencyTree(
  filePath: string,
  dependencies: Map<string, Set<string>>,
  exports: Map<string, Set<string>>,
  processedFiles: Set<string>
): Promise<void> {
  console.log('\n[buildDependencyTree] Processing file:', filePath);
  console.log('[buildDependencyTree] Already processed files:', Array.from(processedFiles));

  if (processedFiles.has(filePath)) {
    console.log('[buildDependencyTree] File already processed, skipping:', filePath);
    return;
  }

  processedFiles.add(filePath);
  console.log('[buildDependencyTree] Added to processed files:', filePath);

  try {
    console.log('[buildDependencyTree] Reading file:', filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    
    console.log('[buildDependencyTree] Parsing AST for:', filePath);
    const ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    });

    dependencies.set(filePath, new Set());
    exports.set(filePath, new Set());

    const pendingImports: string[] = [];

    console.log('[buildDependencyTree] Traversing AST for:', filePath);
    traverse.default(ast as File, {
      ImportDeclaration(path: NodePath) {
        const importSource = path.node.source.value;
        console.log('[buildDependencyTree] Found import:', importSource, 'in file:', filePath);
        pendingImports.push(importSource);
      },
      ExportNamedDeclaration(path) {
        if (path.node.declaration) {
          const exportName = path.node.declaration.type === 'VariableDeclaration'
            ? path.node.declaration.declarations[0].id.name
            : path.node.declaration.id?.name;
          if (exportName) {
            console.log('[buildDependencyTree] Found named export:', exportName, 'in file:', filePath);
            exports.get(filePath)?.add(exportName);
          }
        }
      },
      ExportDefaultDeclaration() {
        console.log('[buildDependencyTree] Found default export in file:', filePath);
        exports.get(filePath)?.add('default');
      }
    });

    // Process imports after traversal
    for (const importSource of pendingImports) {
      const importPath = await resolveImportPath(filePath, importSource);
      console.log('[buildDependencyTree] Resolved import path:', importPath);
      
      if (importPath) {
        dependencies.get(filePath)?.add(importPath);
        console.log('[buildDependencyTree] Added dependency:', importPath, 'to file:', filePath);
        
        if (!processedFiles.has(importPath)) {
          console.log('[buildDependencyTree] Processing nested dependency:', importPath);
          await buildDependencyTree(importPath, dependencies, exports, processedFiles);
        } else {
          console.log('[buildDependencyTree] Nested dependency already processed:', importPath);
        }
      }
    }

    console.log('[buildDependencyTree] Completed processing file:', filePath);
  } catch (error) {
    console.warn('[buildDependencyTree] Error processing file:', filePath, error);
  }
}

async function resolveImportPath(currentFile: string, importPath: string): Promise<string | null> {
  console.log('\n[resolveImportPath] Resolving:', importPath, 'from file:', currentFile);

  if (!importPath.startsWith('.') && !importPath.startsWith('@/')) {
    console.log('[resolveImportPath] Skipping external module:', importPath);
    return null;
  }

  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  let resolvedPath: string;

  if (importPath.startsWith('@/')) {
    resolvedPath = path.resolve(process.cwd(), 'src', importPath.slice(2));
    console.log('[resolveImportPath] Resolved alias path:', resolvedPath);
  } else {
    resolvedPath = path.resolve(path.dirname(currentFile), importPath);
    console.log('[resolveImportPath] Resolved relative path:', resolvedPath);
  }

  try {
    const stats = await fs.stat(resolvedPath);
    if (stats.isFile()) {
      console.log('[resolveImportPath] Found exact file match:', resolvedPath);
      return resolvedPath;
    }
  } catch {}

  for (const ext of extensions) {
    try {
      const pathWithExt = resolvedPath + ext;
      console.log('[resolveImportPath] Trying with extension:', pathWithExt);
      const stats = await fs.stat(pathWithExt);
      if (stats.isFile()) {
        console.log('[resolveImportPath] Found file with extension:', pathWithExt);
        return pathWithExt;
      }
    } catch {}
  }

  for (const ext of extensions) {
    try {
      const indexPath = path.join(resolvedPath, `index${ext}`);
      console.log('[resolveImportPath] Trying index file:', indexPath);
      const stats = await fs.stat(indexPath);
      if (stats.isFile()) {
        console.log('[resolveImportPath] Found index file:', indexPath);
        return indexPath;
      }
    } catch {}
  }

  console.log('[resolveImportPath] Could not resolve import:', importPath);
  return null;
}

function analyzeImpact(
  changedFile: string,
  context: {
    dependencies: Map<string, Set<string>>;
    exports: Map<string, Set<string>>;
    changeType: string;
    modifiedExports: string[];
    visited: Set<string>;
  }
): DependencyNode {
  const { dependencies, exports, changeType, modifiedExports, visited } = context;
  
  console.log('\n[analyzeImpact] Analyzing impact for file:', changedFile);
  console.log('[analyzeImpact] Already visited files:', Array.from(visited));
  
  const result: DependencyNode = {
    file: changedFile,
    changeType,
    children: []
  };

  console.log('[analyzeImpact] Checking dependencies for:', changedFile);
  for (const [file, deps] of dependencies.entries()) {
    console.log('[analyzeImpact] Checking file:', file, 'with dependencies:', Array.from(deps));
    
    if (deps.has(changedFile) && !visited.has(file)) {
      console.log('[analyzeImpact] Found dependent file:', file);
      visited.add(file);
      
      const reason = determineImpactReason(changedFile, file, {
        changeType,
        modifiedExports,
        exports
      });
      
      console.log('[analyzeImpact] Impact reason:', reason);
      
      if (reason) {
        console.log('[analyzeImpact] Analyzing nested impact for:', file);
        const childImpact = analyzeImpact(file, {
          dependencies,
          exports,
          changeType: 'affected',
          modifiedExports,
          visited
        });
        childImpact.reason = reason;
        result.children?.push(childImpact);
      }
    }
  }

  console.log('[analyzeImpact] Completed impact analysis for:', changedFile);
  return result;
}

function determineImpactReason(
  changedFile: string,
  dependentFile: string,
  context: {
    changeType: string;
    modifiedExports: string[];
    exports: Map<string, Set<string>>;
  }
): string | null {
  const { changeType, modifiedExports, exports } = context;
  
  console.log('\n[determineImpactReason] Determining impact:', {
    changedFile,
    dependentFile,
    changeType,
    modifiedExports
  });

  if (changeType === 'delete') {
    console.log('[determineImpactReason] File was deleted');
    return 'File was deleted';
  }

  if (changeType === 'add') {
    console.log('[determineImpactReason] File was added');
    return 'New file was added';
  }

  if (changeType === 'modify' && modifiedExports.length > 0) {
    const fileExports = exports.get(changedFile);
    console.log('[determineImpactReason] Checking modified exports:', 
      Array.from(fileExports || new Set()));
    
    const modifiedExportsExist = modifiedExports.some(exp => fileExports?.has(exp));
    if (modifiedExportsExist) {
      const reason = `Modified exports: ${modifiedExports.join(', ')}`;
      console.log('[determineImpactReason]', reason);
      return reason;
    }
  }

  console.log('[determineImpactReason] File was modified');
  return 'File was modified';
}