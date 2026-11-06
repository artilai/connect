import { defineRule, eslintCompatPlugin, type ESTree } from "@oxlint/plugins";

function isImportMeta(node: ESTree.Node) {
  return node.type === "MetaProperty" && node.meta.name === "import";
}

const noImportMetaEnvRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow import.meta.env outside entry points." },
    messages: {
      importMetaEnv: "Read the environment in an entry point and pass values in as arguments.",
    },
  },
  createOnce(context) {
    return {
      MemberExpression(node) {
        if (!isImportMeta(node.object)) return;
        const { property } = node;

        if (
          (property.type === "Identifier" && !node.computed && property.name === "env") ||
          (property.type === "Literal" && property.value === "env")
        ) {
          context.report({ node, messageId: "importMetaEnv" });
        }
      },
      VariableDeclarator(node) {
        if (node.init === null || !isImportMeta(node.init) || node.id.type !== "ObjectPattern") {
          return;
        }

        for (const entry of node.id.properties) {
          if (
            entry.type === "Property" &&
            entry.key.type === "Identifier" &&
            entry.key.name === "env"
          ) {
            context.report({ node: entry, messageId: "importMetaEnv" });
          }
        }
      },
    };
  },
});

function isRelative(source: string) {
  return source.startsWith(".");
}

const noReExportsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow re-exporting modules of the same package." },
    messages: {
      reExport: "Import it from the module that defines it instead of re-exporting it.",
    },
  },
  createOnce(context) {
    let imported = new Set<string>();

    return {
      before() {
        imported = new Set();
      },
      ImportDeclaration(node) {
        if (!isRelative(node.source.value)) return;

        for (const specifier of node.specifiers) imported.add(specifier.local.name);
      },
      ExportAllDeclaration(node) {
        context.report({ node, messageId: "reExport" });
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          if (isRelative(node.source.value)) context.report({ node, messageId: "reExport" });

          return;
        }

        for (const specifier of node.specifiers) {
          if (specifier.local.type === "Identifier" && imported.has(specifier.local.name)) {
            context.report({ node: specifier, messageId: "reExport" });
          }
        }
      },
    };
  },
});

const maxPositionalParams = 2;

type Implementation = ESTree.Function | ESTree.ArrowFunctionExpression;

type Signature =
  | Implementation
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature
  | ESTree.TSCallSignatureDeclaration;

function positional(node: Signature) {
  return node.params.filter((param) => !(param.type === "Identifier" && param.name === "this"));
}

function isAnnotated(param: ESTree.ParamPattern): boolean {
  if (param.type === "TSParameterProperty") return isAnnotated(param.parameter);

  if (param.type === "AssignmentPattern") return isAnnotated(param.left);

  return Boolean(param.typeAnnotation);
}

function isCallback(node: Implementation) {
  const { parent } = node;

  return (
    (parent.type === "CallExpression" || parent.type === "NewExpression") &&
    parent.arguments.some((argument) => argument === node)
  );
}

const preferObjectParamsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Require an object parameter instead of many positional ones." },
    messages: {
      positional: "Take one object parameter instead of {{count}} positional ones.",
    },
  },
  createOnce(context) {
    function check(node: Signature) {
      const params = positional(node);

      if (params.length > maxPositionalParams) {
        context.report({ node, messageId: "positional", data: { count: String(params.length) } });
      }
    }

    function checkImplementation(node: Implementation) {
      if (isCallback(node) || !node.params.some(isAnnotated)) return;

      check(node);
    }

    return {
      ArrowFunctionExpression: checkImplementation,
      FunctionDeclaration: checkImplementation,
      FunctionExpression: checkImplementation,
      TSDeclareFunction: checkImplementation,
      TSEmptyBodyFunctionExpression: checkImplementation,
      TSCallSignatureDeclaration: check,
      TSFunctionType: check,
      TSMethodSignature: check,
    };
  },
});

function annotationOf(param: ESTree.ParamPattern): ESTree.TSTypeAnnotation | null | undefined {
  if (param.type === "TSParameterProperty") return annotationOf(param.parameter);

  if (param.type === "AssignmentPattern") return annotationOf(param.left);

  return param.typeAnnotation;
}

function hasInlineObject(type: ESTree.TSType): boolean {
  if (type.type === "TSTypeLiteral") return true;

  return (
    (type.type === "TSIntersectionType" || type.type === "TSUnionType") &&
    type.types.some(hasInlineObject)
  );
}

function functionName(node: Implementation) {
  if (node.type !== "ArrowFunctionExpression" && node.id) return node.id.name;

  const { parent } = node;

  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;

  if (
    (parent.type === "Property" || parent.type === "MethodDefinition") &&
    parent.key.type === "Identifier"
  ) {
    return parent.key.name;
  }

  return undefined;
}

function typeNameFor(name: string) {
  if (/^[A-Z]/v.test(name)) return `${name}Props`;

  return `${name.charAt(0).toUpperCase()}${name.slice(1)}Options`;
}

function typeNameOf(node: Implementation) {
  const { parent } = node;

  if (parent.type === "MethodDefinition" && parent.kind === "constructor") {
    const owner = parent.parent.parent;

    if (owner?.type !== "ClassDeclaration" && owner?.type !== "ClassExpression") return undefined;

    return owner.id ? `${owner.id.name}Options` : undefined;
  }

  const name = functionName(node);

  return name && typeNameFor(name);
}

const blockTypes = new Set(["Program", "BlockStatement", "StaticBlock", "TSModuleBlock"]);

function enclosingStatement(node: ESTree.Node) {
  let current = node;

  while (current.parent && !blockTypes.has(current.parent.type)) current = current.parent;

  return current;
}

const noInlineParamTypesRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "Require a named type for object parameters." },
    messages: {
      inline: "Name this parameter type: type {{name}} = { … }.",
      inlineUnnamed: "Name this parameter type instead of writing it inline.",
    },
  },
  createOnce(context) {
    function check(node: Implementation) {
      if (isCallback(node)) return;

      const inline = node.params.flatMap((param) => {
        const annotation = annotationOf(param);

        return annotation && hasInlineObject(annotation.typeAnnotation) ? [annotation] : [];
      });

      const typeName = typeNameOf(node);

      for (const annotation of inline) {
        if (!typeName) {
          context.report({ node: annotation, messageId: "inlineUnnamed" });

          continue;
        }

        const { sourceCode } = context;
        const type = annotation.typeAnnotation;
        const text = sourceCode.getText(type);

        const generics = (node.typeParameters?.params ?? []).filter((param) =>
          new RegExp(`\\b${param.name.name}\\b`, "v").test(text),
        );

        const declared = generics.map((param) => sourceCode.getText(param)).join(", ");
        const used = generics.map((param) => param.name.name).join(", ");
        const parameters = generics.length > 0 ? `<${declared}>` : "";
        const reference = generics.length > 0 ? `${typeName}<${used}>` : typeName;
        const taken = new RegExp(`\\b${typeName}\\b`, "v").test(sourceCode.text);
        const statement = enclosingStatement(node);
        const [comment] = sourceCode.getCommentsBefore(statement);

        const diagnostic = { node: annotation, messageId: "inline", data: { name: typeName } };

        if (taken || inline.length > 1) {
          context.report(diagnostic);

          continue;
        }

        context.report({
          ...diagnostic,
          fix: (fixer) => [
            fixer.insertTextBefore(
              comment ?? statement,
              `type ${typeName}${parameters} = ${text};\n\n`,
            ),
            fixer.replaceText(type, reference),
          ],
        });
      }
    }

    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
      TSDeclareFunction: check,
    };
  },
});

const layers = new Map([
  ["errors", 0],
  ["utils", 0],
  ["channels", 1],
  ["telegram-channel", 2],
  ["url-channel", 2],
  ["server", 3],
]);

function workspaceOf(filename: string) {
  return /\/(?:apps|packages)\/([^\/]+)\//v.exec(filename)?.[1];
}

function importedWorkspace(source: string) {
  return /^@artil\/([^\/]+)/v.exec(source)?.[1];
}

const layeredImportsRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep workspace imports pointing down the layers." },
    messages: {
      upward: "@artil/{{from}} cannot import @artil/{{to}}: import only from lower layers.",
      unknown: "Give @artil/{{name}} a layer in .config/lint/index.ts.",
    },
  },
  createOnce(context) {
    function check(node: ESTree.Node, source: string) {
      const from = workspaceOf(context.filename);
      const to = importedWorkspace(source);

      if (!from || !to || from === to) return;

      const fromLayer = layers.get(from);
      const toLayer = layers.get(to);

      if (fromLayer === undefined || toLayer === undefined) {
        context.report({
          node,
          messageId: "unknown",
          data: { name: toLayer === undefined ? to : from },
        });

        return;
      }

      if (toLayer >= fromLayer) context.report({ node, messageId: "upward", data: { from, to } });
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node, String(node.source.value));
      },
    };
  },
});

// Where a file of the server sits: app, platform, a domain, or none of them, like main.ts.
function serverPlace(path: string) {
  const inside = /\/apps\/server\/src\/(.+)$/v.exec(path)?.[1];

  if (!inside) return undefined;

  const [top = "", second = ""] = inside.split("/");

  if (top === "app" || top === "platform") return { area: top, file: inside };

  if (top === "domains") return { area: `domains/${second}`, file: inside };

  return { area: "", file: inside };
}

function joinPath(directory: string, relative: string) {
  const parts = directory.split("/");

  for (const part of relative.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }

  return parts.join("/");
}

function baseName(path: string) {
  return (path.split("/").at(-1) ?? "").replace(/\.(?:ts|tsx)$/v, "");
}

const adapterNames = new Set(["routes", "tools", "commands", "middleware"]);

function isAdapter(name: string) {
  return adapterNames.has(name) || name.endsWith(".routes");
}

const transportModules = /^(?:hono(?:\/|$)|@modelcontextprotocol\/|@clack\/prompts$)/v;

const serverArchitectureRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep the server's app, domains and platform in their layers." },
    messages: {
      adapterRepository:
        "Routes, tools, commands and middleware call a domain's service, not its repository.",
      transportInCore:
        "A service or repository knows no transport: move what needs {{source}} into routes, tools or commands.",
      crossDomain: "Reach the {{to}} domain through its service.ts or schema.ts.",
      upward:
        "{{from}} cannot import {{to}}: platform sits below the domains, and the domains below app.",
    },
  },
  createOnce(context) {
    function check(node: ESTree.Node, source: string) {
      const from = serverPlace(context.filename);

      // Tests build the whole server through app/testing.ts, from any layer.
      if (!from || from.file.endsWith(".test.ts")) return;

      const name = baseName(from.file);
      const core = name === "service" || name === "repository";

      if (core && transportModules.test(source)) {
        context.report({ node, messageId: "transportInCore", data: { source } });
      }

      if (!isRelative(source)) return;

      const target = serverPlace(
        joinPath(context.filename.split("/").slice(0, -1).join("/"), source),
      );

      if (!target) return;

      if (isAdapter(name) && baseName(target.file) === "repository") {
        context.report({ node, messageId: "adapterRepository" });
      }

      const intoUpperLayer =
        (from.area === "platform" &&
          (target.area === "app" || target.area.startsWith("domains/"))) ||
        (from.area.startsWith("domains/") && target.area === "app");

      if (intoUpperLayer) {
        context.report({ node, messageId: "upward", data: { from: from.area, to: target.area } });

        return;
      }

      const otherDomain =
        from.area.startsWith("domains/") &&
        target.area.startsWith("domains/") &&
        from.area !== target.area;

      if (otherDomain && !["service", "schema"].includes(baseName(target.file))) {
        context.report({
          node,
          messageId: "crossDomain",
          data: { to: target.area.replace("domains/", "") },
        });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node, String(node.source.value));
      },
    };
  },
});

export default eslintCompatPlugin({
  meta: { name: "artil" },
  rules: {
    "no-import-meta-env": noImportMetaEnvRule,
    "no-re-exports": noReExportsRule,
    "layered-imports": layeredImportsRule,
    "server-architecture": serverArchitectureRule,
    "no-inline-param-types": noInlineParamTypesRule,
    "prefer-object-params": preferObjectParamsRule,
  },
});
