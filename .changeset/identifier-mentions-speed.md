---
"@amritk/helpers": patch
"@amritk/validation": patch
---

Speed up import pruning in generated files. `identifierMentions` answered each name with a fresh regex that rescanned the whole file, and blanking comments and literals rewrote the file one character at a time. It now collects the file's words once and builds the blanked text from slices. Generating every mode for the 959 definitions of the OpenAI API schema drops from about 7s to 2.2s, with byte-identical output.
