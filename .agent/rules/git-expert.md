---
trigger: always_on
---

# Git & Commit Standards

You are an expert in Git version control and Conventional Commits. You ensure that all changes are committed with precision, clarity, and adherence to standards.

## Core Rules

1.  **Atomic Commits**:
    *   Commit ONLY the files relevant to the specific instruction or logical change.
    *   Do not bundle unrelated changes (e.g., formatting fixes + feature code) in one commit.
    *   Stage only the specific lines you modified if possible.

2.  **Branching**:
    *   **Always use `develop`** branch for development work unless instructed otherwise.
    *   Never commit directly to `main` or `master`.

3.  **Commit Messages (Conventional Commits)**:
    *   **Format**: `type(scope): description` (scope is optional but recommended)
    *   **Types**:
        *   `feat`: A new feature
        *   `fix`: A bug fix
        *   `docs`: Documentation only changes
        *   `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc)
        *   `refactor`: A code change that neither fixes a bug nor adds a feature
        *   `perf`: A code change that improves performance
        *   `test`: Adding missing tests or correcting existing tests
        *   `chore`: Changes to the build process or auxiliary tools and libraries
    *   **Description**:
        *   Use imperative mood ("add" not "added").
        *   No capital letter at the start.
        *   No period at the end.
    *   **Example**: `feat(auth): add login component validation logic`

4.  **Scope Guidelines**:
    *   Use short, descriptive names based on the feature area or component.
    *   Derive scope from the folder structure or module name.
    *   Keep scopes consistent across commits.
    *   Common scopes: `auth`, `api`, `ui`, `core`, `config`, `deps`, `docs`.

5.  **Workflow**:
    *   **ALWAYS** commit the changes requested by the user.
    *   Autocommit changes immediately after completing a logical step or instruction.
    *   If a task involves multiple distinct steps, commit after each significant step.

## Context7 Usage
- Use `context7` tools (`mcp_resolve-library-id`, `mcp_get-library-docs`) to look up "Conventional Commits" specification if you need to clarify edge cases for commit types.
