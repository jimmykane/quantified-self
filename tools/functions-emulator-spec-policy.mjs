import ts from 'typescript';

// Excluded files must not hide ordinary unit tests. Conservatively require all
// Vitest registrations to live inside a suite skipped when emulator hosts are absent.
export function assertEmulatorOnlySpec(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // Vitest globals are enabled in both configurations; explicit aliases and
  // namespace imports still need to resolve to the same registration names.
  const bindings = new Map(['describe', 'it', 'test'].map(name => [name, name]));
  const variables = new Map();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === 'vitest') {
      const imports = statement.importClause?.namedBindings;
      if (imports && ts.isNamedImports(imports)) {
        for (const item of imports.elements) bindings.set(item.name.text, (item.propertyName ?? item.name).text);
      } else if (imports && ts.isNamespaceImport(imports)) bindings.set(imports.name.text, '*');
    }
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          variables.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }
  function registration(expression) {
    if (ts.isCallExpression(expression)) return registration(expression.expression);
    if (ts.isIdentifier(expression)) return bindings.get(expression.text);
    if (ts.isPropertyAccessExpression(expression)) {
      const owner = registration(expression.expression);
      return owner === '*' ? expression.name.text : owner;
    }
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
      const owner = registration(expression.expression);
      return owner === '*' ? expression.argumentExpression.text : owner;
    }
  }
  function skipsWithoutHosts(predicate) {
    let host = false;
    const seen = new Set();
    function missing(expression) {
      if (ts.isParenthesizedExpression(expression)) return missing(expression.expression);
      if (ts.isPropertyAccessExpression(expression)
          && /^process\.env\.(FIRESTORE_EMULATOR_HOST|FIREBASE_AUTH_EMULATOR_HOST)$/.test(expression.getText(source))) {
        host = true;
        return undefined;
      }
      if (ts.isIdentifier(expression) && variables.has(expression.text) && !seen.has(expression.text)) {
        seen.add(expression.text);
        const value = missing(variables.get(expression.text));
        seen.delete(expression.text);
        return value;
      }
      if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
        return !missing(expression.operand);
      }
      if (ts.isBinaryExpression(expression)) {
        const left = missing(expression.left);
        const right = missing(expression.right);
        if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return left && right;
        if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) return left || right;
      }
      if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
      throw new Error('Unsupported emulator gate.');
    }
    try { return missing(predicate) === true && host; } catch { return false; }
  }
  let tests = 0;
  function visit(node, gated = false) {
    if (ts.isCallExpression(node)) {
      const name = registration(node.expression);
      const gate = name === 'describe' && ts.isCallExpression(node.expression)
        && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.name.text === 'skipIf'
        && node.expression.arguments.length === 1
        && skipsWithoutHosts(node.expression.arguments[0]);
      gated ||= gate;
      if (['describe', 'it', 'test'].includes(name)) {
        if (!gated) throw new Error(`Mixed unit/emulator registrations in ${file}; split ordinary tests into a unit spec.`);
        if (name !== 'describe') tests++;
      }
    }
    ts.forEachChild(node, child => visit(child, gated));
  }
  visit(source);
  if (!tests) throw new Error(`No emulator test registrations in ${file}.`);
}
