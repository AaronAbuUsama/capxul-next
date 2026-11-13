// The CI role: who may take it on, and that it cannot give itself or the machine more than the bench host needs.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { permissionsPolicy, SSM_CORE_POLICY, subjects, trustPolicy } from "../bootstrap/src/aws-policy.ts";

const REPO = "AaronAbuUsama/capxul-next";
const PROVIDER = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com";

test("only this repository's master and pull requests into master may take the role on", () => {
  const [statement] = trustPolicy(PROVIDER, REPO).Statement;
  assert.deepEqual(statement?.Principal, { Federated: PROVIDER });
  assert.deepEqual(statement?.Action, ["sts:AssumeRoleWithWebIdentity"]);
  const equals = statement?.Condition?.["StringEquals"] ?? {};
  assert.equal(equals["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com");
  assert.deepEqual(equals["token.actions.githubusercontent.com:sub"], subjects(REPO));
  assert.equal(statement?.Condition?.["StringLike"], undefined, "no wildcard subjects");
  for (const s of subjects(REPO)) {
    assert.ok(Str.startsWith(`repo:${REPO}:`)(s), s);
    assert.ok(Str.includes("master")(s), s);
  }
  assert.ok(
    !Arr.contains(subjects(REPO), `repo:${REPO}:pull_request`),
    "a pull request into any branch is not trusted",
  );
});

test("the role reaches only the bench's IAM names, attaches only the SSM policy, and writes no inline policy", () => {
  const statements = permissionsPolicy("123456789012", "eu-west-2").Statement;
  const actionsOf = (s: (typeof statements)[number]): ReadonlyArray<string> => s.Action ?? [];
  const actions = Arr.flatMap(statements, actionsOf);
  for (const forbidden of ["iam:PutRolePolicy", "iam:PutRolePermissionsBoundary", "iam:CreatePolicy", "iam:*", "*"])
    assert.ok(!Arr.contains(actions, forbidden), forbidden);
  const granting = (action: string) => Arr.findFirst(statements, (s) => Arr.contains(actionsOf(s), action));
  assert.deepEqual(Option.getOrUndefined(granting("iam:AttachRolePolicy"))?.Condition, {
    ArnEquals: { "iam:PolicyARN": SSM_CORE_POLICY },
  });
  assert.deepEqual(Option.getOrUndefined(granting("iam:PassRole"))?.Condition, {
    StringEquals: { "iam:PassedToService": "ec2.amazonaws.com" },
  });
  const about = (service: string) =>
    Arr.filter(statements, (s) => Arr.some(actionsOf(s), (a) => Str.startsWith(`${service}:`)(a)));
  for (const s of Arr.filter(about("iam"), (x) => x.Resource !== "*"))
    for (const r of [s.Resource ?? []].flat()) assert.match(r, /:(role|instance-profile)\/capxul-bench-\*$/);
  for (const s of about("ec2")) assert.deepEqual(s.Condition, { StringEquals: { "aws:RequestedRegion": "eu-west-2" } });
});
