import { program } from 'commander';
import { analyzeFileChanges } from './analyzer.js';
import path from 'path';

program
  .option('-e, --entry <path>', 'Entry file path')
  .option('-f, --file <path>', 'Changed file path')
  .option('-t, --type <type>', 'Change type (add|modify|delete)')
  .option('-x, --exports <exports>', 'Modified exports (for modify type)')
  .parse(process.argv);

const options = program.opts();

if (!options.entry || !options.file || !options.type) {
  console.error('Missing required options');
  process.exit(1);
}

async function main() {
  try {
    const result = await analyzeFileChanges({
      entryFile: path.resolve(process.cwd(), options.entry),
      changedFile: path.resolve(process.cwd(), options.file),
      changeType: options.type as 'add' | 'modify' | 'delete',
      modifiedExports: options.exports?.split(',') || []
    });

    console.log('\nFile Change Analysis Result:');
    console.log('===========================');
    printTree(result);
  } catch (error) {
    console.error('Analysis failed:', error);
    process.exit(1);
  }
}

function printTree(node: any, prefix = '') {
  console.log(`${prefix}${node.file}`);
  console.log(`${prefix}├─ Change: ${node.changeType}`);
  if (node.reason) {
    console.log(`${prefix}├─ Reason: ${node.reason}`);
  }
  if (node.children?.length) {
    console.log(`${prefix}└─ Affected files:`);
    node.children.forEach((child: any, index: number) => {
      const isLast = index === node.children.length - 1;
      printTree(child, `${prefix}    ${isLast ? '└─ ' : '├─ '}`);
    });
  }
}

main().catch(console.error);