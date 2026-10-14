---
name: java-docs
description: 'Ensure that Java types are documented with Javadoc comments and follow best practices for documentation.'
---

# Java Documentation (Javadoc) Best Practices

## Principles

- Document only what the code actually does: read the implementation, callers and tests first. Never invent behaviour, thresholds, thread-safety, nullability or exceptions you have not verified; if unsure, leave it out or ask.
- Keep the existing documentation style of the project (language, tag order, comment form `/** */` vs `///`). Do not rewrite existing comments, or mass-document a codebase, unless the user asks; limit changes to the requested scope.
- Check the JDK level (`maven.compiler.release`, toolchain, `java -version`) before using newer features, and stay within it.

## Conventions

- Document public and protected members; documenting package-private and private members is welcome when they are complex or not self-explanatory.
- The first sentence is the summary and ends with a period. Do not just repeat the member name.
- `@param name description` (lowercase start, no final period); `@param <T>` for type parameters; `@return` for non-void; `@throws` for exceptions actually thrown (checked, and unchecked that are part of the contract).
- `{@code ...}` for inline code and `{@literal ...}` for text with `<`/`&`; `{@link Type#member}` for references; `@see` for related types.
- `{@inheritDoc}` or no comment on overriding members; document only real behaviour differences.
- `@since` only with the real version in which the API was introduced (check git history/release notes); `@deprecated` with a reason and the replacement (`{@link}`), together with `@Deprecated`.
- `@author` and `@version` only if the project already uses them.
- Code blocks, by JDK level:
  - Any JDK: `<pre>{@code ... }</pre>` (escape `@` at line start, balance braces).
  - JDK 18+: `{@snippet :  ... }` for inline code, or `{@snippet file="Example.java" region="demo"}` with files in `snippet-files/` (compiled and checked, preferred for examples). Use `// @highlight substring="x"` and `// @replace` markup as needed.
  - JDK 23+ only (JEP 467): Markdown doc comments with `///`, using `[Type#member]` for links and fenced code blocks. Use them only if the project already does or the user asks, and the build runs a JDK 23+ `javadoc`.

## Verify

- Run `mvn -q javadoc:javadoc` (or `./gradlew javadoc`) and for single files `javadoc -Xdoclint:all -d target/javadoc-check <files>`; fix every warning/error you introduced (missing `@param`, bad HTML, unresolved `{@link}`, unknown tags).
- Report what was documented and the commands run; state any claims you could not verify from the code.
