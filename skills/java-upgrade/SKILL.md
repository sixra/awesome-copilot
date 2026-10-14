---
name: java-upgrade
description: 'Upgrade a Java project to a newer JDK (11 to 17, 17 to 21, 21 to 25) and adopt the new language and library features. Detects the current Java version from the build files, then loads only the matching per-version guide. Use when the user asks to upgrade Java, modernize Java code, or adopt records, sealed classes, pattern matching, virtual threads or other new Java features.'
---

# Java Upgrade

Help upgrade a Java project step by step and adopt new language features safely.

## Workflow

1. **Detect the current and target versions.** Read `pom.xml` (`maven.compiler.release`, `java.version`, toolchains), `build.gradle*` (`java.toolchain`, `sourceCompatibility`) and CI files. Never assume a target: ask the user if it is not stated.
2. **Upgrade one LTS at a time** (11 → 17 → 21 → 25). Build and run the tests after each step.
3. **Load only the guide you need** from the table below. Do not load all of them.
4. **Update the build first** (compiler release, plugins, dependencies that need newer versions), then adopt language features incrementally in small, reviewable changes.
5. **Verify**: `./mvnw verify` or `./gradlew build`, and fix deprecation and removal warnings before adopting new features.
6. **Automate and check upstream.** Use OpenRewrite when available (for example `org.openrewrite.java.migrate.UpgradeToJava21`) and always fetch the version-specific official guide before editing; review the generated diff.

## Upstream sources (read before upgrading)

Fetch the page for the target version; prefer it over this skill when they conflict. Full list with build-tool and agent compatibility pages: [references/upstream-sources.md](references/upstream-sources.md).

- OpenJDK release page: <https://openjdk.org/projects/jdk/21/> (change the number) and JEP index <https://openjdk.org/jeps/0>
- Oracle migration guide: <https://docs.oracle.com/en/java/javase/21/migrate/getting-started.html>
- Oracle release notes: <https://www.oracle.com/java/technologies/javase/21-relnote-issues.html>
- `jdeprscan` / `jdeps`: <https://docs.oracle.com/en/java/javase/21/docs/specs/man/jdeprscan.html>, <https://docs.oracle.com/en/java/javase/21/docs/specs/man/jdeps.html>
- Gradle compatibility matrix: <https://docs.gradle.org/current/userguide/compatibility.html>
- OpenRewrite: <https://docs.openrewrite.org/recipes/java/migrate/upgradetojava21>

## Per-version guides

| Upgrade | Guide |
|---|---|
| Java 11 → 17 | [references/java-11-to-17.md](references/java-11-to-17.md) |
| Java 17 → 21 | [references/java-17-to-21.md](references/java-17-to-21.md) |
| Java 21 → 25 | [references/java-21-to-25.md](references/java-21-to-25.md) |

## Rules

- Prefer behavior-preserving refactorings; do not change public APIs unless asked.
- Detect the project's frameworks (Spring Boot, Quarkus, Jakarta EE) and check their minimum supported Java version before raising the target.
- Do not adopt preview features unless the user opts in and the build enables them explicitly.
- For `javax.*` to `jakarta.*` namespace changes, use the `javax-to-jakarta-migration` skill.
