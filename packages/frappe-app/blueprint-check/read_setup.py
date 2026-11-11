"""Print the hat map and the Custom Fields that capxul/setup.py ships, as JSON, without importing Frappe.

Reads the module's source: DEFAULT_HAT_ROLES and CUSTOM_FIELDS are literals (dict(...) calls included)."""
import ast
import json
import sys


def value(node):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "dict" and not node.args:
        return {k.arg: value(k.value) for k in node.keywords}
    if isinstance(node, ast.Dict):
        return {value(k): value(v) for k, v in zip(node.keys, node.values)}
    if isinstance(node, (ast.List, ast.Tuple)):
        return [value(x) for x in node.elts]
    return ast.literal_eval(node)


tree = ast.parse(open(sys.argv[1]).read())
out = {}
for n in tree.body:
    if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ("DEFAULT_HAT_ROLES", "CUSTOM_FIELDS"):
        out[n.targets[0].id] = value(n.value)
print(json.dumps(out))
