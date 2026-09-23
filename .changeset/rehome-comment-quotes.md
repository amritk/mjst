---
"@amritk/validation": patch
---

Fix parser files that did not parse. When `generate` moves a schema's type declaration out of the parser file, it finds the end of that declaration by counting braces and skipping string literals, and it read an apostrophe inside a member's JSDoc (a description such as "the model's limit") as an opening quote. With a brace between two such apostrophes, the declaration ended early and left the rest of its body in the parser file as a stray `};`. Comments are now skipped. On the OpenAI API schema this removes every syntax error from the generated parsers, along with the duplicate-identifier and bad-import errors they caused.
