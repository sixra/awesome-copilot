# Logic Apps Standard CLI skill package

This directory is the complete skill package, not a sample Logic Apps project.
Keep `SKILL.md` and all five `references` files together. No external skill, private
preview wheel, absolute author-machine path, or unbundled template is required.
The Azure CLI extension and task-specific runtime/test dependencies are separate installs.

## Package contents

| File | Purpose |
|---|---|
| [SKILL.md](SKILL.md) | Activation metadata, mandatory rules/routing, scaffolding, workspaces, validation |
| [Local runtime](references/local-runtime.md) | Dependencies, diagnosis, readiness, ownership-aware shutdown |
| [Connections](references/connections.md) | Discovery, managed identity, local/cloud connections, ACLs |
| [Live operations](references/live-operations.md) | Workflow changes, execution, diagnosis, cancellation/replay |
| [Testing](references/testing.md) | Native SDK tests, consent/trust, restore, evidence and limitations |
| [Packaging/deployment](references/packaging-deployment.md) | Ignore rules, archive checks, authorized deployment |

Install/copy this **entire directory**, not `SKILL.md` alone. Mandatory relative links are
resolved from the installed skill root. Do not require the customer's repository to have
this package's development-time `docs` parent. Reading bundled procedures is part of using
the skill, not an optional online documentation lookup.

## Awesome Copilot publication checklist

This local package is prepared for contribution; it is not already published or listed.
In an Awesome Copilot checkout:

1. Review current `AGENTS.md`, contribution rules, and overlapping Logic Apps skills.
   Contribute under `skills/azure-logic-apps-standard-cli`, preserving this whole directory.
2. Confirm rights/provenance and applicable repository license terms before publication.
   No new license or ownership claim is asserted by metadata here. SDK licensing remains
   separate, and the package includes no SDK binaries.
3. Check the matching lowercase skill/folder name, single-quoted description (10-1024
   characters), optional compatibility (at most 500 characters), referenced assets
   below 5 MB each, relative links, and absence of secrets or private-machine paths.
4. Run `npm run skill:validate`, then `npm run build` to regenerate listings. Normalize
   line endings with `bash eng/fix-line-endings.sh`, as required by that repository.
   Verify generated changes belong to this contribution. Do not hand-maintain listings.
5. Exercise representative tasks: offline authoring must not start a host; connector
   work must load the connection procedure; replay requires approval; native tests
   require fresh terms/trust/restore decisions. Inspect evidence, not just a model's
   assertion that it followed instructions.
6. Submit a PR targeting `main`, describing the specialized value, preview boundary,
   chargeable Azure effects, and qualification limits. A plugin manifest is unnecessary
   for a standalone skill. A listing/build pass does not prove runtime correctness.

The entry file aims to stay below the Agent Skills recommended 500 lines. This is a
progressive-disclosure recommendation, not permission to remove operational safeguards.
Detailed prerequisites, commands, outcomes, and failure handling remain in mandatory,
bundled procedures; this package has no runtime dependency on another unpublished skill.

## Maintenance and authoritative sources

Contract baseline: installed extension **1.0.0b1** and official upstream documentation,
reviewed **2026-10-25**. Installed help was inspected without creating projects, restoring
packages, running hosts, invoking workflows, or mutating Azure. The live public extension
index download was not independently verified during review; installation must report
index/network/version errors rather than claim availability or use a private fallback.

When updating the package, check both installed help and current upstream contracts.
Upstream `main` is mutable; release notes/installed version take precedence over assuming
every current source behavior is present in an older wheel. Retain preview status even
where generated Microsoft Learn command labels say GA.

- [Official extension source, README, and developer contracts](https://github.com/Azure/azure-cli-extensions/tree/main/src/logicapp)
- [Release history](https://github.com/Azure/azure-cli-extensions/blob/main/src/logicapp/HISTORY.rst)
- [Native workflow-testing contract](https://github.com/Azure/azure-cli-extensions/blob/main/src/logicapp/docs/workflow-testing-foundation.md)
- [Azure CLI Logic Apps reference](https://learn.microsoft.com/en-us/cli/azure/logicapp?view=azure-cli-latest)
- [Awesome Copilot contribution guide](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md#adding-skills)
- [Awesome Copilot repository conventions](https://github.com/github/awesome-copilot/blob/main/AGENTS.md)
- [Awesome Copilot skill validator](https://github.com/github/awesome-copilot/blob/main/eng/validate-skills.mjs)
- [Agent Skills specification](https://agentskills.io/specification)
