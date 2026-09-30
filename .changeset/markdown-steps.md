---
"@amritk/generate-markdown": minor
---

Render ordered lists as a docs site's step component, opt in.

- **New root `x-mjst.markdown.steps`.** `{ open, close, stepOpen, stepClose }` names the markup, for example `<scalar-steps>` and `<scalar-step id="{id}" title="{title}">`. A top-level ordered list whose every item opens with a bold lead-in (`1. **Create a token.** …`) becomes one step per item. A list with any item missing the lead-in stays a list. `{id}` is a slug of the title, unique among the page's steps, and `{title}` is the lead-in with its inline markdown stripped and HTML-escaped. It applies to property, page and section descriptions, notes and footers. Table rows keep their one-line summary, and lists inside fences are left alone. `MarkdownOptions.steps` overrides it per member, and the new `DocSteps` and `MarkdownStepsOptions` types are exported. `DocConfig` gains a `steps` member, so code that builds a `DocConfig` by hand has to set it. With `steps` unset, output is unchanged. A `steps` declaration missing one of its four members is an error rather than being read as off.
- **Heading anchors never repeat.** A numbered repeat that another heading already spells out is now skipped, as github-slugger does: two `deploy` headings and a `Deploy 1` get `deploy`, `deploy-1` and `deploy-1-1` instead of `deploy-1` twice. Pages without such a collision get the same anchors as before.
