import {
  FragmentDefinitionNode,
  GraphQLError,
  Kind,
  SelectionSetNode,
  ValidationContext,
  ValidationRule
} from 'graphql';

function collectFragments(context: ValidationContext): Map<string, FragmentDefinitionNode> {
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const def of context.getDocument().definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(def.name.value, def);
    }
  }
  return fragments;
}

function measureDepth(
  selectionSet: SelectionSetNode | undefined,
  fragments: Map<string, FragmentDefinitionNode>,
  currentDepth: number,
  visitedFragments: Set<string>
): number {
  if (!selectionSet) return currentDepth;
  let max = currentDepth;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (selection.name.value.startsWith('__')) continue;
      const depth = selection.selectionSet
        ? measureDepth(selection.selectionSet, fragments, currentDepth + 1, visitedFragments)
        : currentDepth + 1;
      if (depth > max) max = depth;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const depth = measureDepth(selection.selectionSet, fragments, currentDepth, visitedFragments);
      if (depth > max) max = depth;
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value;
      if (visitedFragments.has(name)) continue;
      const frag = fragments.get(name);
      if (frag) {
        const nextVisited = new Set(visitedFragments);
        nextVisited.add(name);
        const depth = measureDepth(frag.selectionSet, fragments, currentDepth, nextVisited);
        if (depth > max) max = depth;
      }
    }
  }
  return max;
}

function measureComplexity(
  selectionSet: SelectionSetNode | undefined,
  fragments: Map<string, FragmentDefinitionNode>,
  multiplier: number,
  visitedFragments: Set<string>
): number {
  if (!selectionSet) return 0;
  let total = 0;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const childCost = selection.selectionSet
        ? measureComplexity(selection.selectionSet, fragments, Math.min(multiplier * 2, 16), visitedFragments)
        : 0;
      total += multiplier + childCost;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      total += measureComplexity(selection.selectionSet, fragments, multiplier, visitedFragments);
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value;
      if (visitedFragments.has(name)) continue;
      const frag = fragments.get(name);
      if (frag) {
        const nextVisited = new Set(visitedFragments);
        nextVisited.add(name);
        total += measureComplexity(frag.selectionSet, fragments, multiplier, nextVisited);
      }
    }
  }
  return total;
}

export function depthLimitRule(maxDepth = 5): ValidationRule {
  return (context: ValidationContext) => {
    const fragments = collectFragments(context);
    return {
      OperationDefinition(node) {
        const depth = measureDepth(node.selectionSet, fragments, 0, new Set());
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(
              `Consulta GraphQL rechazada: profundidad (${depth}) excede el limite permitido (${maxDepth}).`,
              {
                nodes: [node],
                extensions: {
                  code: 'GRAPHQL_DEPTH_LIMIT_EXCEEDED',
                  maxDepth,
                  actualDepth: depth
                }
              }
            )
          );
        }
      }
    };
  };
}

export function complexityLimitRule(maxComplexity = 100): ValidationRule {
  return (context: ValidationContext) => {
    const fragments = collectFragments(context);
    return {
      OperationDefinition(node) {
        const complexity = measureComplexity(node.selectionSet, fragments, 1, new Set());
        if (complexity > maxComplexity) {
          context.reportError(
            new GraphQLError(
              `Consulta GraphQL rechazada: complejidad estimada (${complexity}) excede el limite (${maxComplexity}).`,
              {
                nodes: [node],
                extensions: {
                  code: 'GRAPHQL_COMPLEXITY_LIMIT_EXCEEDED',
                  maxComplexity,
                  actualComplexity: complexity
                }
              }
            )
          );
        }
      }
    };
  };
}
