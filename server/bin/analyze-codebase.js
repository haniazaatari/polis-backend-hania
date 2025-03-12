#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  pattern: ['app.js', 'src/**/*.js'], // Default to all JS files
  outputFile: null,
  limit: 20, // Show top 20 functions by default
  minSize: 50, // Minimum function size to flag for refactoring
  minComplexity: 10, // Minimum complexity to flag for refactoring
  help: false
};

// Process command line arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--pattern' || arg === '-p') {
    options.pattern = [args[++i]];
  } else if (arg === '--output' || arg === '-o') {
    options.outputFile = args[++i];
  } else if (arg === '--limit' || arg === '-l') {
    options.limit = Number.parseInt(args[++i], 10) || 20;
  } else if (arg === '--min-size' || arg === '-s') {
    options.minSize = Number.parseInt(args[++i], 10) || 50;
  } else if (arg === '--min-complexity' || arg === '-c') {
    options.minComplexity = Number.parseInt(args[++i], 10) || 10;
  } else if (arg === '--help' || arg === '-h') {
    options.help = true;
  }
}

// Display help message
if (options.help) {
  process.stdout.write(`
Codebase Analyzer

Usage:
  node analyze-codebase.js [options]

Options:
  --pattern, -p     Glob pattern for files to analyze (default: app.js and src/**/*.js)
  --output, -o      Output file for results
  --limit, -l       Number of functions to display in each category (default: 20)
  --min-size, -s    Minimum function size to flag for refactoring (default: 50)
  --min-complexity, -c  Minimum complexity to flag for refactoring (default: 10)
  --help, -h        Show this help message

Examples:
  node analyze-codebase.js
  node analyze-codebase.js --pattern "src/server.js"
  node analyze-codebase.js --min-size 30 --min-complexity 5
  node analyze-codebase.js --limit 50 --output analysis-results.txt
  \n`);
  process.exit(0);
}

// Function to extract function information from a file
function extractFunctions(filePath, content) {
  const functionInfo = [];
  const lines = content.split('\n');

  // Match traditional function declarations: function name(...) {...}
  const traditionalFuncRegex = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*\{/g;

  // Match arrow functions and function expressions: const/let/var name = (...) => {...} or function(...) {...}
  const arrowFuncRegex =
    /(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:function\s*\(([^)]*)\)|(\([^)]*\))\s*=>)/g;

  // Match object method definitions: methodName(...) {...}
  const objectMethodRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*\{/g;

  // Find all function declarations and their line numbers
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;

    // Reset regex lastIndex
    traditionalFuncRegex.lastIndex = 0;
    arrowFuncRegex.lastIndex = 0;
    objectMethodRegex.lastIndex = 0;

    // Check for traditional functions
    let match = null;
    traditionalFuncRegex.exec(line);
    while (match !== null) {
      match = traditionalFuncRegex.exec(line);
      if (match !== null && !['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
        functionInfo.push({
          name: match[1],
          type: 'traditional',
          lineNumber,
          params: match[2].trim(),
          startLine: lineNumber,
          startColumn: match.index,
          isArrow: false,
          file: filePath
        });
      }
    }

    // Check for arrow functions and function expressions
    match = null;
    arrowFuncRegex.exec(line);
    while (match !== null) {
      match = arrowFuncRegex.exec(line);
      if (match !== null) {
        functionInfo.push({
          name: match[2],
          type: 'arrow/expression',
          lineNumber,
          params: match[3] || match[4],
          startLine: lineNumber,
          startColumn: match.index,
          isArrow: true,
          arrowLine: line,
          file: filePath
        });
      }
    }

    // Check for object methods
    match = null;
    objectMethodRegex.exec(line);
    while (match !== null) {
      match = objectMethodRegex.exec(line);
      // Filter out common keywords that might be caught incorrectly
      if (match !== null && !['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
        functionInfo.push({
          name: match[1],
          type: 'object method',
          lineNumber,
          params: match[2].trim(),
          startLine: lineNumber,
          startColumn: match.index,
          isArrow: false,
          file: filePath
        });
      }
    }
  }

  // Calculate function sizes
  const calculateFunctionSizes = () => {
    for (let i = 0; i < functionInfo.length; i++) {
      const func = functionInfo[i];

      // For arrow functions, check if it's a one-liner
      if (func.isArrow && func.arrowLine) {
        // Check if the arrow function is a one-liner (e.g., const x = () => something;)
        if (func.arrowLine.includes('=>') && func.arrowLine.includes(';') && !func.arrowLine.includes('{')) {
          func.endLine = func.startLine;
          func.lineCount = 1;
          func.complexity = 0;
          func.nestingLevel = 0;
          continue;
        }
      }

      // For regular functions, find the matching closing brace
      let braceCount = 0;
      let foundOpeningBrace = false;
      let currentLine = func.startLine;

      // Find the opening brace first
      const startLine = lines[currentLine - 1];
      for (let j = func.startColumn; j < startLine.length; j++) {
        if (startLine[j] === '{') {
          foundOpeningBrace = true;
          braceCount = 1;
          break;
        }
      }

      // If no opening brace on the first line, check the next few lines
      if (!foundOpeningBrace) {
        let lineOffset = 1;
        while (currentLine + lineOffset < lines.length && lineOffset < 5) {
          const nextLine = lines[currentLine + lineOffset - 1];
          if (nextLine.includes('{')) {
            foundOpeningBrace = true;
            braceCount = 1;
            currentLine += lineOffset;
            break;
          }
          lineOffset++;
        }
      }

      // If still no opening brace, assume it's a one-liner or invalid
      if (!foundOpeningBrace) {
        func.endLine = func.startLine;
        func.lineCount = 1;
        func.complexity = 0;
        func.nestingLevel = 0;
        continue;
      }

      // Now find the matching closing brace
      while (currentLine < lines.length && braceCount > 0) {
        currentLine++;
        if (currentLine >= lines.length) break;

        const line = lines[currentLine - 1];

        // Count braces
        for (let j = 0; j < line.length; j++) {
          if (line[j] === '{') braceCount++;
          if (line[j] === '}') braceCount--;

          // Found the matching closing brace
          if (braceCount === 0) break;
        }
      }

      func.endLine = currentLine;
      func.lineCount = func.endLine - func.startLine + 1;

      // Calculate complexity (simplified: count of if, for, while, switch, try, catch)
      let complexity = 0;
      for (let j = func.startLine; j <= func.endLine && j <= lines.length; j++) {
        if (j >= lines.length) break;
        const line = lines[j - 1];
        if (/\b(if|for|while|switch|try|catch)\b/.test(line)) {
          complexity++;
        }
      }
      func.complexity = complexity;

      // Calculate nesting level (simplified: count indentation)
      let maxNestingLevel = 0;
      for (let j = func.startLine; j <= func.endLine && j <= lines.length; j++) {
        if (j >= lines.length) break;
        const line = lines[j - 1];
        const indentation = line.match(/^\s*/)[0].length;
        const nestingLevel = Math.floor(indentation / 2); // Assuming 2 spaces per level
        maxNestingLevel = Math.max(maxNestingLevel, nestingLevel);
      }
      func.nestingLevel = maxNestingLevel;
    }
  };

  calculateFunctionSizes();

  return functionInfo;
}

async function main() {
  try {
    // Find all JavaScript files in the project
    const files = await glob(options.pattern, { cwd: rootDir });

    // Store all function information
    const allFunctions = [];
    const fileStats = [];

    // Process each file
    for (const file of files) {
      const filePath = path.join(rootDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const functions = extractFunctions(file, content);

        // Calculate file statistics
        const totalLines = content.split('\n').length;
        const totalFunctions = functions.length;
        const avgFunctionSize =
          totalFunctions > 0 ? functions.reduce((sum, func) => sum + func.lineCount, 0) / totalFunctions : 0;
        const avgComplexity =
          totalFunctions > 0 ? functions.reduce((sum, func) => sum + func.complexity, 0) / totalFunctions : 0;

        fileStats.push({
          file,
          totalLines,
          totalFunctions,
          avgFunctionSize,
          avgComplexity,
          largestFunction: totalFunctions > 0 ? functions.sort((a, b) => b.lineCount - a.lineCount)[0].name : 'N/A',
          largestFunctionSize: totalFunctions > 0 ? functions.sort((a, b) => b.lineCount - a.lineCount)[0].lineCount : 0
        });

        allFunctions.push(...functions);
      } catch (err) {
        process.stderr.write(`Error processing file ${file}: ${err.message}\n`);
      }
    }

    // Sort functions by size (largest first)
    const functionsBySize = [...allFunctions].sort((a, b) => b.lineCount - a.lineCount);

    // Sort functions by complexity (most complex first)
    const functionsByComplexity = [...allFunctions].sort((a, b) => b.complexity - a.complexity);

    // Sort functions by nesting level (most nested first)
    const functionsByNesting = [...allFunctions].sort((a, b) => b.nestingLevel - a.nestingLevel);

    // Sort files by total lines (largest first)
    const filesBySize = [...fileStats].sort((a, b) => b.totalLines - a.totalLines);

    // Identify refactoring candidates
    const refactoringCandidates = allFunctions
      .filter((func) => func.lineCount >= options.minSize || func.complexity >= options.minComplexity)
      .sort((a, b) => {
        // Sort by a combined score of size and complexity
        const scoreA = a.lineCount / options.minSize + a.complexity / options.minComplexity;
        const scoreB = b.lineCount / options.minSize + b.complexity / options.minComplexity;
        return scoreB - scoreA;
      });

    // Prepare output
    let output = '\n=== JavaScript Codebase Analysis ===\n\n';
    output += `Files analyzed: ${files.length}\n`;
    output += `Total functions found: ${allFunctions.length}\n`;
    output += `Average function size: ${(allFunctions.reduce((sum, func) => sum + func.lineCount, 0) / allFunctions.length).toFixed(2)} lines\n`;
    output += `Average function complexity: ${(allFunctions.reduce((sum, func) => sum + func.complexity, 0) / allFunctions.length).toFixed(2)}\n\n`;

    // Top files by size
    output += `Top ${Math.min(options.limit, filesBySize.length)} largest files:\n\n`;

    for (let i = 0; i < Math.min(options.limit, filesBySize.length); i++) {
      const file = filesBySize[i];
      output += `${i + 1}. ${file.file}\n`;
      output += `   Lines: ${file.totalLines}\n`;
      output += `   Functions: ${file.totalFunctions}\n`;
      output += `   Avg function size: ${file.avgFunctionSize.toFixed(2)} lines\n`;
      output += `   Avg complexity: ${file.avgComplexity.toFixed(2)}\n`;
      output += `   Largest function: ${file.largestFunction} (${file.largestFunctionSize} lines)\n\n`;
    }

    // Top functions by size
    output += `Top ${Math.min(options.limit, functionsBySize.length)} largest functions:\n\n`;

    for (let i = 0; i < Math.min(options.limit, functionsBySize.length); i++) {
      const func = functionsBySize[i];
      output += `${i + 1}. ${func.name} (${func.type})\n`;
      output += `   File: ${func.file}\n`;
      output += `   Lines: ${func.lineCount} (${func.startLine}-${func.endLine})\n`;
      output += `   Complexity: ${func.complexity}\n`;
      output += `   Nesting Level: ${func.nestingLevel}\n`;
      output += `   Parameters: ${func.params}\n\n`;
    }

    // Top functions by complexity
    output += `Top ${Math.min(options.limit, functionsByComplexity.length)} most complex functions:\n\n`;

    for (let i = 0; i < Math.min(options.limit, functionsByComplexity.length); i++) {
      const func = functionsByComplexity[i];
      output += `${i + 1}. ${func.name} (${func.type})\n`;
      output += `   File: ${func.file}\n`;
      output += `   Complexity: ${func.complexity}\n`;
      output += `   Lines: ${func.lineCount} (${func.startLine}-${func.endLine})\n`;
      output += `   Nesting Level: ${func.nestingLevel}\n`;
      output += `   Parameters: ${func.params}\n\n`;
    }

    // Top functions by nesting level
    output += `Top ${Math.min(options.limit, functionsByNesting.length)} most deeply nested functions:\n\n`;

    for (let i = 0; i < Math.min(options.limit, functionsByNesting.length); i++) {
      const func = functionsByNesting[i];
      output += `${i + 1}. ${func.name} (${func.type})\n`;
      output += `   File: ${func.file}\n`;
      output += `   Nesting Level: ${func.nestingLevel}\n`;
      output += `   Lines: ${func.lineCount} (${func.startLine}-${func.endLine})\n`;
      output += `   Complexity: ${func.complexity}\n`;
      output += `   Parameters: ${func.params}\n\n`;
    }

    // Refactoring candidates
    output += `Top ${Math.min(options.limit, refactoringCandidates.length)} refactoring candidates:\n\n`;

    for (let i = 0; i < Math.min(options.limit, refactoringCandidates.length); i++) {
      const func = refactoringCandidates[i];
      output += `${i + 1}. ${func.name} (${func.type})\n`;
      output += `   File: ${func.file}\n`;
      output += `   Lines: ${func.lineCount} (${func.startLine}-${func.endLine})\n`;
      output += `   Complexity: ${func.complexity}\n`;
      output += `   Nesting Level: ${func.nestingLevel}\n`;
      output += `   Parameters: ${func.params}\n`;
      output += `   Refactoring priority: ${(func.lineCount / options.minSize + func.complexity / options.minComplexity).toFixed(2)}\n\n`;
    }

    // Add recommendations
    output += '=== Recommendations ===\n\n';

    if (refactoringCandidates.length > 0) {
      output += `1. Consider breaking down large functions (${options.minSize}+ lines):\n`;
      for (
        let i = 0;
        i < Math.min(5, refactoringCandidates.filter((f) => f.lineCount >= options.minSize).length);
        i++
      ) {
        const func = refactoringCandidates.filter((f) => f.lineCount >= options.minSize)[i];
        output += `   - ${func.name} in ${func.file} (${func.lineCount} lines)\n`;
      }
      output += '\n';

      output += `2. Consider simplifying complex functions (complexity ${options.minComplexity}+):\n`;
      for (
        let i = 0;
        i < Math.min(5, refactoringCandidates.filter((f) => f.complexity >= options.minComplexity).length);
        i++
      ) {
        const func = refactoringCandidates.filter((f) => f.complexity >= options.minComplexity)[i];
        output += `   - ${func.name} in ${func.file} (complexity: ${func.complexity})\n`;
      }
      output += '\n';

      output += '3. Consider reducing nesting in deeply nested functions (level 5+):\n';
      for (let i = 0; i < Math.min(5, functionsByNesting.filter((f) => f.nestingLevel >= 5).length); i++) {
        const func = functionsByNesting.filter((f) => f.nestingLevel >= 5)[i];
        output += `   - ${func.name} in ${func.file} (nesting level: ${func.nestingLevel})\n`;
      }
      output += '\n';
    }

    output += '4. Files that may benefit most from refactoring:\n';
    for (let i = 0; i < Math.min(5, filesBySize.length); i++) {
      const file = filesBySize[i];
      output += `   - ${file.file} (${file.totalLines} lines, ${file.totalFunctions} functions)\n`;
    }

    // Write to file if specified, otherwise print to console
    if (options.outputFile) {
      fs.writeFileSync(options.outputFile, output);
      process.stdout.write(`Results written to ${options.outputFile}\n`);
    } else {
      process.stdout.write(output);
    }
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
