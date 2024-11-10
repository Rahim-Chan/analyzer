import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { FileNode } from './types';

export class FileParser {
  private readonly extensions = ['.js', '.jsx', '.ts', '.tsx'];
  private readonly rootDir: string;
  private readonly alias: Record<string, string>;

  constructor(rootDir: string, alias: Record<string, string> = {}) {
    this.rootDir = rootDir;
    this.alias = alias;
  }

  public parseFile(filePath: string): FileNode {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ast = parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });

    const imports: string[] = [];
    const exports: string[] = [];

    traverse(ast, {
      ImportDeclaration: (path) => {
        const importPath = this.resolveImportPath(filePath, path.node.source.value);
        if (importPath) imports.push(importPath);
      },
      ExportNamedDeclaration: (path) => {
        if (path.node.declaration) {
          if (path.node.declaration.type === 'VariableDeclaration') {
            path.node.declaration.declarations.forEach((dec) => {
              if (dec.id.type === 'Identifier') {
                exports.push(dec.id.name);
              }
            });
          } else if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
            exports.push(path.node.declaration.id.name);
          }
        }
      },
      ExportDefaultDeclaration: () => {
        exports.push('default');
      },
    });

    return {
      path: filePath,
      imports,
      exports,
      children: [],
    };
  }

  private resolveImportPath(currentFile: string, importPath: string): string | null {
    // Handle alias imports
    for (const [alias, aliasPath] of Object.entries(this.alias)) {
      if (importPath.startsWith(alias)) {
        importPath = path.join(this.rootDir, importPath.replace(alias, aliasPath));
        break;
      }
    }

    // Handle relative imports
    if (importPath.startsWith('.')) {
      importPath = path.resolve(path.dirname(currentFile), importPath);
    }

    // Try different extensions
    for (const ext of this.extensions) {
      const fullPath = importPath + ext;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }
}